/**
 * Echo Personal Assistant — reminders + tasks engine, run by the scheduler.
 *
 * Per-minute sweep (sweepPersonalReminders):
 *  - due reminders → enqueue a spoken voice notification (status 'notifying'),
 *  - SMS fallback  → if the spoken reminder hasn't been picked up ~3 minutes
 *    after enqueue and the owner has a phone on file, text it via the platform
 *    Twilio number and mark it delivered by SMS,
 *  - recurring reminders reschedule themselves to the next occurrence.
 *
 * Daily sweep (runDailyTaskSweep):
 *  - auto-create tasks for hot leads waiting 24+ hours with no follow-up,
 *  - SMS-alert the owner about overdue high-priority tasks (once per task),
 *  - voice check-in on tasks open for 3+ days (once every 3 days per task).
 *
 * All sweeps follow the platform sweep-guard seam: each row's body is exported
 * and invoked via module.exports so tests can stub a throw and prove one bad
 * row never silences the rest. Everything is best-effort and never throws into
 * the scheduler.
 */
const db = require("../config/db");
const { enqueueVoiceNotification } = require("./echoVoiceNotifications");
const { normalizeSettings } = require("../config/echoVoice");
const { normalizeE164 } = require("./phone");
const { buildClient } = require("../config/twilio");

const RECURRENCES = ["none", "daily", "weekly", "monthly"];
const PRIORITIES = ["high", "medium", "low"];
// How long the spoken reminder sits unclaimed before falling back to SMS.
const SMS_FALLBACK_MINUTES = 3;
// How long a 'notifying' reminder may wait in total before we give up and mark
// it delivered anyway (owner offline, no phone on file).
const NOTIFY_EXPIRY_HOURS = 2;

function eventEnabled(voiceSettings, eventType) {
  const s = normalizeSettings(voiceSettings);
  if (!s.enabled) return false;
  return s.events[eventType] !== false;
}

function timeLabel(ts) {
  try {
    return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "now";
  }
}

/** Platform Twilio credentials (the Zorecho sales number doubles as Echo's own). */
function getPlatformTwilioCreds() {
  const accountSid = process.env.SALES_TWILIO_ACCOUNT_SID;
  const authToken = process.env.SALES_TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.SALES_TWILIO_NUMBER;
  if (!accountSid || !authToken || !phoneNumber) return null;
  return { accountSid, authToken, phoneNumber };
}

/**
 * Sends a personal SMS from Echo to the owner's configured phone number.
 * Returns true only when Twilio accepted the message — callers branch delivery
 * bookkeeping on this, so a swallowed failure must return false, never lie.
 */
async function sendOwnerSms(to, bodyText) {
  const creds = getPlatformTwilioCreds();
  if (!creds) return false;
  const normalized = normalizeE164(to);
  if (!normalized) return false;
  try {
    const client = buildClient(creds.accountSid, creds.authToken);
    await client.messages.create({
      to: normalized,
      from: creds.phoneNumber,
      body: bodyText,
    });
    return true;
  } catch (err) {
    console.error("Echo personal SMS failed:", err.message);
    return false;
  }
}

