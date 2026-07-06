/**
 * Time-driven Echo voice reminders, run by the scheduler:
 *  - appointment reminders 15 minutes and 5 minutes before the start,
 *  - follow-up-call-due reminders,
 *  - the end-of-day closing summary.
 *
 * Each enqueue is idempotent via a stable dedup_key, so the every-minute tick
 * can safely re-scan overlapping windows without double-speaking. Owner voice
 * settings (enabled + per-event toggle) are honored at enqueue time to keep the
 * queue clean; quiet-hours are applied at delivery (the client knows the owner's
 * real local hour). All work is best-effort and never throws into the scheduler.
 */
const db = require("../config/db");
const { enqueueVoiceNotification } = require("./echoVoiceNotifications");
const { gatherBriefingData, narrate } = require("./echoBriefing");
const { normalizeSettings } = require("../config/echoVoice");

function firstNameOf(row) {
  return row && row.first_name && row.first_name.trim() ? row.first_name.trim() : null;
}

function greetingName(row) {
  return firstNameOf(row) || "there";
}

function dayPart(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

function timeLabel(ts) {
  try {
    return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "soon";
  }
}

/** Should this event be enqueued for this owner right now (settings gate)? */
function eventEnabled(voiceSettings, eventType) {
  const s = normalizeSettings(voiceSettings);
  if (!s.enabled) return false;
  return s.events[eventType] !== false;
}

/**
 * Enqueue appointment reminders (15m + 5m before) for every scheduled
 * appointment starting within the next ~16 minutes. Dedup keys make repeated
 * ticks safe; expires_at keeps a stale reminder from firing after the start.
 */
async function sweepAppointmentReminders() {
  const rows = (
    await db.query(
      `SELECT a.appointment_id, a.title, a.start_time, a.contact_name,
              a.contact_phone, a.description, a.location,
              b.user_id, b.brand_id,
              l.lead_name, l.phone AS lead_phone,
              u.first_name, u.voice_settings
         FROM appointments a
         JOIN brands b ON b.brand_id = a.brand_id
         JOIN users  u ON u.user_id = b.user_id
         LEFT JOIN leads l ON l.lead_id = a.lead_id
        WHERE a.status = 'scheduled'
          AND b.is_demo = false
          AND a.start_time > NOW()
          AND a.start_time <= NOW() + INTERVAL '16 minutes'`
    )
  ).rows;

  for (const r of rows) {
    // Best-effort per appointment: one malformed row (bad settings JSON, bad
    // timestamp, enqueue failure) must never silence the remaining reminders.
    // Called via module.exports so tests can stub a throw here and prove the
    // per-item guard contains it.
    try {
      await module.exports.processAppointmentReminderRow(r);
    } catch (err) {
      console.error(
        `Appointment reminder failed for appointment ${r.appointment_id}:`,
        err.message
      );
    }
  }
  return rows.length;
}

/** Per-row body of the appointment sweep (15m + 5m reminders for one row). */
async function processAppointmentReminderRow(r) {
  const minutesUntil = (new Date(r.start_time).getTime() - Date.now()) / 60000;
  const name = greetingName(r);
  const who = r.contact_name || r.lead_name || "your contact";
  const phone = r.contact_phone || r.lead_phone;
  const time = timeLabel(r.start_time);

  // 15-minute reminder (fires once at ~15 min before; dedup guards re-ticks).
  if (minutesUntil <= 15.5 && eventEnabled(r.voice_settings, "appointment_15m")) {
    let text =
      `Good ${dayPart()} ${name}, your ${time} appointment with ${who} starts in fifteen minutes.`;
    if (r.description) text += ` Note: ${String(r.description).slice(0, 200)}.`;
    if (phone) text += ` You can reach them at ${phone}.`;
    await enqueueVoiceNotification({
      userId: r.user_id,
      brandId: r.brand_id,
      eventType: "appointment_15m",
      title: `Appointment at ${time}`,
      spokenText: text,
      payload: { appointmentId: r.appointment_id, contact: who, phone: phone || null, startTime: r.start_time },
      dedupKey: `appt15:${r.appointment_id}`,
      expiresAt: new Date(r.start_time),
    });
  }

  // 5-minute reminder.
  if (minutesUntil <= 5.5 && eventEnabled(r.voice_settings, "appointment_5m")) {
    await enqueueVoiceNotification({
      userId: r.user_id,
      brandId: r.brand_id,
      eventType: "appointment_5m",
      title: `Appointment at ${time}`,
      spokenText: `${name}, your ${time} appointment starts in five minutes.`,
      payload: { appointmentId: r.appointment_id, contact: who, startTime: r.start_time },
      dedupKey: `appt5:${r.appointment_id}`,
      expiresAt: new Date(r.start_time),
    });
  }
}

/**
 * Enqueue "time to follow up" reminders for due phone touchpoints — a scheduled
 * follow-up call that is now due. Dedup by touchpoint id so it speaks once.
 */
async function sweepFollowUpReminders() {
  const rows = (
    await db.query(
      `SELECT t.touchpoint_id, t.scheduled_at,
              s.brand_id,
              b.user_id,
              u.first_name, u.voice_settings,
              l.lead_name, l.temperature, l.updated_at AS lead_updated_at, l.phone
         FROM sequence_touchpoints t
         JOIN follow_up_sequences s ON s.sequence_id = t.sequence_id
         JOIN brands b ON b.brand_id = s.brand_id
         JOIN users  u ON u.user_id = b.user_id
         LEFT JOIN leads l ON l.lead_id = s.lead_id
        WHERE t.channel = 'phone'
          AND b.is_demo = false
          AND t.status = 'pending'
          AND t.scheduled_at <= NOW()
          AND t.scheduled_at > NOW() - INTERVAL '2 hours'
        LIMIT 100`
    )
  ).rows;

  for (const r of rows) {
    // Best-effort per touchpoint: one malformed row must never silence the
    // remaining follow-up reminders. Called via module.exports so tests can
    // stub a throw here and prove the per-item guard contains it.
    try {
      await module.exports.processFollowUpReminderRow(r);
    } catch (err) {
      console.error(
        `Follow-up reminder failed for touchpoint ${r.touchpoint_id}:`,
        err.message
      );
    }
  }
  return rows.length;
}

/** Per-row body of the follow-up sweep (one due phone touchpoint). */
async function processFollowUpReminderRow(r) {
  if (!eventEnabled(r.voice_settings, "followup_due")) return;
  const name = greetingName(r);
  const lead = r.lead_name || "a lead";
  const tempNote =
    r.temperature === "hot"
      ? "They were a hot lead."
      : r.temperature === "warm"
        ? "They were a warm lead who requested a callback."
        : "";
  const daysAgo = r.lead_updated_at
    ? Math.max(0, Math.floor((Date.now() - new Date(r.lead_updated_at).getTime()) / 86400000))
    : null;
  const lastNote =
    daysAgo === null
      ? ""
      : daysAgo === 0
        ? " Their last interaction was earlier today."
        : ` Their last interaction was ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago.`;

  const text = `${name}, it's time to follow up with ${lead}. ${tempNote}${lastNote} Want me to connect the call now?`.replace(
    /\s+/g,
    " "
  );

  await enqueueVoiceNotification({
    userId: r.user_id,
    brandId: r.brand_id,
    eventType: "followup_due",
    title: `Follow up with ${lead}`,
    spokenText: text,
    payload: { touchpointId: r.touchpoint_id, lead, phone: r.phone || null },
    dedupKey: `followup:${r.touchpoint_id}`,
    expiresAt: new Date(Date.now() + 3 * 3600 * 1000),
  });
}

/**
 * The every-minute reminder sweep (appointments + follow-ups). Each sub-sweep
 * is isolated so a failure in one (e.g. the appointments query erroring) never
 * silences the other.
 */
async function sweepDueReminders() {
  try {
    await sweepAppointmentReminders();
  } catch (err) {
    console.error("Appointment reminder sweep errored:", err.message);
  }
  try {
    await sweepFollowUpReminders();
  } catch (err) {
    console.error("Follow-up reminder sweep errored:", err.message);
  }
}

/**
 * Enqueue the end-of-day closing summary for every owner who has at least one
 * brand. Narrated once (AI with deterministic fallback) and stored as text.
 * Dedup by day so re-runs on the same date don't double-enqueue.
 */
async function enqueueClosingSummaries() {
  const owners = (
    await db.query(
      `SELECT DISTINCT b.user_id, u.first_name, u.voice_settings
         FROM brands b
         JOIN users u ON u.user_id = b.user_id
        WHERE b.is_demo = false`
    )
  ).rows;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const dayKey = startOfDay.toISOString().slice(0, 10);

  let enqueued = 0;
  for (const owner of owners) {
    if (!eventEnabled(owner.voice_settings, "day_summary")) continue;
    try {
      const data = await gatherBriefingData(owner.user_id, startOfDay);
      const { text } = await narrate("closing", firstNameOf(owner), data);
      const id = await enqueueVoiceNotification({
        userId: owner.user_id,
        eventType: "day_summary",
        title: "End-of-day summary",
        spokenText: text,
        dedupKey: `daysummary:${dayKey}`,
        expiresAt: new Date(Date.now() + 6 * 3600 * 1000),
      });
      if (id) enqueued += 1;
    } catch (err) {
      console.error(`Closing summary failed for user ${owner.user_id}:`, err.message);
    }
  }
  return enqueued;
}

module.exports = {
  sweepDueReminders,
  sweepAppointmentReminders,
  sweepFollowUpReminders,
  enqueueClosingSummaries,
  // Per-row bodies, exported (and invoked via module.exports) so tests can
  // stub a throw and prove the per-item guards contain it.
  processAppointmentReminderRow,
  processFollowUpReminderRow,
};
