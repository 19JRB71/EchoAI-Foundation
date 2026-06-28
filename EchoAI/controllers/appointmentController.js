const db = require("../config/db");
const { sendEmail } = require("../utils/email");
const { normalizeE164 } = require("../utils/phone");
const { buildClient } = require("../config/twilio");
const { decrypt } = require("../utils/encryption");
const googleController = require("./googleController");
const calendar = require("../config/googleCalendar");
const pushController = require("./pushController");
const mobilePushController = require("./mobilePushController");
const zapierController = require("./zapierController");
const followUpController = require("./followUpController");

const VALID_STATUSES = ["scheduled", "completed", "cancelled", "no_show"];
const VALID_SOURCES = ["manual", "chatbot", "phone"];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_HORIZON_DAYS = 30;

// ---------------------------------------------------------------------------
// Ownership helpers
// ---------------------------------------------------------------------------

/** Loads an owned brand (auth-scoped) or null. */
async function getOwnedBrand(userId, brandId) {
  const { rows } = await db.query(
    "SELECT brand_id, brand_name FROM brands WHERE brand_id = $1 AND user_id = $2",
    [brandId, userId],
  );
  return rows[0] || null;
}

/** Loads a brand + owner (no ownership check) — used by the AI wiring helpers. */
async function getBrandWithOwner(brandId) {
  const { rows } = await db.query(
    `SELECT b.brand_id, b.brand_name, b.user_id AS owner_user_id,
            u.email AS owner_email, u.business_name AS owner_business_name
     FROM brands b JOIN users u ON u.user_id = b.user_id
     WHERE b.brand_id = $1`,
    [brandId],
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Timezone helpers (no external tz library — uses the Intl API).
// ---------------------------------------------------------------------------

/** Offset (ms) of an IANA timezone at a given UTC instant. */
function tzOffsetMs(timeZone, date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUTC - date.getTime();
}

/** Converts a wall-clock time in a timezone to a UTC Date (DST-corrected). */
function zonedWallTimeToUtc(y, m, d, hh, mm, timeZone) {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  let offset = tzOffsetMs(timeZone, new Date(guess));
  let result = new Date(guess - offset);
  // One correction pass handles DST boundary edges.
  const offset2 = tzOffsetMs(timeZone, result);
  if (offset2 !== offset) result = new Date(guess - offset2);
  return result;
}

/** { year, month, day, weekday(0=Sun) } of a UTC instant in a timezone. */
function zonedDateParts(instant, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const map = {};
  for (const p of dtf.formatToParts(instant)) map[p.type] = p.value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: weekdayMap[map.weekday],
  };
}

/** Human-friendly label for a slot start, e.g. "Mon, Jul 6 at 2:00 PM". */
function slotLabel(instant, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

// ---------------------------------------------------------------------------
// Availability schedule loading
// ---------------------------------------------------------------------------

const DEFAULT_WEEKLY_HOURS = [
  { day: 1, start: "09:00", end: "17:00" },
  { day: 2, start: "09:00", end: "17:00" },
  { day: 3, start: "09:00", end: "17:00" },
  { day: 4, start: "09:00", end: "17:00" },
  { day: 5, start: "09:00", end: "17:00" },
];

async function loadSchedule(brandId) {
  const { rows } = await db.query(
    `SELECT timezone, slot_duration_minutes, buffer_minutes, weekly_hours
     FROM availability_schedules WHERE brand_id = $1`,
    [brandId],
  );
  const row = rows[0];
  if (!row) {
    return {
      timezone: "America/New_York",
      slotDurationMinutes: 30,
      bufferMinutes: 0,
      weeklyHours: DEFAULT_WEEKLY_HOURS,
      configured: false,
    };
  }
  return {
    timezone: row.timezone,
    slotDurationMinutes: row.slot_duration_minutes,
    bufferMinutes: row.buffer_minutes,
    weeklyHours: Array.isArray(row.weekly_hours) ? row.weekly_hours : [],
    configured: true,
  };
}

// ---------------------------------------------------------------------------
// Core: compute open slots for a brand over a window.
// ---------------------------------------------------------------------------

/**
 * Returns an array of { start, end, label } open slots between fromInstant and
 * toInstant for a brand: working hours minus past times, existing scheduled
 * appointments, blackout blocks, and (when connected) Google Calendar busy time.
 */
async function computeOpenSlots(brandId, opts = {}) {
  const schedule = await loadSchedule(brandId);
  const { weeklyHours, timezone, slotDurationMinutes, bufferMinutes } = schedule;
  if (!weeklyHours.length) return [];

  const now = Date.now();
  const fromInstant = Math.max(
    opts.fromInstant ? new Date(opts.fromInstant).getTime() : now,
    now,
  );
  const horizonCap = now + MAX_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  const toInstant = Math.min(
    opts.toInstant
      ? new Date(opts.toInstant).getTime()
      : now + 14 * 24 * 60 * 60 * 1000,
    horizonCap,
  );
  if (toInstant <= fromInstant) return [];

  const stepMs = (slotDurationMinutes + bufferMinutes) * 60 * 1000;
  const durMs = slotDurationMinutes * 60 * 1000;

  // Group windows by weekday for quick lookup.
  const byDay = {};
  for (const w of weeklyHours) {
    if (
      w == null ||
      typeof w.day !== "number" ||
      !TIME_RE.test(w.start || "") ||
      !TIME_RE.test(w.end || "")
    ) {
      continue;
    }
    (byDay[w.day] = byDay[w.day] || []).push(w);
  }

  // Generate candidate slots day by day in the brand's timezone.
  const candidates = [];
  for (let dayCursor = fromInstant; dayCursor <= toInstant; dayCursor += 24 * 60 * 60 * 1000) {
    const parts = zonedDateParts(new Date(dayCursor), timezone);
    const windows = byDay[parts.weekday] || [];
    for (const w of windows) {
      const [sh, sm] = w.start.split(":").map(Number);
      const [eh, em] = w.end.split(":").map(Number);
      const windowStart = zonedWallTimeToUtc(parts.year, parts.month, parts.day, sh, sm, timezone).getTime();
      const windowEnd = zonedWallTimeToUtc(parts.year, parts.month, parts.day, eh, em, timezone).getTime();
      for (let s = windowStart; s + durMs <= windowEnd + 1; s += stepMs) {
        const e = s + durMs;
        if (s < fromInstant || e > toInstant) continue;
        candidates.push({ start: s, end: e });
      }
    }
  }
  if (!candidates.length) return [];

  // Dedup + sort candidates (different windows can't overlap, but be safe).
  const seen = new Set();
  const sorted = candidates
    .filter((c) => (seen.has(c.start) ? false : seen.add(c.start)))
    .sort((a, b) => a.start - b.start);

  const rangeStartIso = new Date(fromInstant).toISOString();
  const rangeEndIso = new Date(toInstant).toISOString();

  // Existing scheduled appointments in range.
  const apptRows = (
    await db.query(
      `SELECT start_time, end_time FROM appointments
       WHERE brand_id = $1 AND status = 'scheduled'
         AND start_time < $3 AND end_time > $2`,
      [brandId, rangeStartIso, rangeEndIso],
    )
  ).rows.map((r) => ({
    start: new Date(r.start_time).getTime(),
    end: new Date(r.end_time).getTime(),
  }));

  // Blackout blocks in range.
  const blockRows = (
    await db.query(
      `SELECT start_time, end_time FROM availability_blocks
       WHERE brand_id = $1 AND start_time < $3 AND end_time > $2`,
      [brandId, rangeStartIso, rangeEndIso],
    )
  ).rows.map((r) => ({
    start: new Date(r.start_time).getTime(),
    end: new Date(r.end_time).getTime(),
  }));

  let busy = [...apptRows, ...blockRows];

  // Google Calendar busy times (only when the owner connected Google with the
  // calendar scope). `notConnected` means there's simply no calendar to consult
  // — that's fine. A real upstream failure must NOT be swallowed when the caller
  // is about to book (opts.strict): offering/booking a slot that collides with
  // the owner's real calendar is a silent double-book, so we fail closed.
  if (opts.ownerUserId) {
    try {
      const { accessToken, scope } = await googleController.getValidAccessToken(
        opts.ownerUserId,
      );
      if (calendar.hasCalendarScope(scope)) {
        const gbusy = await calendar.listBusyTimes(
          accessToken,
          rangeStartIso,
          rangeEndIso,
        );
        for (const b of gbusy) {
          busy.push({
            start: new Date(b.start).getTime(),
            end: new Date(b.end).getTime(),
          });
        }
      }
    } catch (err) {
      if (!err.notConnected) {
        console.error("Calendar busy lookup failed:", err.message);
        if (opts.strict) {
          const e = new Error("Could not verify calendar availability");
          e.calendarUnavailable = true;
          throw e;
        }
      }
    }
  }

  const overlapsBusy = (s, e) => busy.some((b) => s < b.end && e > b.start);

  return sorted
    .filter((c) => !overlapsBusy(c.start, c.end))
    .map((c) => ({
      start: new Date(c.start).toISOString(),
      end: new Date(c.end).toISOString(),
      label: slotLabel(new Date(c.start), timezone),
    }));
}

// ---------------------------------------------------------------------------
// Confirmations + calendar sync (best-effort; never throw to the caller)
// ---------------------------------------------------------------------------

/** Loads a brand's Twilio config (decrypted) or null. */
async function getTwilioConfig(brandId) {
  const { rows } = await db.query(
    `SELECT account_sid, auth_token_encrypted, phone_number
     FROM twilio_config WHERE brand_id = $1`,
    [brandId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    accountSid: row.account_sid,
    authToken: decrypt(row.auth_token_encrypted),
    phoneNumber: row.phone_number,
  };
}

function formatWhen(appt, timeZone) {
  return slotLabel(new Date(appt.start_time), timeZone || "America/New_York");
}

async function sendConfirmations(appt, brand, timeZone) {
  const when = formatWhen(appt, timeZone);
  const businessName = brand.brand_name || "the business";

  // Email the lead.
  if (appt.contact_email) {
    sendEmail({
      to: appt.contact_email,
      subject: `Your appointment with ${businessName} is confirmed`,
      html: `<p>Hi ${appt.contact_name || "there"},</p>
             <p>Your appointment with <strong>${businessName}</strong> is confirmed for:</p>
             <p style="font-size:16px"><strong>${when}</strong></p>
             ${appt.location ? `<p>Location: ${appt.location}</p>` : ""}
             <p>We look forward to speaking with you. If you need to reschedule, just reply to this email.</p>`,
    }).catch((err) => console.error("Appointment email (lead) failed:", err.message));
  }

  // Email the owner.
  if (brand.owner_email) {
    sendEmail({
      to: brand.owner_email,
      subject: `New appointment booked — ${when}`,
      html: `<p>A new appointment has been booked for <strong>${businessName}</strong>.</p>
             <p><strong>${when}</strong></p>
             <p>Contact: ${appt.contact_name || "—"}${
               appt.contact_email ? ` &lt;${appt.contact_email}&gt;` : ""
             }${appt.contact_phone ? ` · ${appt.contact_phone}` : ""}</p>
             <p>Source: ${appt.source}</p>`,
    }).catch((err) => console.error("Appointment email (owner) failed:", err.message));
  }

  // SMS the lead via the brand's own Twilio number (if configured).
  if (appt.contact_phone) {
    try {
      const cfg = await getTwilioConfig(brand.brand_id);
      if (cfg) {
        const client = buildClient(cfg.accountSid, cfg.authToken);
        await client.messages.create({
          to: appt.contact_phone,
          from: cfg.phoneNumber,
          body: `Your appointment with ${businessName} is confirmed for ${when}.`,
        });
      }
    } catch (err) {
      console.error("Appointment SMS (lead) failed:", err.message);
    }
  }

  // Push + mobile push to the owner.
  if (brand.owner_user_id) {
    pushController
      .sendPushToUser(brand.owner_user_id, {
        title: "📅 New appointment booked",
        body: `${appt.contact_name || "A lead"} — ${when}`,
        url: "/dashboard",
        tag: `appointment-${appt.appointment_id}`,
      })
      .catch((err) => console.error("Appointment push failed:", err.message));
    mobilePushController
      .sendToUser(brand.owner_user_id, {
        title: "📅 New appointment booked",
        body: `${appt.contact_name || "A lead"} — ${when}`,
        data: { type: "appointment_booked", appointmentId: String(appt.appointment_id) },
      })
      .catch((err) => console.error("Appointment mobile push failed:", err.message));
  }
}

async function syncToCalendar(appt, brand, timeZone) {
  if (!brand.owner_user_id) return null;
  try {
    const { accessToken, scope } = await googleController.getValidAccessToken(
      brand.owner_user_id,
    );
    if (!calendar.hasCalendarScope(scope)) return null;
    const eventId = await calendar.createEvent(accessToken, {
      summary: appt.title || `Appointment — ${brand.brand_name || ""}`.trim(),
      description: appt.description || `Booked via EchoAI (${appt.source}).`,
      location: appt.location || undefined,
      startIso: new Date(appt.start_time).toISOString(),
      endIso: new Date(appt.end_time).toISOString(),
      timeZone: timeZone || "America/New_York",
      attendeeEmails: appt.contact_email ? [appt.contact_email] : [],
    });
    return eventId;
  } catch (err) {
    if (!err.notConnected) console.error("Calendar sync failed:", err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core booking (shared by the dashboard and the AI wiring)
// ---------------------------------------------------------------------------

/**
 * Creates an appointment after re-validating the slot is still free. Serialized
 * per brand with an advisory lock; the partial unique index backstops exact
 * double-books. Returns { appointment } or { conflict: true } / { invalid }.
 * Fires confirmations + calendar sync after commit (best-effort).
 */
async function createBooking({
  brand,
  leadId = null,
  startIso,
  endIso,
  title,
  description,
  location,
  contactName,
  contactEmail,
  contactPhone,
  source,
}) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return { invalid: true };
  }
  if (start.getTime() < Date.now()) return { invalid: true };

  const phone = contactPhone ? normalizeE164(contactPhone) : null;
  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    // Serialize all bookings for this brand so concurrent requests can't both
    // pass the overlap check and create colliding appointments.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `appt:${brand.brand_id}`,
    ]);

    const overlap = await client.query(
      `SELECT 1 FROM appointments
       WHERE brand_id = $1 AND status = 'scheduled'
         AND start_time < $3 AND end_time > $2
       LIMIT 1`,
      [brand.brand_id, start.toISOString(), end.toISOString()],
    );
    if (overlap.rows.length > 0) {
      await client.query("ROLLBACK");
      return { conflict: true };
    }

    const inserted = await client.query(
      `INSERT INTO appointments
         (brand_id, lead_id, title, description, location, start_time, end_time,
          contact_name, contact_email, contact_phone, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        brand.brand_id,
        leadId,
        title || "Appointment",
        description || null,
        location || null,
        start.toISOString(),
        end.toISOString(),
        contactName || null,
        contactEmail || null,
        phone,
        VALID_SOURCES.includes(source) ? source : "manual",
      ],
    );
    await client.query("COMMIT");
    const appt = inserted.rows[0];

    const schedule = await loadSchedule(brand.brand_id);
    const eventId = await syncToCalendar(appt, brand, schedule.timezone);
    if (eventId) {
      await db
        .query("UPDATE appointments SET google_event_id = $1 WHERE appointment_id = $2", [
          eventId,
          appt.appointment_id,
        ])
        .catch((err) => console.error("Store calendar event id failed:", err.message));
      appt.google_event_id = eventId;
    }

    await sendConfirmations(appt, brand, schedule.timezone);

    // The lead booked — stop any running follow-up for them. Best-effort.
    if (leadId) {
      followUpController
        .cancelActiveSequencesForLead(leadId, "booked")
        .catch((err) => console.error("Follow-up stop (booked) failed:", err.message));
    }

    zapierController.triggerWebhook(brand.brand_id, "appointment_booked", {
      appointmentId: appt.appointment_id,
      startTime: appt.start_time,
      endTime: appt.end_time,
      contactName: appt.contact_name,
      contactEmail: appt.contact_email,
      contactPhone: appt.contact_phone,
      source: appt.source,
    });

    return { appointment: appt };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") return { conflict: true };
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// AI wiring helpers (used by the chatbot + phone controllers)
// ---------------------------------------------------------------------------

/**
 * Returns up to 3 real open slots for a brand for prompt injection, or [] when
 * none. Never throws — scheduling guidance is best-effort.
 */
async function getSlotsForBrand(brandId, ownerUserId) {
  try {
    const slots = await computeOpenSlots(brandId, { ownerUserId });
    return slots.slice(0, 3);
  } catch (err) {
    console.error("getSlotsForBrand failed:", err.message);
    return [];
  }
}

/**
 * Books a slot on behalf of a lead from a conversation (chatbot/phone). The
 * startIso MUST match one of the brand's currently-open slots (re-validated),
 * so the AI can never book a made-up time. Returns the same shape as
 * createBooking, or { invalid } when the slot isn't actually open.
 */
async function bookForLead({ brandId, leadId, startIso, source, contact = {} }) {
  const brand = await getBrandWithOwner(brandId);
  if (!brand) return { invalid: true };

  // Re-validate the requested time against currently-open slots. `strict` makes
  // this fail closed if the owner's Google calendar can't be reached, so the AI
  // never books over a real (but unverifiable) busy block.
  let slots;
  try {
    slots = await computeOpenSlots(brandId, {
      ownerUserId: brand.owner_user_id,
      strict: true,
    });
  } catch (err) {
    console.error("bookForLead availability check failed:", err.message);
    return { invalid: true };
  }
  const match = slots.find((s) => s.start === startIso);
  if (!match) return { invalid: true };

  // Pull any contact details we already have on the lead to fill blanks.
  let leadRow = null;
  if (leadId) {
    const { rows } = await db.query(
      "SELECT lead_name, email, phone FROM leads WHERE lead_id = $1 AND brand_id = $2",
      [leadId, brandId],
    );
    leadRow = rows[0] || null;
  }

  return createBooking({
    brand,
    leadId: leadId || null,
    startIso: match.start,
    endIso: match.end,
    title: `Appointment — ${brand.brand_name || ""}`.trim(),
    contactName: contact.name || (leadRow && leadRow.lead_name) || null,
    contactEmail: contact.email || (leadRow && leadRow.email) || null,
    contactPhone: contact.phone || (leadRow && leadRow.phone) || null,
    source: source || "chatbot",
  });
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

/** GET /api/appointments/slots/:brandId?from=&to= */
async function getOpenSlots(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const slots = await computeOpenSlots(brandId, {
      ownerUserId: userId,
      fromInstant: req.query.from,
      toInstant: req.query.to,
    });
    return res.json({ slots });
  } catch (err) {
    console.error("getOpenSlots error:", err.message);
    return res.status(500).json({ error: "Failed to load availability" });
  }
}

/** GET /api/appointments/config/:brandId */
async function getAvailabilityConfig(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const schedule = await loadSchedule(brandId);
    const blocks = (
      await db.query(
        `SELECT block_id, start_time, end_time, reason
         FROM availability_blocks
         WHERE brand_id = $1 AND end_time > NOW()
         ORDER BY start_time ASC`,
        [brandId],
      )
    ).rows;

    // Calendar connection status (best-effort).
    let calendarConnected = false;
    try {
      const { scope } = await googleController.getValidAccessToken(userId);
      calendarConnected = calendar.hasCalendarScope(scope);
    } catch {
      calendarConnected = false;
    }

    return res.json({
      brandId,
      timezone: schedule.timezone,
      slotDurationMinutes: schedule.slotDurationMinutes,
      bufferMinutes: schedule.bufferMinutes,
      weeklyHours: schedule.weeklyHours,
      configured: schedule.configured,
      blocks,
      calendarConnected,
    });
  } catch (err) {
    console.error("getAvailabilityConfig error:", err.message);
    return res.status(500).json({ error: "Failed to load availability config" });
  }
}

function validateWeeklyHours(weeklyHours) {
  if (!Array.isArray(weeklyHours)) return "weeklyHours must be an array";
  for (const w of weeklyHours) {
    if (
      !w ||
      typeof w.day !== "number" ||
      w.day < 0 ||
      w.day > 6 ||
      !TIME_RE.test(w.start || "") ||
      !TIME_RE.test(w.end || "")
    ) {
      return "Each availability window needs day (0-6) and start/end as HH:MM";
    }
    if (w.start >= w.end) return "Each window's start must be before its end";
  }
  return null;
}

/** PUT /api/appointments/config/:brandId */
async function saveAvailabilityConfig(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  const { timezone, slotDurationMinutes, bufferMinutes, weeklyHours } = req.body || {};

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    if (!timezone || typeof timezone !== "string") {
      return res.status(400).json({ error: "timezone is required" });
    }
    // Validate the timezone is a real IANA zone.
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      return res.status(400).json({ error: "Invalid timezone" });
    }
    const slot = Number(slotDurationMinutes);
    if (!Number.isInteger(slot) || slot < 5 || slot > 480) {
      return res.status(400).json({ error: "slotDurationMinutes must be 5-480" });
    }
    const buffer = Number(bufferMinutes || 0);
    if (!Number.isInteger(buffer) || buffer < 0 || buffer > 240) {
      return res.status(400).json({ error: "bufferMinutes must be 0-240" });
    }
    const whError = validateWeeklyHours(weeklyHours);
    if (whError) return res.status(400).json({ error: whError });

    await db.query(
      `INSERT INTO availability_schedules
         (brand_id, timezone, slot_duration_minutes, buffer_minutes, weekly_hours)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (brand_id) DO UPDATE SET
         timezone = EXCLUDED.timezone,
         slot_duration_minutes = EXCLUDED.slot_duration_minutes,
         buffer_minutes = EXCLUDED.buffer_minutes,
         weekly_hours = EXCLUDED.weekly_hours`,
      [brandId, timezone, slot, buffer, JSON.stringify(weeklyHours)],
    );

    return res.json({ brandId, saved: true });
  } catch (err) {
    console.error("saveAvailabilityConfig error:", err.message);
    return res.status(500).json({ error: "Failed to save availability config" });
  }
}

/** POST /api/appointments/blocks  { brandId, startTime, endTime, reason? } */
async function addBlock(req, res) {
  const userId = req.user.userId;
  const { brandId, startTime, endTime, reason } = req.body || {};
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return res.status(400).json({ error: "Valid startTime and endTime are required" });
    }

    const { rows } = await db.query(
      `INSERT INTO availability_blocks (brand_id, start_time, end_time, reason)
       VALUES ($1, $2, $3, $4)
       RETURNING block_id, start_time, end_time, reason`,
      [brandId, start.toISOString(), end.toISOString(), reason ? String(reason).slice(0, 255) : null],
    );
    return res.status(201).json({ block: rows[0] });
  } catch (err) {
    console.error("addBlock error:", err.message);
    return res.status(500).json({ error: "Failed to add blackout block" });
  }
}

/** DELETE /api/appointments/blocks/:blockId */
async function deleteBlock(req, res) {
  const userId = req.user.userId;
  const { blockId } = req.params;
  try {
    const { rowCount } = await db.query(
      `DELETE FROM availability_blocks ab
       USING brands b
       WHERE ab.block_id = $1 AND ab.brand_id = b.brand_id AND b.user_id = $2`,
      [blockId, userId],
    );
    if (rowCount === 0) return res.status(404).json({ error: "Block not found" });
    return res.json({ deleted: true });
  } catch (err) {
    console.error("deleteBlock error:", err.message);
    return res.status(500).json({ error: "Failed to delete block" });
  }
}

/** GET /api/appointments/list/:brandId?status=&from=&to= */
async function getAppointments(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  const { status, from, to } = req.query;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const clauses = ["a.brand_id = $1"];
    const params = [brandId];
    if (status && VALID_STATUSES.includes(status)) {
      params.push(status);
      clauses.push(`a.status = $${params.length}`);
    }
    if (from) {
      params.push(new Date(from).toISOString());
      clauses.push(`a.start_time >= $${params.length}`);
    }
    if (to) {
      params.push(new Date(to).toISOString());
      clauses.push(`a.start_time <= $${params.length}`);
    }

    const { rows } = await db.query(
      `SELECT a.appointment_id, a.lead_id, a.title, a.description, a.location,
              a.start_time, a.end_time, a.status, a.contact_name, a.contact_email,
              a.contact_phone, a.source, a.google_event_id, a.created_at,
              l.lead_name
       FROM appointments a
       LEFT JOIN leads l ON l.lead_id = a.lead_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY a.start_time ASC
       LIMIT 500`,
      params,
    );
    const schedule = await loadSchedule(brandId);
    return res.json({ appointments: rows, timezone: schedule.timezone });
  } catch (err) {
    console.error("getAppointments error:", err.message);
    return res.status(500).json({ error: "Failed to load appointments" });
  }
}

/** POST /api/appointments  (manual booking from the dashboard) */
async function bookAppointment(req, res) {
  const userId = req.user.userId;
  const {
    brandId,
    leadId,
    startTime,
    endTime,
    title,
    description,
    location,
    contactName,
    contactEmail,
    contactPhone,
  } = req.body || {};
  try {
    const ownedBrand = await getOwnedBrand(userId, brandId);
    if (!ownedBrand) return res.status(404).json({ error: "Brand not found" });
    if (!startTime || !endTime) {
      return res.status(400).json({ error: "startTime and endTime are required" });
    }

    // If a lead is supplied, verify it belongs to this brand.
    if (leadId) {
      const { rows } = await db.query(
        "SELECT lead_id FROM leads WHERE lead_id = $1 AND brand_id = $2",
        [leadId, brandId],
      );
      if (!rows[0]) return res.status(404).json({ error: "Lead not found" });
    }

    const brand = await getBrandWithOwner(brandId);
    const result = await createBooking({
      brand,
      leadId: leadId || null,
      startIso: new Date(startTime).toISOString(),
      endIso: new Date(endTime).toISOString(),
      title,
      description,
      location,
      contactName,
      contactEmail,
      contactPhone,
      source: "manual",
    });

    if (result.invalid) {
      return res.status(400).json({ error: "Invalid appointment time" });
    }
    if (result.conflict) {
      return res.status(409).json({ error: "That time is no longer available" });
    }
    return res.status(201).json({ appointment: result.appointment });
  } catch (err) {
    console.error("bookAppointment error:", err.message);
    return res.status(500).json({ error: "Failed to book appointment" });
  }
}

/**
 * PATCH /api/appointments/:appointmentId
 * Body: { status } to cancel/complete/no-show, OR { startTime, endTime } to
 * reschedule. Owner-initiated, so (like manual booking) the new time may fall
 * outside published hours; it is still serialized + overlap-checked under the
 * per-brand advisory lock and keeps the calendar event + confirmations in sync.
 */
async function updateAppointment(req, res) {
  const userId = req.user.userId;
  const { appointmentId } = req.params;
  const { status, startTime, endTime } = req.body || {};
  try {
    // Load + verify ownership.
    const { rows } = await db.query(
      `SELECT a.* FROM appointments a
       JOIN brands b ON b.brand_id = a.brand_id
       WHERE a.appointment_id = $1 AND b.user_id = $2`,
      [appointmentId, userId],
    );
    const appt = rows[0];
    if (!appt) return res.status(404).json({ error: "Appointment not found" });

    const brand = await getBrandWithOwner(appt.brand_id);
    const schedule = await loadSchedule(appt.brand_id);

    // Status change (cancel/complete/no-show).
    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      await db.query(
        "UPDATE appointments SET status = $1 WHERE appointment_id = $2",
        [status, appointmentId],
      );
      // Remove the calendar event when an appointment is cancelled.
      if (status === "cancelled" && appt.google_event_id && brand.owner_user_id) {
        try {
          const { accessToken, scope } = await googleController.getValidAccessToken(
            brand.owner_user_id,
          );
          if (calendar.hasCalendarScope(scope)) {
            await calendar.deleteEvent(accessToken, appt.google_event_id);
          }
        } catch (err) {
          if (!err.notConnected) console.error("Calendar delete failed:", err.message);
        }
      }
      return res.json({ updated: true, status });
    }

    // Reschedule.
    if (startTime && endTime) {
      const start = new Date(startTime);
      const end = new Date(endTime);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        return res.status(400).json({ error: "Valid startTime and endTime are required" });
      }
      if (start.getTime() < Date.now()) {
        return res.status(400).json({ error: "Cannot reschedule to a past time" });
      }

      // Serialize against concurrent bookings/reschedules for this brand with the
      // same per-brand advisory lock createBooking uses, so two writers can't both
      // pass the overlap check and create colliding windows. The partial unique
      // index backstops exact double-books.
      let newAppt;
      const client = await db.getClient();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`appt:${appt.brand_id}`],
        );
        const overlap = await client.query(
          `SELECT 1 FROM appointments
           WHERE brand_id = $1 AND status = 'scheduled' AND appointment_id <> $4
             AND start_time < $3 AND end_time > $2
           LIMIT 1`,
          [appt.brand_id, start.toISOString(), end.toISOString(), appointmentId],
        );
        if (overlap.rows.length > 0) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "That time is no longer available" });
        }
        const updated = await client.query(
          `UPDATE appointments
           SET start_time = $1, end_time = $2, status = 'scheduled'
           WHERE appointment_id = $3
           RETURNING *`,
          [start.toISOString(), end.toISOString(), appointmentId],
        );
        await client.query("COMMIT");
        newAppt = updated.rows[0];
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        if (err.code === "23505") {
          return res.status(409).json({ error: "That time is no longer available" });
        }
        throw err;
      } finally {
        client.release();
      }

      // Re-sync calendar + notify (best-effort).
      const eventId = await syncToCalendar(newAppt, brand, schedule.timezone);
      if (eventId) {
        await db
          .query("UPDATE appointments SET google_event_id = $1 WHERE appointment_id = $2", [
            eventId,
            appointmentId,
          ])
          .catch(() => {});
        newAppt.google_event_id = eventId;
      }
      await sendConfirmations(newAppt, brand, schedule.timezone);

      return res.json({ updated: true, appointment: newAppt });
    }

    return res.status(400).json({ error: "Provide a status or a new startTime/endTime" });
  } catch (err) {
    console.error("updateAppointment error:", err.message);
    return res.status(500).json({ error: "Failed to update appointment" });
  }
}

module.exports = {
  // HTTP handlers
  getOpenSlots,
  getAvailabilityConfig,
  saveAvailabilityConfig,
  addBlock,
  deleteBlock,
  getAppointments,
  bookAppointment,
  updateAppointment,
  // AI wiring helpers
  computeOpenSlots,
  getSlotsForBrand,
  bookForLead,
};