/** Next occurrence of a recurring reminder, always in the future. */
function nextOccurrence(dueAt, recurrence, now = new Date()) {
  const next = new Date(dueAt);
  const step = () => {
    if (recurrence === "daily") next.setDate(next.getDate() + 1);
    else if (recurrence === "weekly") next.setDate(next.getDate() + 7);
    else if (recurrence === "monthly") next.setMonth(next.getMonth() + 1);
  };
  step();
  // Catch up if the reminder was overdue by more than one period.
  let guard = 0;
  while (next <= now && guard < 400) {
    step();
    guard += 1;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Per-minute reminder sweep
// ---------------------------------------------------------------------------

/**
 * Step 1: due reminders → enqueue the spoken notification and flip the row to
 * 'notifying' (atomic status guard so overlapping ticks can't double-enqueue).
 */
async function sweepDueEchoReminders() {
  const rows = (
    await db.query(
      `SELECT r.reminder_id, r.user_id, r.reminder_text, r.due_at, r.recurrence,
              u.first_name, u.voice_settings
         FROM echo_reminders r
         JOIN users u ON u.user_id = r.user_id
        WHERE r.status = 'scheduled' AND r.due_at <= NOW()
        ORDER BY r.due_at ASC
        LIMIT 200`
    )
  ).rows;

  for (const r of rows) {
    try {
      await module.exports.processDueReminderRow(r);
    } catch (err) {
      console.error(`Personal reminder failed for ${r.reminder_id}:`, err.message);
    }
  }
  return rows.length;
}

/** Per-row body of the due-reminder sweep. */
async function processDueReminderRow(r) {
  // Claim the row first (scheduled → notifying); the row-count branch makes
  // overlapping ticks safe — only the winning tick enqueues.
  const claimed = await db.query(
    `UPDATE echo_reminders
        SET status = 'notifying', voice_enqueued_at = NOW(), updated_at = NOW()
      WHERE reminder_id = $1 AND status = 'scheduled'`,
    [r.reminder_id]
  );
  if (claimed.rowCount === 0) return;

  const name = r.first_name && r.first_name.trim() ? r.first_name.trim() : "there";
  const spokenText = `${name}, just a reminder: ${r.reminder_text}.`;

  if (eventEnabled(r.voice_settings, "personal_reminder")) {
    const notificationId = await enqueueVoiceNotification({
      userId: r.user_id,
      eventType: "personal_reminder",
      title: "Personal reminder",
      spokenText,
      payload: { reminderId: r.reminder_id, dueAt: r.due_at },
      dedupKey: `preminder:${r.reminder_id}:${new Date(r.due_at).toISOString()}`,
      expiresAt: new Date(Date.now() + NOTIFY_EXPIRY_HOURS * 3600 * 1000),
    });
    if (notificationId) {
      await db.query(
        `UPDATE echo_reminders SET voice_notification_id = $2, updated_at = NOW()
          WHERE reminder_id = $1`,
        [r.reminder_id, notificationId]
      );
    }
  }
}

/**
 * Step 2: SMS fallback + settle. For every 'notifying' reminder past the
 * fallback window: if the voice notification was spoken, settle as voice; if
 * it's still pending and the owner has a phone, text it and settle as SMS;
 * after the expiry window, settle without a channel so nothing loops forever.
 */
async function sweepReminderFallbacks() {
  const rows = (
    await db.query(
      `SELECT r.reminder_id, r.user_id, r.reminder_text, r.due_at, r.recurrence,
              r.voice_notification_id, r.voice_enqueued_at,
              u.phone, u.first_name,
              n.status AS notification_status
         FROM echo_reminders r
         JOIN users u ON u.user_id = r.user_id
         LEFT JOIN echo_voice_notifications n
                ON n.notification_id = r.voice_notification_id
        WHERE r.status = 'notifying'
        ORDER BY r.voice_enqueued_at ASC
        LIMIT 200`
    )
  ).rows;

  for (const r of rows) {
    try {
      await module.exports.processReminderFallbackRow(r);
    } catch (err) {
      console.error(`Reminder fallback failed for ${r.reminder_id}:`, err.message);
    }
  }
  return rows.length;
}

/** Per-row body of the SMS-fallback sweep. */
async function processReminderFallbackRow(r) {
  const enqueuedMs = r.voice_enqueued_at ? new Date(r.voice_enqueued_at).getTime() : 0;
  const waitedMinutes = (Date.now() - enqueuedMs) / 60000;

  // Spoken already → settle as voice.
  if (r.notification_status === "delivered" || r.notification_status === "dismissed") {
    await module.exports.settleReminder(r, "voice");
    return;
  }

  if (waitedMinutes < SMS_FALLBACK_MINUTES) return;

  // Not spoken within the window → text it if we can.
  if (r.phone) {
    const sent = await sendOwnerSms(
      r.phone,
      `Zorecho reminder: ${r.reminder_text} (due ${timeLabel(r.due_at)})`
    );
    if (sent) {
      // Retire the pending spoken copy so the owner isn't reminded twice.
      if (r.voice_notification_id) {
        await db.query(
          `UPDATE echo_voice_notifications
              SET status = 'dismissed', delivered_at = NOW()
            WHERE notification_id = $1 AND status = 'pending'`,
          [r.voice_notification_id]
        );
      }
      await module.exports.settleReminder(r, "sms");
      return;
    }
  }

  // No phone (or SMS failed): keep waiting for a voice pickup until the expiry
  // window closes, then settle with no channel so the row can't loop forever.
  if (waitedMinutes >= NOTIFY_EXPIRY_HOURS * 60) {
    await module.exports.settleReminder(r, null);
  }
}

/**
 * Marks a reminder delivered (with the channel that reached the owner) and, for
 * recurring reminders, reschedules the same row to its next occurrence.
 * Status-guarded so an out-of-band complete/cancel is never resurrected.
 */
async function settleReminder(r, channel) {
  if (r.recurrence && r.recurrence !== "none") {
    const next = nextOccurrence(r.due_at, r.recurrence);
    await db.query(
      `UPDATE echo_reminders
          SET status = 'scheduled', due_at = $2, delivery_channel = $3,
              delivered_at = NOW(), voice_notification_id = NULL,
              voice_enqueued_at = NULL, updated_at = NOW()
        WHERE reminder_id = $1 AND status = 'notifying'`,
      [r.reminder_id, next, channel]
    );
    return;
  }
  await db.query(
    `UPDATE echo_reminders
        SET status = 'delivered', delivery_channel = $2, delivered_at = NOW(),
            updated_at = NOW()
      WHERE reminder_id = $1 AND status = 'notifying'`,
    [r.reminder_id, channel]
  );
}

/**
 * The every-minute personal sweep. Each sub-sweep is isolated so a failure in
 * one never silences the other.
 */
async function sweepPersonalReminders() {
  try {
    await sweepDueEchoReminders();
  } catch (err) {
    console.error("Personal reminder sweep errored:", err.message);
  }
  try {
    await sweepReminderFallbacks();
  } catch (err) {
    console.error("Reminder fallback sweep errored:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Daily task sweep
// ---------------------------------------------------------------------------

/**
 * Auto-create a follow-up task for every hot lead that has been waiting 24+
 * hours with no update. The unique (user_id, auto_ref) index is the dedup
 * backstop, so re-runs can never duplicate a task.
 */
async function sweepAutoTasksFromHotLeads() {
  const rows = (
    await db.query(
      `SELECT l.lead_id, l.lead_name, b.user_id, u.first_name, u.voice_settings
         FROM leads l
         JOIN brands b ON b.brand_id = l.brand_id
         JOIN users u ON u.user_id = b.user_id
        WHERE b.is_demo = false
          AND l.temperature = 'hot'
          AND l.conversion_status = 'new'
          AND l.created_at < NOW() - INTERVAL '24 hours'
          AND l.created_at > NOW() - INTERVAL '14 days'
        LIMIT 100`
    )
  ).rows;

  let created = 0;
  for (const r of rows) {
    try {
      const madeOne = await module.exports.processHotLeadTaskRow(r);
      if (madeOne) created += 1;
    } catch (err) {
      console.error(`Auto-task failed for lead ${r.lead_id}:`, err.message);
    }
  }
  return created;
}

/** Per-row body of the hot-lead auto-task sweep. Returns true if created. */
async function processHotLeadTaskRow(r) {
  const who = r.lead_name && r.lead_name.trim() ? r.lead_name.trim() : "a hot lead";
  const result = await db.query(
    `INSERT INTO echo_tasks (user_id, task_text, priority, source, auto_ref)
     VALUES ($1, $2, 'high', 'auto', $3)
     ON CONFLICT (user_id, auto_ref) WHERE auto_ref IS NOT NULL DO NOTHING
     RETURNING task_id`,
    [r.user_id, `Follow up with ${who}, who has been waiting over 24 hours`, `hotlead:${r.lead_id}`]
  );
  if (result.rows.length === 0) return false;

  if (eventEnabled(r.voice_settings, "task_alert")) {
    const name = r.first_name && r.first_name.trim() ? r.first_name.trim() : "there";
    await enqueueVoiceNotification({
      userId: r.user_id,
      eventType: "task_alert",
      title: "New task",
      spokenText: `${name}, I added a task to follow up with ${who}, who has been waiting twenty-four hours.`,
      payload: { taskId: result.rows[0].task_id, leadId: r.lead_id },
      dedupKey: `taskauto:hotlead:${r.lead_id}`,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    });
  }
  return true;
}

/**
 * SMS alert for overdue high-priority tasks (due_date in the past, still open,
 * not yet alerted). The sms_alerted_at stamp is set with a NULL-guard so the
 * text goes out exactly once per task.
 */
async function sweepOverdueHighPriorityTasks() {
  const rows = (
    await db.query(
      `SELECT t.task_id, t.task_text, t.due_date, u.phone
         FROM echo_tasks t
         JOIN users u ON u.user_id = t.user_id
        WHERE t.status = 'open'
          AND t.priority = 'high'
          AND t.due_date IS NOT NULL
          AND t.due_date < CURRENT_DATE
          AND t.sms_alerted_at IS NULL
          AND u.phone IS NOT NULL
        LIMIT 50`
    )
  ).rows;

  let alerted = 0;
  for (const r of rows) {
    try {
      const sent = await module.exports.processOverdueTaskRow(r);
      if (sent) alerted += 1;
    } catch (err) {
      console.error(`Overdue task alert failed for ${r.task_id}:`, err.message);
    }
  }
  return alerted;
}

/** Per-row body of the overdue-task SMS sweep. Returns true if texted. */
async function processOverdueTaskRow(r) {
  // Claim the alert first (NULL-guard row count) so overlapping runs can't
  // double-text; if the SMS then fails, roll the stamp back for a retry.
  const claimed = await db.query(
    `UPDATE echo_tasks SET sms_alerted_at = NOW(), updated_at = NOW()
      WHERE task_id = $1 AND sms_alerted_at IS NULL`,
    [r.task_id]
  );
  if (claimed.rowCount === 0) return false;

  const sent = await sendOwnerSms(
    r.phone,
    `Zorecho: your high-priority task "${r.task_text}" is overdue. Open Echo's Personal Assistant to update it.`
  );
  if (!sent) {
    await db.query(
      `UPDATE echo_tasks SET sms_alerted_at = NULL, updated_at = NOW()
        WHERE task_id = $1`,
      [r.task_id]
    );
    return false;
  }
  return true;
}

/**
 * Voice check-in for tasks open 3+ days that haven't been asked about in the
 * last 3 days. Dedup per (task, day) so a re-run can't nag twice in one day.
 */
async function sweepStaleTaskCheckIns() {
  const rows = (
    await db.query(
      `SELECT t.task_id, t.task_text, t.created_at, t.user_id,
              u.first_name, u.voice_settings
         FROM echo_tasks t
         JOIN users u ON u.user_id = t.user_id
        WHERE t.status = 'open'
          AND t.created_at < NOW() - INTERVAL '3 days'
          AND (t.last_check_in_at IS NULL OR t.last_check_in_at < NOW() - INTERVAL '3 days')
        LIMIT 50`
    )
  ).rows;

  let asked = 0;
  for (const r of rows) {
    try {
      const didAsk = await module.exports.processStaleTaskRow(r);
      if (didAsk) asked += 1;
    } catch (err) {
      console.error(`Stale-task check-in failed for ${r.task_id}:`, err.message);
    }
  }
  return asked;
}

/** Per-row body of the stale-task check-in sweep. Returns true if enqueued. */
async function processStaleTaskRow(r) {
  if (!eventEnabled(r.voice_settings, "task_checkin")) return false;
  const name = r.first_name && r.first_name.trim() ? r.first_name.trim() : "there";
  const days = Math.max(1, Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000));
  const dayKey = new Date().toISOString().slice(0, 10);
  const id = await enqueueVoiceNotification({
    userId: r.user_id,
    eventType: "task_checkin",
    title: "Task check-in",
    spokenText: `${name}, I noticed the task to ${r.task_text} has been open for ${days} days. Has that been taken care of, or would you like me to set a reminder?`,
    payload: { taskId: r.task_id },
    dedupKey: `taskcheckin:${r.task_id}:${dayKey}`,
    expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
  });
  if (id) {
    await db.query(
      `UPDATE echo_tasks SET last_check_in_at = NOW(), updated_at = NOW()
        WHERE task_id = $1`,
      [r.task_id]
    );
    return true;
  }
  return false;
}

/** The daily task sweep. Each sub-sweep is isolated. */
async function runDailyTaskSweep() {
  try {
    await sweepAutoTasksFromHotLeads();
  } catch (err) {
    console.error("Hot-lead auto-task sweep errored:", err.message);
  }
  try {
    await sweepOverdueHighPriorityTasks();
  } catch (err) {
    console.error("Overdue-task alert sweep errored:", err.message);
  }
  try {
    await sweepStaleTaskCheckIns();
  } catch (err) {
    console.error("Stale-task check-in sweep errored:", err.message);
  }
}

module.exports = {
  RECURRENCES,
  PRIORITIES,
  sendOwnerSms,
  nextOccurrence,
  sweepPersonalReminders,
  sweepDueEchoReminders,
  sweepReminderFallbacks,
  settleReminder,
  runDailyTaskSweep,
  sweepAutoTasksFromHotLeads,
  sweepOverdueHighPriorityTasks,
  sweepStaleTaskCheckIns,
  // Per-row bodies, exported (and invoked via module.exports) so tests can
  // stub a throw and prove the per-item guards contain it.
  processDueReminderRow,
  processReminderFallbackRow,
  processHotLeadTaskRow,
  processOverdueTaskRow,
  processStaleTaskRow,
};
