const db = require("../config/db");
const { sendEmail } = require("../utils/email");
const { buildClient, getPublicBaseUrl } = require("../config/twilio");
const { decrypt } = require("../utils/encryption");
const { isOptedOut } = require("../utils/smsOptOut");
const { meetsTier } = require("../config/tiers");
const {
  generateFollowUpSequence,
  MAX_TOUCHPOINTS,
  MAX_DAYS,
} = require("../prompts/followUpSequencePrompt");

const VALID_CHANNELS = ["email", "sms", "phone"];

// Temperature ranking used to detect the cold -> warm/hot qualification
// transition that auto-enrolls a lead.
function tempRank(t) {
  if (t === "hot") return 2;
  if (t === "warm") return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Ownership helpers
// ---------------------------------------------------------------------------

async function getOwnedBrand(brandId, userId) {
  const result = await db.query(
    `SELECT brand_id, brand_name, brand_personality, voice_description, target_audience
     FROM brands
     WHERE brand_id = $1 AND user_id = $2`,
    [brandId, userId],
  );
  return result.rows[0] || null;
}

async function getOwnedLead(leadId, userId) {
  const result = await db.query(
    `SELECT l.lead_id, l.brand_id, l.lead_name, l.email, l.phone, l.temperature,
            l.conversion_status
     FROM leads l
     JOIN brands b ON b.brand_id = l.brand_id
     WHERE l.lead_id = $1 AND b.user_id = $2`,
    [leadId, userId],
  );
  return result.rows[0] || null;
}

/** Loads a brand row (no ownership check) for internal/auto enrollment. */
async function getBrandRow(brandId) {
  const result = await db.query(
    `SELECT brand_id, brand_name, brand_personality, voice_description, target_audience
     FROM brands WHERE brand_id = $1`,
    [brandId],
  );
  return result.rows[0] || null;
}

/**
 * Returns true when the brand's owner is entitled to follow-up automation
 * (Professional tier or above, or an admin). Auto-enrollment runs from the
 * qualification flows OUTSIDE the tier-gated HTTP routes, so it must enforce the
 * gate itself or a non-Pro account would get a Pro feature for free.
 */
async function brandOwnerHasFollowUps(brandId) {
  const { rows } = await db.query(
    `SELECT u.role AS role, s.subscription_tier AS tier
     FROM brands br
     JOIN users u ON u.user_id = br.user_id
     LEFT JOIN subscriptions s ON s.user_id = u.user_id
     WHERE br.brand_id = $1`,
    [brandId],
  );
  const row = rows[0];
  if (!row) return false;
  if (row.role === "admin") return true;
  return meetsTier(row.tier || "free", "pro");
}

/** Loads a brand's stored Twilio credentials, decrypted, or null. */
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

// ---------------------------------------------------------------------------
// Validation / normalization
// ---------------------------------------------------------------------------

/**
 * Validates and normalizes a list of touchpoints (from the AI or a client save).
 * Returns a cleaned, day-ordered array with sequential step numbers, or throws
 * if the shape is invalid so no bad data reaches the DB or a send.
 *
 * `allowedChannels` defaults to all; when a lead has no phone it is restricted
 * to ["email"] so we never schedule an SMS/phone touchpoint we can't deliver.
 */
function validateTouchpoints(touchpoints, allowedChannels = VALID_CHANNELS) {
  if (!Array.isArray(touchpoints) || touchpoints.length === 0) {
    throw new Error("A follow-up sequence must contain at least one touchpoint");
  }
  if (touchpoints.length > MAX_TOUCHPOINTS) {
    throw new Error(`A follow-up sequence can have at most ${MAX_TOUCHPOINTS} touchpoints`);
  }

  const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

  const cleaned = touchpoints.map((tp, i) => {
    if (!tp || typeof tp !== "object") {
      throw new Error(`Touchpoint ${i + 1} is not a valid object`);
    }
    const channel = str(tp.channel).toLowerCase().trim();
    if (!VALID_CHANNELS.includes(channel)) {
      throw new Error(`Touchpoint ${i + 1} has an invalid channel "${tp.channel}"`);
    }
    if (!allowedChannels.includes(channel)) {
      throw new Error(
        `Touchpoint ${i + 1} uses channel "${channel}" which is not available for this lead`,
      );
    }

    let dayOffset = Math.round(Number(tp.dayOffset));
    if (!Number.isFinite(dayOffset)) {
      throw new Error(`Touchpoint ${i + 1} has an invalid dayOffset`);
    }
    if (dayOffset < 0) dayOffset = 0;
    if (dayOffset > MAX_DAYS) {
      throw new Error(`Touchpoint ${i + 1} is scheduled beyond ${MAX_DAYS} days`);
    }

    const body = str(tp.message != null ? tp.message : tp.body).trim();
    if (!body) throw new Error(`Touchpoint ${i + 1} is missing a message`);

    let subject = str(tp.subject).trim();
    if (channel === "email" && !subject) {
      subject = "Following up";
    }

    return { channel, dayOffset, subject, body };
  });

  // Order by day, then assign sequential step numbers.
  cleaned.sort((a, b) => a.dayOffset - b.dayOffset);
  return cleaned.map((tp, i) => ({ ...tp, stepNumber: i + 1 }));
}

/**
 * Persists a validated sequence + its touchpoints in one transaction and
 * activates it. scheduled_at is computed from each touchpoint's dayOffset
 * relative to enrollment (now). Throws on the unique-violation backstop when the
 * lead already has a running sequence (caller maps to 409 / skips).
 */
async function persistSequence({ brandId, leadId, goal, sequenceType, touchpoints, source }) {
  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    // Apply the brand's learned follow-up timing factor (set by Autonomous
    // Growth from the recent response rate): <1 sends touchpoints sooner, >1
    // spaces them out. Defaults to 1.0 when no state exists yet. Step 0 (day 0)
    // stays immediate regardless.
    let timingFactor = 1.0;
    try {
      const stateRes = await client.query(
        "SELECT followup_timing_factor FROM growth_brand_state WHERE brand_id = $1",
        [brandId],
      );
      if (stateRes.rows[0] && stateRes.rows[0].followup_timing_factor != null) {
        const f = Number(stateRes.rows[0].followup_timing_factor);
        if (Number.isFinite(f) && f > 0) timingFactor = f;
      }
    } catch (_) {
      /* growth_brand_state may not exist in some deployments — default to 1.0 */
    }

    const seqResult = await client.query(
      `INSERT INTO follow_up_sequences
         (brand_id, lead_id, goal, sequence_type, status, current_step, total_steps, source)
       VALUES ($1, $2, $3, $4, 'active', 0, $5, $6)
       RETURNING sequence_id, brand_id, lead_id, goal, sequence_type, status,
                 current_step, total_steps, source, started_at, created_at`,
      [brandId, leadId, goal, sequenceType, touchpoints.length, source],
    );
    const sequence = seqResult.rows[0];

    for (const tp of touchpoints) {
      const scheduledOffset = Math.round((Number(tp.dayOffset) || 0) * timingFactor);
      await client.query(
        `INSERT INTO sequence_touchpoints
           (sequence_id, step_number, channel, scheduled_at, subject, body)
         VALUES ($1, $2, $3, NOW() + ($4 || ' days')::interval, $5, $6)`,
        [sequence.sequence_id, tp.stepNumber, tp.channel, String(scheduledOffset), tp.subject || null, tp.body],
      );
    }

    await client.query("COMMIT");
    return sequence;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

/**
 * POST /api/follow-ups/generate  { brandId, leadId, goal }
 * Generates (but does not persist) a follow-up sequence preview for review.
 */
async function generateSequence(req, res) {
  const userId = req.user.userId;
  const { brandId, leadId, goal } = req.body || {};

  if (!brandId || !leadId) {
    return res.status(400).json({ error: "brandId and leadId are required" });
  }

  try {
    const brand = await getOwnedBrand(brandId, userId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const lead = await getOwnedLead(leadId, userId);
    if (!lead || lead.brand_id !== brandId) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const allowed = lead.phone ? VALID_CHANNELS : ["email"];
    if (!lead.email && !lead.phone) {
      return res.status(400).json({
        error: "This lead has no email or phone on file, so no follow-up can be sent.",
      });
    }

    // AI generation + validation of the AI's output. ANY failure here is an
    // upstream AI problem (rate/billing/malformed output), so it maps to 502 —
    // never a generic 500 and never a mocked fallback.
    let touchpoints;
    try {
      const raw = await generateFollowUpSequence(brand, lead, {
        goal: goal || "reengage",
        maxTouchpoints: MAX_TOUCHPOINTS,
      });
      touchpoints = validateTouchpoints(raw, allowed);
    } catch (err) {
      console.error("Generate follow-up sequence (AI) error:", err.message);
      return res.status(502).json({
        error:
          "The AI provider could not generate a valid follow-up sequence right now. Please try again shortly.",
      });
    }

    return res.json({
      brandId,
      leadId,
      goal: goal || "reengage",
      count: touchpoints.length,
      touchpoints,
    });
  } catch (err) {
    console.error("Generate follow-up sequence error:", err.message);
    return res.status(500).json({ error: "Failed to generate follow-up sequence" });
  }
}

/**
 * POST /api/follow-ups  { brandId, leadId, goal, sequenceType, touchpoints }
 * Saves a sequence and activates it.
 */
async function saveAndActivate(req, res) {
  const userId = req.user.userId;
  const { brandId, leadId, goal, sequenceType, touchpoints } = req.body || {};

  if (!brandId || !leadId || !Array.isArray(touchpoints)) {
    return res
      .status(400)
      .json({ error: "brandId, leadId, and touchpoints are required" });
  }

  try {
    const brand = await getOwnedBrand(brandId, userId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const lead = await getOwnedLead(leadId, userId);
    if (!lead || lead.brand_id !== brandId) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const allowed = lead.phone ? VALID_CHANNELS : ["email"];
    let cleaned;
    try {
      cleaned = validateTouchpoints(touchpoints, allowed);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const sequence = await persistSequence({
      brandId,
      leadId,
      goal: goal || "reengage",
      sequenceType: sequenceType || "nurture",
      touchpoints: cleaned,
      source: "manual",
    });

    return res.status(201).json({ sequence });
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ error: "This lead already has a running follow-up sequence." });
    }
    console.error("Save follow-up sequence error:", err.message);
    return res.status(500).json({ error: "Failed to save follow-up sequence" });
  }
}

/**
 * GET /api/follow-ups?brandId=...&status=...
 * Lists a brand's sequences with lead info and progress counts.
 */
async function getSequences(req, res) {
  const userId = req.user.userId;
  const { brandId, status } = req.query;

  if (!brandId) {
    return res.status(400).json({ error: "brandId query parameter is required" });
  }

  try {
    const brand = await getOwnedBrand(brandId, userId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const params = [brandId, userId];
    let sql = `
      SELECT s.sequence_id, s.brand_id, s.lead_id, s.goal, s.sequence_type,
             s.status, s.current_step, s.total_steps, s.source, s.stop_reason,
             s.started_at, s.created_at, s.updated_at,
             l.lead_name, l.email AS lead_email, l.phone AS lead_phone,
             l.temperature,
             COUNT(t.touchpoint_id) FILTER (WHERE t.status = 'sent') AS sent_count,
             COUNT(t.touchpoint_id) AS touchpoint_count,
             MIN(t.scheduled_at) FILTER (WHERE t.status = 'pending') AS next_touchpoint_at
      FROM follow_up_sequences s
      JOIN brands b ON b.brand_id = s.brand_id
      LEFT JOIN leads l ON l.lead_id = s.lead_id
      LEFT JOIN sequence_touchpoints t ON t.sequence_id = s.sequence_id
      WHERE s.brand_id = $1 AND b.user_id = $2`;

    if (status) {
      params.push(status);
      sql += ` AND s.status = $${params.length}`;
    }

    sql += `
      GROUP BY s.sequence_id, l.lead_name, l.email, l.phone, l.temperature
      ORDER BY s.created_at DESC`;

    const result = await db.query(sql, params);
    return res.json({ count: result.rows.length, sequences: result.rows });
  } catch (err) {
    console.error("Get follow-up sequences error:", err.message);
    return res.status(500).json({ error: "Failed to fetch follow-up sequences" });
  }
}

/**
 * GET /api/follow-ups/:sequenceId
 * Returns one sequence with its ordered touchpoints.
 */
async function getSequenceDetail(req, res) {
  const userId = req.user.userId;
  const { sequenceId } = req.params;

  try {
    const seqResult = await db.query(
      `SELECT s.*, l.lead_name, l.email AS lead_email, l.phone AS lead_phone,
              l.temperature, l.conversion_status
       FROM follow_up_sequences s
       JOIN brands b ON b.brand_id = s.brand_id
       LEFT JOIN leads l ON l.lead_id = s.lead_id
       WHERE s.sequence_id = $1 AND b.user_id = $2`,
      [sequenceId, userId],
    );
    const sequence = seqResult.rows[0];
    if (!sequence) return res.status(404).json({ error: "Sequence not found" });

    const touchpoints = await db.query(
      `SELECT touchpoint_id, step_number, channel, scheduled_at, status, subject,
              body, sent_at, error, created_at
       FROM sequence_touchpoints
       WHERE sequence_id = $1
       ORDER BY step_number ASC`,
      [sequenceId],
    );

    return res.json({ sequence, touchpoints: touchpoints.rows });
  } catch (err) {
    console.error("Get follow-up sequence detail error:", err.message);
    return res.status(500).json({ error: "Failed to fetch follow-up sequence" });
  }
}

/** Shared status-change handler for pause / resume / cancel. */
async function changeStatus(req, res, { from, to, notFoundMsg }) {
  const userId = req.user.userId;
  const { sequenceId } = req.params;

  try {
    const result = await db.query(
      `UPDATE follow_up_sequences s
       SET status = $1
       FROM brands b
       WHERE s.brand_id = b.brand_id
         AND s.sequence_id = $2
         AND b.user_id = $3
         AND s.status = ANY($4::follow_up_status[])
       RETURNING s.sequence_id, s.status, s.current_step, s.total_steps`,
      [to, sequenceId, userId, from],
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ error: notFoundMsg });
    }
    return res.json({ sequence: result.rows[0] });
  } catch (err) {
    console.error(`Follow-up ${to} error:`, err.message);
    return res.status(500).json({ error: `Failed to ${to} sequence` });
  }
}

function pauseSequence(req, res) {
  return changeStatus(req, res, {
    from: ["active"],
    to: "paused",
    notFoundMsg: "Only an active sequence can be paused.",
  });
}

function resumeSequence(req, res) {
  return changeStatus(req, res, {
    from: ["paused"],
    to: "active",
    notFoundMsg: "Only a paused sequence can be resumed.",
  });
}

function cancelSequence(req, res) {
  return changeStatus(req, res, {
    from: ["active", "paused"],
    to: "cancelled",
    notFoundMsg: "Only a running sequence can be cancelled.",
  });
}

// ---------------------------------------------------------------------------
// Touchpoint delivery (scheduler)
// ---------------------------------------------------------------------------

function htmlifyBody(body) {
  const escaped = String(body)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Places an outbound AI phone-agent call for a phone touchpoint. */
async function placeFollowUpCall(brand, lead, cfg) {
  const baseUrl = getPublicBaseUrl(null);
  if (!baseUrl) {
    throw new Error("Server public URL is not configured for Twilio webhooks");
  }

  const callInsert = await db.query(
    `INSERT INTO calls (brand_id, lead_id, direction, caller_phone, status)
     VALUES ($1, $2, 'outbound', $3, 'in_progress')
     RETURNING call_id`,
    [brand.brand_id, lead.lead_id, lead.phone],
  );
  const callId = callInsert.rows[0].call_id;

  try {
    const client = buildClient(cfg.accountSid, cfg.authToken);
    const call = await client.calls.create({
      to: lead.phone,
      from: cfg.phoneNumber,
      url: `${baseUrl}/api/phone/voice/${callId}`,
      method: "POST",
      statusCallback: `${baseUrl}/api/phone/status`,
      statusCallbackEvent: ["completed", "no-answer", "busy", "failed"],
      statusCallbackMethod: "POST",
    });
    await db.query("UPDATE calls SET twilio_call_sid = $1 WHERE call_id = $2", [
      call.sid,
      callId,
    ]);
  } catch (err) {
    await db.query(
      "UPDATE calls SET status = 'failed', outcome = 'failed' WHERE call_id = $1",
      [callId],
    );
    throw err;
  }
}

/**
 * Delivers a single touchpoint. Returns { status: 'sent' | 'skipped', reason? }.
 * Throws on a real delivery failure so the caller records it as 'failed'.
 */
async function deliverTouchpoint(tp, lead, brand) {
  const businessName = brand.brand_name || "us";

  if (tp.channel === "email") {
    if (!lead.email) return { status: "skipped", reason: "no email on file" };
    await sendEmail({
      to: lead.email,
      subject: tp.subject || `Following up from ${businessName}`,
      html: htmlifyBody(tp.body),
    });
    return { status: "sent" };
  }

  if (tp.channel === "sms") {
    if (!lead.phone) return { status: "skipped", reason: "no phone on file" };
    if (await isOptedOut(brand.brand_id, lead.phone)) {
      return { status: "skipped", reason: "opted out of SMS" };
    }
    const cfg = await getTwilioConfig(brand.brand_id);
    if (!cfg) return { status: "skipped", reason: "Twilio not connected" };
    const client = buildClient(cfg.accountSid, cfg.authToken);
    await client.messages.create({
      to: lead.phone,
      from: cfg.phoneNumber,
      body: tp.body,
    });
    return { status: "sent" };
  }

  if (tp.channel === "phone") {
    if (!lead.phone) return { status: "skipped", reason: "no phone on file" };
    const cfg = await getTwilioConfig(brand.brand_id);
    if (!cfg) return { status: "skipped", reason: "Twilio not connected" };
    await placeFollowUpCall(brand, lead, cfg);
    return { status: "sent" };
  }

  return { status: "skipped", reason: "unknown channel" };
}

/**
 * Processes one due touchpoint atomically: the row is claimed with FOR UPDATE
 * SKIP LOCKED inside a transaction (so overlapping scheduler ticks can't both
 * send it), delivered, marked sent/skipped/failed, and the parent sequence's
 * progress advanced — completing it when no pending touchpoints remain.
 */
async function executeOneTouchpoint(touchpointId) {
  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    const claim = await client.query(
      `SELECT t.touchpoint_id, t.sequence_id, t.step_number, t.channel,
              t.subject, t.body, s.brand_id, s.lead_id
       FROM sequence_touchpoints t
       JOIN follow_up_sequences s ON s.sequence_id = t.sequence_id
       WHERE t.touchpoint_id = $1
         AND t.status = 'pending'
         AND t.scheduled_at <= NOW()
         AND s.status = 'active'
       FOR UPDATE OF t SKIP LOCKED`,
      [touchpointId],
    );
    const tp = claim.rows[0];
    if (!tp) {
      await client.query("ROLLBACK");
      return;
    }

    const leadResult = await client.query(
      `SELECT l.lead_id, l.lead_name, l.email, l.phone,
              b.brand_id, b.brand_name
       FROM leads l
       JOIN brands b ON b.brand_id = l.brand_id
       WHERE l.lead_id = $1`,
      [tp.lead_id],
    );
    const row = leadResult.rows[0];

    let outcome = { status: "skipped", reason: "lead not found" };
    let errorMsg = null;
    if (row) {
      const lead = {
        lead_id: row.lead_id,
        lead_name: row.lead_name,
        email: row.email,
        phone: row.phone,
      };
      const brand = { brand_id: row.brand_id, brand_name: row.brand_name };
      try {
        outcome = await deliverTouchpoint(tp, lead, brand);
      } catch (err) {
        outcome = { status: "failed" };
        errorMsg = err.message;
        console.error(
          `Follow-up touchpoint ${tp.touchpoint_id} (${tp.channel}) failed:`,
          err.message,
        );
      }
    }

    await client.query(
      `UPDATE sequence_touchpoints
       SET status = $1, sent_at = NOW(), error = $2
       WHERE touchpoint_id = $3`,
      [outcome.status, errorMsg || outcome.reason || null, tp.touchpoint_id],
    );

    await client.query(
      `UPDATE follow_up_sequences SET current_step = $1 WHERE sequence_id = $2`,
      [tp.step_number, tp.sequence_id],
    );

    const remaining = await client.query(
      `SELECT 1 FROM sequence_touchpoints
       WHERE sequence_id = $1 AND status = 'pending' LIMIT 1`,
      [tp.sequence_id],
    );
    if (remaining.rows.length === 0) {
      await client.query(
        `UPDATE follow_up_sequences SET status = 'completed'
         WHERE sequence_id = $1 AND status = 'active'`,
        [tp.sequence_id],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Scheduler entry point: finds due pending touchpoints whose sequence is still
 * active and processes each one. Per-touchpoint failures are isolated so one bad
 * send never stops the rest of the run.
 */
async function executeDueTouchpoints() {
  const due = await db.query(
    `SELECT t.touchpoint_id
     FROM sequence_touchpoints t
     JOIN follow_up_sequences s ON s.sequence_id = t.sequence_id
     JOIN brands b ON b.brand_id = s.brand_id
     WHERE t.status = 'pending'
       AND t.scheduled_at <= NOW()
       AND s.status = 'active'
       AND b.is_demo = false
     ORDER BY t.scheduled_at ASC
     LIMIT 100`,
  );

  let processed = 0;
  for (const { touchpoint_id } of due.rows) {
    try {
      await executeOneTouchpoint(touchpoint_id);
      processed += 1;
    } catch (err) {
      console.error(`Follow-up touchpoint ${touchpoint_id} run errored:`, err.message);
    }
  }
  return processed;
}

// ---------------------------------------------------------------------------
// Smart-stop + auto-enroll (called from the qualification / conversion flows)
// ---------------------------------------------------------------------------

/**
 * Stops a lead's running sequences (sets them 'stopped' with a reason). Used when
 * the lead responds, books, or converts. When `onlyAfterFirstTouchpoint` is true
 * (a "lead responded" signal) it only stops sequences that have already sent at
 * least one touchpoint, so a freshly-enrolled sequence isn't killed by the same
 * conversation that created it. Best-effort: never throws.
 */
async function cancelActiveSequencesForLead(leadId, reason, onlyAfterFirstTouchpoint = false) {
  if (!leadId) return 0;
  try {
    const stepCond = onlyAfterFirstTouchpoint ? "AND current_step >= 1" : "";
    const result = await db.query(
      `UPDATE follow_up_sequences
       SET status = 'stopped', stop_reason = $2
       WHERE lead_id = $1 AND status IN ('active', 'paused') ${stepCond}`,
      [leadId, reason],
    );
    return result.rowCount;
  } catch (err) {
    console.error("Stop follow-up sequences failed:", err.message);
    return 0;
  }
}

/**
 * Auto-enrolls a lead into a follow-up sequence the moment they cross from cold
 * into warm/hot during qualification. Gated on the TRANSITION (prev cold -> new
 * warm/hot) so repeated warm/hot messages don't re-enroll, and skipped when the
 * lead has converted, already has a booked appointment, or already has a running
 * sequence. Best-effort: never throws (callers fire-and-forget).
 */
async function maybeStartSequenceForLead({ brandId, leadId, temperature, prevTemperature }) {
  try {
    if (!brandId || !leadId) return;
    if (tempRank(temperature) < 1) return; // not warm or hot
    if (tempRank(prevTemperature) >= 1) return; // already warm/hot — not a fresh transition

    // Auto-enroll is a Professional feature; enforce it here since this runs
    // outside the tier-gated HTTP routes.
    if (!(await brandOwnerHasFollowUps(brandId))) return;

    const leadResult = await db.query(
      `SELECT lead_id, brand_id, lead_name, email, phone, conversion_status
       FROM leads WHERE lead_id = $1 AND brand_id = $2`,
      [leadId, brandId],
    );
    const lead = leadResult.rows[0];
    if (!lead) return;
    if (lead.conversion_status === "converted") return;
    if (!lead.email && !lead.phone) return; // nothing to reach them on

    const existing = await db.query(
      `SELECT 1 FROM follow_up_sequences
       WHERE lead_id = $1 AND status IN ('active', 'paused') LIMIT 1`,
      [leadId],
    );
    if (existing.rows.length) return;

    const booked = await db.query(
      `SELECT 1 FROM appointments
       WHERE lead_id = $1 AND status = 'scheduled' LIMIT 1`,
      [leadId],
    );
    if (booked.rows.length) return;

    const brand = await getBrandRow(brandId);
    if (!brand) return;

    const isHot = temperature === "hot";
    const goal = isHot ? "close_sale" : "book_appointment";
    const sequenceType = isHot ? "closing" : "nurture";
    const allowed = lead.phone ? VALID_CHANNELS : ["email"];

    const raw = await generateFollowUpSequence(brand, lead, {
      goal,
      maxTouchpoints: MAX_TOUCHPOINTS,
    });
    const touchpoints = validateTouchpoints(raw, allowed);

    await persistSequence({
      brandId,
      leadId,
      goal,
      sequenceType,
      touchpoints,
      source: "auto",
    });
  } catch (err) {
    // Unique violation just means another path enrolled the lead first.
    if (err.code === "23505") return;
    console.error("Auto follow-up enrollment failed:", err.message);
  }
}

module.exports = {
  generateSequence,
  saveAndActivate,
  getSequences,
  getSequenceDetail,
  pauseSequence,
  resumeSequence,
  cancelSequence,
  executeDueTouchpoints,
  cancelActiveSequencesForLead,
  maybeStartSequenceForLead,
};
