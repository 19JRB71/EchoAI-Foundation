const db = require("../config/db");
const { sendEmail } = require("../utils/email");
const { alertOwnerOfFailedSend } = require("../utils/failedSendAlerts");
const { encrypt, decrypt } = require("../utils/encryption");
const { getPublicBaseUrl } = require("../config/twilio");
const {
  generateCampaignEmail: writeCampaignEmail,
  generateDripSequence: designDripSequence,
} = require("../prompts/emailMarketingPrompt");

// 1x1 transparent GIF returned by the open-tracking pixel.
const TRACKING_PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

// Map a UI segment filter to a leads WHERE fragment. `all` = every lead with an
// email. Unknown segments fall back to `all`.
const SEGMENTS = {
  all: "",
  hot: "AND temperature = 'hot'",
  warm: "AND temperature = 'warm'",
  cold: "AND temperature = 'tire_kicker'",
  customers: "AND conversion_status = 'converted'",
};

function segmentClause(segment) {
  return Object.prototype.hasOwnProperty.call(SEGMENTS, segment)
    ? SEGMENTS[segment]
    : SEGMENTS.all;
}

/** Loads a brand only if it belongs to the authenticated user. */
async function getOwnedBrand(userId, brandId) {
  const result = await db.query(
    `SELECT brand_id, brand_name, brand_personality, voice_description,
            visual_style_preferences, target_audience
     FROM brands
     WHERE brand_id = $1 AND user_id = $2`,
    [brandId, userId]
  );
  return result.rows[0] || null;
}

/** Loads a campaign only if it belongs to a brand owned by the user. */
async function getOwnedCampaign(userId, campaignId) {
  const result = await db.query(
    `SELECT c.campaign_id, c.brand_id, c.campaign_name, c.campaign_type,
            c.goal, c.segment_filter, c.status, c.recipient_count, c.sent_count,
            c.open_count, c.click_count, c.scheduled_at, c.sent_at,
            c.created_at, c.updated_at
     FROM email_marketing_campaigns c
     JOIN brands b ON b.brand_id = c.brand_id
     WHERE c.campaign_id = $1 AND b.user_id = $2`,
    [campaignId, userId]
  );
  return result.rows[0] || null;
}

function str(v) {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

/**
 * Validates one email payload (AI output or client-supplied save). Returns a
 * cleaned object or throws so malformed data never reaches the DB or SMTP.
 */
function validateEmailPayload(email, label) {
  if (!email || typeof email !== "object") {
    throw new Error(`${label} is not a valid object`);
  }
  const subjectVariations = Array.isArray(email.subjectVariations)
    ? email.subjectVariations.map(str).filter(Boolean)
    : [];
  const subjectLine = str(email.subjectLine) || subjectVariations[0] || "";
  const bodyHtml = str(email.bodyHtml);
  const bodyPlainText = str(email.bodyPlainText);
  if (!subjectLine) throw new Error(`${label} is missing a subject line`);
  if (!bodyHtml) throw new Error(`${label} is missing an HTML body`);
  let delay = Math.round(Number(email.sendDelayDays));
  if (!Number.isFinite(delay) || delay < 0) delay = 0;
  return {
    subjectLine,
    subjectVariations,
    previewText: str(email.previewText),
    bodyHtml,
    bodyPlainText: bodyPlainText || stripHtml(bodyHtml),
    sendDelayDays: delay,
  };
}

function stripHtml(html) {
  return String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Builds an opaque, tamper-evident unsubscribe token for a (brand, email). */
function unsubscribeToken(brandId, email) {
  return encodeURIComponent(encrypt(JSON.stringify({ brandId, email })));
}

/**
 * Rewrites outbound links through the click-tracker, appends an open-tracking
 * pixel, and adds the required unsubscribe footer. Returns ready-to-send HTML.
 */
function buildTrackedHtml(html, { recipientId, brandId, email, baseUrl }) {
  let out = String(html);
  if (baseUrl) {
    // Route http(s) links through the click tracker (skip the unsubscribe link).
    // The destination URL is AES-GCM encrypted into the link so the public
    // /click endpoint can only ever redirect to URLs we authored — it cannot be
    // abused as an open redirector with an attacker-supplied target.
    out = out.replace(
      /href\s*=\s*"(https?:\/\/[^"]+)"/gi,
      (match, url) =>
        `href="${baseUrl}/api/email-marketing/click/${recipientId}?u=${encodeURIComponent(
          encrypt(url)
        )}"`
    );
    const token = unsubscribeToken(brandId, email);
    const unsubUrl = `${baseUrl}/api/email-marketing/unsubscribe?token=${token}`;
    out += `\n<img src="${baseUrl}/api/email-marketing/open/${recipientId}" width="1" height="1" alt="" style="display:none" />`;
    out += `\n<div style="margin-top:24px;font-size:12px;color:#888;text-align:center">You're receiving this because you're a contact of this business. <a href="${unsubUrl}">Unsubscribe</a></div>`;
  }
  return out;
}

/** True if `email` has opted out for `brandId`. */
async function isOptedOut(brandId, email, client = db) {
  const result = await client.query(
    `SELECT 1 FROM email_opt_outs WHERE brand_id = $1 AND lower(email_address) = lower($2)`,
    [brandId, email]
  );
  return result.rows.length > 0;
}

function aiError(res, err, what) {
  console.error(`${what} error:`, err.message);
  if (err.aiInvalid || (typeof err.status === "number" && err.status >= 400)) {
    return res.status(502).json({
      error: `The AI provider could not ${what} right now. Please try again shortly.`,
    });
  }
  return res.status(500).json({ error: `Failed to ${what}` });
}

// ---------------------------------------------------------------------------
// AI generation
// ---------------------------------------------------------------------------

/** POST /api/email-marketing/generate-email — Email Campaign Writer. */
async function generateCampaignEmail(req, res) {
  const userId = req.user.userId;
  const { brandId, goal, audienceSegment, topic } = req.body;
  if (!brandId || !str(goal)) {
    return res.status(400).json({ error: "brandId and goal are required" });
  }
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const email = await writeCampaignEmail(brand, {
      goal: str(goal),
      audienceSegment: str(audienceSegment),
      topic: str(topic),
    });
    return res.json({ brandId, email });
  } catch (err) {
    return aiError(res, err, "write the campaign email");
  }
}

/** POST /api/email-marketing/generate-drip — Drip Sequence Designer. */
async function generateDripSequence(req, res) {
  const userId = req.user.userId;
  const { brandId, goal, audienceSegment, numEmails } = req.body;
  if (!brandId || !str(goal)) {
    return res.status(400).json({ error: "brandId and goal are required" });
  }
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const emails = await designDripSequence(brand, {
      goal: str(goal),
      audienceSegment: str(audienceSegment),
      numEmails,
    });
    return res.json({ brandId, count: emails.length, emails });
  } catch (err) {
    return aiError(res, err, "design the drip sequence");
  }
}

// ---------------------------------------------------------------------------
// Recipient resolution
// ---------------------------------------------------------------------------

/**
 * Inserts recipient rows for every brand lead in `segment` that has an email and
 * has not opted out. Returns the number of recipients created. Drip recipients
 * get current_step 0 + next_send_at; one-time recipients are sent on demand.
 */
async function seedRecipients(client, { campaignId, brandId, segment, firstDelayDays }) {
  const leads = await client.query(
    `SELECT lead_id, email FROM leads
     WHERE brand_id = $1 AND email IS NOT NULL AND email <> '' ${segmentClause(segment)}`,
    [brandId]
  );
  const optedOut = await client.query(
    `SELECT lower(email_address) AS email FROM email_opt_outs WHERE brand_id = $1`,
    [brandId]
  );
  const blocked = new Set(optedOut.rows.map((r) => r.email));
  const seen = new Set();
  let count = 0;
  for (const lead of leads.rows) {
    const email = lead.email.trim();
    const key = email.toLowerCase();
    if (!email || blocked.has(key) || seen.has(key)) continue;
    seen.add(key);
    const nextSendAt =
      firstDelayDays == null
        ? null
        : new Date(Date.now() + firstDelayDays * 86400000);
    const inserted = await client.query(
      `INSERT INTO email_marketing_recipients
         (campaign_id, lead_id, email_address, current_step, next_send_at)
       VALUES ($1, $2, $3, 0, $4)
       ON CONFLICT (campaign_id, email_address) DO NOTHING
       RETURNING recipient_id`,
      [campaignId, lead.lead_id, email, nextSendAt]
    );
    if (inserted.rows.length) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Campaign creation
// ---------------------------------------------------------------------------

/** POST /api/email-marketing/campaigns — create a one-time blast (draft). */
async function createCampaign(req, res) {
  const userId = req.user.userId;
  const { brandId, campaignName, goal, segment, email } = req.body;
  if (!brandId || !str(campaignName)) {
    return res.status(400).json({ error: "brandId and campaignName are required" });
  }
  let payload;
  try {
    payload = validateEmailPayload(email, "email");
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const client = await db.getClient();
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) {
      return res.status(404).json({ error: "Brand not found" });
    }
    await client.query("BEGIN");
    const campaignResult = await client.query(
      `INSERT INTO email_marketing_campaigns
         (brand_id, campaign_name, campaign_type, goal, segment_filter, status)
       VALUES ($1, $2, 'one-time', $3, $4, 'draft')
       RETURNING campaign_id`,
      [brandId, str(campaignName), str(goal), str(segment) || "all"]
    );
    const campaignId = campaignResult.rows[0].campaign_id;

    await client.query(
      `INSERT INTO email_marketing_emails
         (campaign_id, sequence_position, subject_line, preview_text,
          body_html, body_plain_text, send_delay_days)
       VALUES ($1, 0, $2, $3, $4, $5, 0)`,
      [campaignId, payload.subjectLine, payload.previewText, payload.bodyHtml, payload.bodyPlainText]
    );

    const recipientCount = await seedRecipients(client, {
      campaignId,
      brandId,
      segment: str(segment) || "all",
      firstDelayDays: null,
    });
    await client.query(
      `UPDATE email_marketing_campaigns SET recipient_count = $1, updated_at = NOW()
       WHERE campaign_id = $2`,
      [recipientCount, campaignId]
    );
    await client.query("COMMIT");

    const campaign = await getOwnedCampaign(userId, campaignId);
    return res.status(201).json({ campaign });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Create campaign error:", err.message);
    return res.status(500).json({ error: "Failed to create campaign" });
  } finally {
    client.release();
  }
}

/** POST /api/email-marketing/drip — create + activate a drip sequence. */
async function createDripSequence(req, res) {
  const userId = req.user.userId;
  const { brandId, campaignName, goal, segment, emails } = req.body;
  if (!brandId || !str(campaignName)) {
    return res.status(400).json({ error: "brandId and campaignName are required" });
  }
  if (!Array.isArray(emails) || emails.length < 2) {
    return res.status(400).json({ error: "A drip sequence needs at least 2 emails" });
  }
  let payloads;
  try {
    payloads = emails.map((e, i) => validateEmailPayload(e, `Email ${i + 1}`));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  // First step always sends at enrollment (day 0); keep the rest as given.
  payloads.sort((a, b) => a.sendDelayDays - b.sendDelayDays);
  const firstDelay = payloads[0].sendDelayDays;

  const client = await db.getClient();
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) {
      return res.status(404).json({ error: "Brand not found" });
    }
    await client.query("BEGIN");
    const campaignResult = await client.query(
      `INSERT INTO email_marketing_campaigns
         (brand_id, campaign_name, campaign_type, goal, segment_filter, status)
       VALUES ($1, $2, 'drip', $3, $4, 'sending')
       RETURNING campaign_id`,
      [brandId, str(campaignName), str(goal), str(segment) || "all"]
    );
    const campaignId = campaignResult.rows[0].campaign_id;

    for (let i = 0; i < payloads.length; i += 1) {
      const p = payloads[i];
      await client.query(
        `INSERT INTO email_marketing_emails
           (campaign_id, sequence_position, subject_line, preview_text,
            body_html, body_plain_text, send_delay_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [campaignId, i, p.subjectLine, p.previewText, p.bodyHtml, p.bodyPlainText, p.sendDelayDays]
      );
    }

    const recipientCount = await seedRecipients(client, {
      campaignId,
      brandId,
      segment: str(segment) || "all",
      firstDelayDays: firstDelay,
    });
    await client.query(
      `UPDATE email_marketing_campaigns SET recipient_count = $1, updated_at = NOW()
       WHERE campaign_id = $2`,
      [recipientCount, campaignId]
    );
    await client.query("COMMIT");

    const campaign = await getOwnedCampaign(userId, campaignId);
    return res.status(201).json({ campaign });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Create drip sequence error:", err.message);
    return res.status(500).json({ error: "Failed to create drip sequence" });
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Sending (one-time blast)
// ---------------------------------------------------------------------------

/**
 * POST /api/email-marketing/campaigns/:campaignId/send — send a one-time blast.
 * Locks the campaign row for the duration so concurrent requests cannot double
 * send. Opt-outs are skipped (and marked) at send time; the unique recipient
 * index plus the row lock guarantee idempotency.
 */
async function sendCampaign(req, res) {
  const userId = req.user.userId;
  const { campaignId } = req.params;
  const baseUrl = getPublicBaseUrl(req);

  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    const lock = await client.query(
      `SELECT c.campaign_id, c.brand_id, c.campaign_type, c.status
       FROM email_marketing_campaigns c
       JOIN brands b ON b.brand_id = c.brand_id
       WHERE c.campaign_id = $1 AND b.user_id = $2
       FOR UPDATE OF c`,
      [campaignId, userId]
    );
    const campaign = lock.rows[0];
    if (!campaign) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.campaign_type !== "one-time") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Only one-time campaigns are sent this way" });
    }
    if (campaign.status === "sent" || campaign.status === "sending") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "This campaign has already been sent" });
    }

    const emailResult = await client.query(
      `SELECT subject_line, body_html FROM email_marketing_emails
       WHERE campaign_id = $1 AND sequence_position = 0`,
      [campaignId]
    );
    const email = emailResult.rows[0];
    if (!email) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "This campaign has no email to send" });
    }

    // A 'failed' blast (background sender marked its recipients 'failed') can
    // be retried manually: re-target the failed recipients too. A failed
    // recipient never received the email, so this cannot double-send.
    const retryingFailed = campaign.status === "failed";
    const recipients = await client.query(
      `SELECT recipient_id, email_address FROM email_marketing_recipients
       WHERE campaign_id = $1 AND delivery_status = ANY($2)`,
      [campaignId, retryingFailed ? ["pending", "failed"] : ["pending"]]
    );
    if (recipients.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No pending recipients for this campaign" });
    }

    let sent = 0;
    let failed = 0;
    for (const r of recipients.rows) {
      if (await isOptedOut(campaign.brand_id, r.email_address, client)) {
        await client.query(
          `UPDATE email_marketing_recipients
           SET delivery_status = 'unsubscribed', unsubscribed_at = NOW(), updated_at = NOW()
           WHERE recipient_id = $1`,
          [r.recipient_id]
        );
        continue;
      }
      try {
        const html = buildTrackedHtml(email.body_html, {
          recipientId: r.recipient_id,
          brandId: campaign.brand_id,
          email: r.email_address,
          baseUrl,
        });
        await sendEmail({ to: r.email_address, subject: email.subject_line, html });
        await client.query(
          `UPDATE email_marketing_recipients
           SET delivery_status = 'sent', updated_at = NOW()
           WHERE recipient_id = $1`,
          [r.recipient_id]
        );
        sent += 1;
      } catch (err) {
        failed += 1;
        await client.query(
          `UPDATE email_marketing_recipients
           SET delivery_status = 'failed', updated_at = NOW()
           WHERE recipient_id = $1`,
          [r.recipient_id]
        );
        console.error(`Email send failed (recipient ${r.recipient_id}):`, err.message);
      }
    }

    if (sent === 0) {
      await client.query("ROLLBACK");
      return res.status(502).json({
        error: "No emails could be sent (check SMTP configuration)",
        recipients: recipients.rows.length,
        sent,
        failed,
      });
    }

    await client.query(
      `UPDATE email_marketing_campaigns
       SET status = 'sent', sent_count = sent_count + $1, sent_at = NOW(), updated_at = NOW()
       WHERE campaign_id = $2`,
      [sent, campaignId]
    );
    await client.query("COMMIT");
    return res.json({ campaignId, recipients: recipients.rows.length, sent, failed, status: "sent" });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Send campaign error:", err.message);
    return res.status(500).json({ error: "Failed to send campaign" });
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Scheduling (one-time blast)
// ---------------------------------------------------------------------------

/**
 * POST /api/email-marketing/campaigns/:campaignId/schedule — schedule (or
 * reschedule) a one-time blast for a future time. The status-guarded UPDATE
 * only transitions draft/scheduled campaigns, so a blast the background sender
 * already claimed (or one that was sent/failed meanwhile) can't be rescheduled
 * out from under it.
 */
async function scheduleCampaign(req, res) {
  const userId = req.user.userId;
  const { campaignId } = req.params;
  const { scheduledAt } = req.body || {};
  const when = new Date(scheduledAt);
  if (!scheduledAt || Number.isNaN(when.getTime())) {
    return res.status(400).json({ error: "A valid scheduledAt date is required" });
  }
  if (when.getTime() <= Date.now()) {
    return res.status(400).json({ error: "scheduledAt must be in the future" });
  }
  try {
    const campaign = await getOwnedCampaign(userId, campaignId);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (campaign.campaign_type !== "one-time") {
      return res.status(400).json({ error: "Only one-time campaigns can be scheduled" });
    }
    const updated = await db.query(
      `UPDATE email_marketing_campaigns
       SET status = 'scheduled', scheduled_at = $1, updated_at = NOW()
       WHERE campaign_id = $2 AND status IN ('draft', 'scheduled')
       RETURNING campaign_id, scheduled_at`,
      [when, campaignId]
    );
    if (updated.rows.length === 0) {
      return res
        .status(400)
        .json({ error: "Campaign cannot be scheduled from its current state" });
    }
    return res.json({
      campaignId,
      status: "scheduled",
      scheduledAt: updated.rows[0].scheduled_at,
    });
  } catch (err) {
    console.error("Schedule campaign error:", err.message);
    return res.status(500).json({ error: "Failed to schedule campaign" });
  }
}

/**
 * POST /api/email-marketing/campaigns/:campaignId/unschedule — cancel a
 * pending schedule, returning the blast to draft. Status-guarded so it can't
 * revive a campaign the sender already moved on.
 */
async function unscheduleCampaign(req, res) {
  const userId = req.user.userId;
  const { campaignId } = req.params;
  try {
    const campaign = await getOwnedCampaign(userId, campaignId);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (campaign.campaign_type !== "one-time") {
      return res.status(400).json({ error: "Only one-time campaigns can be unscheduled" });
    }
    const updated = await db.query(
      `UPDATE email_marketing_campaigns
       SET status = 'draft', scheduled_at = NULL, updated_at = NOW()
       WHERE campaign_id = $1 AND status = 'scheduled'
       RETURNING campaign_id`,
      [campaignId]
    );
    if (updated.rows.length === 0) {
      return res.status(400).json({ error: "This campaign is not scheduled" });
    }
    return res.json({ campaignId, status: "draft" });
  } catch (err) {
    console.error("Unschedule campaign error:", err.message);
    return res.status(500).json({ error: "Failed to unschedule campaign" });
  }
}

// ---------------------------------------------------------------------------
// Drip scheduler worker (invoked hourly from utils/scheduler.js)
// ---------------------------------------------------------------------------

// A drip send that keeps dying at the SMTP layer (dead config, revoked
// credentials) gets this many hourly attempts before the recipient flips to
// 'failed' and the campaign's owner is alerted. A one-off hiccup still just
// retries silently on the next tick.
const MAX_DRIP_SEND_ATTEMPTS = 3;

// During a multi-hour SMTP outage, different recipients of the same campaign
// exhaust their attempts in different hourly runs — without a cooldown that
// means one owner alert per run. A campaign alerts at most once per this many
// hours; the claim is an atomic UPDATE on last_failure_alert_at (branch on
// row count) so overlapping ticks can't double-alert either.
const DRIP_FAILURE_ALERT_COOLDOWN_HOURS = 24;

/**
 * Sends every due drip email. Each recipient is claimed atomically with
 * SELECT ... FOR UPDATE SKIP LOCKED inside its own transaction so overlapping
 * ticks can never double-send. Advances current_step / next_send_at, completing
 * the recipient once the sequence is exhausted. Returns { processed, sent }.
 *
 * Failure alerting: a recipient whose send has now failed
 * MAX_DRIP_SEND_ATTEMPTS times is flipped to 'failed' (next_send_at cleared)
 * inside its claim transaction — only recipients that really made that
 * transition are counted, and after the loop the owner gets one push per
 * affected campaign (tag per campaign) deep-linking to the Email section.
 * A per-campaign cooldown (DRIP_FAILURE_ALERT_COOLDOWN_HOURS, claimed via an
 * atomic UPDATE on last_failure_alert_at) keeps a multi-hour outage from
 * re-alerting the same campaign every hourly run.
 */
async function sendDueDripEmails() {
  const baseUrl = getPublicBaseUrl(null);
  const due = await db.query(
    `SELECT r.recipient_id
     FROM email_marketing_recipients r
     JOIN email_marketing_campaigns c ON c.campaign_id = r.campaign_id
     JOIN brands b ON b.brand_id = c.brand_id
     WHERE c.campaign_type = 'drip' AND c.status = 'sending'
       AND r.delivery_status = 'pending'
       AND r.next_send_at IS NOT NULL AND r.next_send_at <= NOW()
       AND b.is_demo = false
     ORDER BY r.next_send_at ASC
     LIMIT 500`
  );

  let processed = 0;
  let sent = 0;
  // campaign_id -> { brandId, campaignName, failedCount, reason } for the
  // recipients that really flipped to 'failed' this run (alerted after the
  // loop so one campaign alerts once per run, not once per recipient).
  const failedByCampaign = new Map();
  for (const { recipient_id } of due.rows) {
    const client = await db.getClient();
    try {
      await client.query("BEGIN");
      const claim = await client.query(
        `SELECT r.recipient_id, r.campaign_id, r.email_address, r.current_step,
                r.send_attempts, c.brand_id, c.campaign_name
         FROM email_marketing_recipients r
         JOIN email_marketing_campaigns c ON c.campaign_id = r.campaign_id
         WHERE r.recipient_id = $1
           AND r.delivery_status = 'pending'
           AND r.next_send_at IS NOT NULL AND r.next_send_at <= NOW()
           AND c.status = 'sending'
         FOR UPDATE OF r SKIP LOCKED`,
        [recipient_id]
      );
      const rec = claim.rows[0];
      if (!rec) {
        await client.query("ROLLBACK");
        continue;
      }
      processed += 1;

      // Stop sending to anyone who has opted out since enrollment.
      if (await isOptedOut(rec.brand_id, rec.email_address, client)) {
        await client.query(
          `UPDATE email_marketing_recipients
           SET delivery_status = 'unsubscribed', unsubscribed_at = NOW(),
               next_send_at = NULL, updated_at = NOW()
           WHERE recipient_id = $1`,
          [rec.recipient_id]
        );
        await client.query("COMMIT");
        continue;
      }

      const emails = await client.query(
        `SELECT sequence_position, subject_line, body_html, send_delay_days
         FROM email_marketing_emails
         WHERE campaign_id = $1 AND sequence_position >= $2
         ORDER BY sequence_position ASC
         LIMIT 2`,
        [rec.campaign_id, rec.current_step]
      );
      const current = emails.rows[0];
      if (!current) {
        // No email at this step — sequence complete.
        await client.query(
          `UPDATE email_marketing_recipients
           SET delivery_status = 'sent', next_send_at = NULL, updated_at = NOW()
           WHERE recipient_id = $1`,
          [rec.recipient_id]
        );
        await client.query("COMMIT");
        continue;
      }

      let ok = true;
      let sendError = null;
      try {
        const html = buildTrackedHtml(current.body_html, {
          recipientId: rec.recipient_id,
          brandId: rec.brand_id,
          email: rec.email_address,
          baseUrl,
        });
        await sendEmail({ to: rec.email_address, subject: current.subject_line, html });
        sent += 1;
      } catch (err) {
        ok = false;
        sendError = err;
        console.error(`Drip send failed (recipient ${rec.recipient_id}):`, err.message);
      }

      if (!ok) {
        // Count the attempt. Below the limit the row stays 'pending' (do not
        // advance the step) and the next hourly tick retries it; at the limit
        // it flips to 'failed' — the real state transition that alerts the
        // owner. The row is FOR UPDATE-locked, so the flip cannot race.
        const attemptsUsed = (rec.send_attempts || 0) + 1;
        if (attemptsUsed >= MAX_DRIP_SEND_ATTEMPTS) {
          const flipped = await client.query(
            `UPDATE email_marketing_recipients
             SET delivery_status = 'failed', send_attempts = $1,
                 next_send_at = NULL, updated_at = NOW()
             WHERE recipient_id = $2 AND delivery_status = 'pending'
             RETURNING recipient_id`,
            [attemptsUsed, rec.recipient_id]
          );
          await client.query("COMMIT");
          if (flipped.rows.length > 0) {
            const entry = failedByCampaign.get(rec.campaign_id) || {
              brandId: rec.brand_id,
              campaignName: rec.campaign_name,
              failedCount: 0,
              reason: sendError ? sendError.message : "Unknown error",
            };
            entry.failedCount += 1;
            failedByCampaign.set(rec.campaign_id, entry);
          }
        } else {
          await client.query(
            `UPDATE email_marketing_recipients
             SET send_attempts = $1, updated_at = NOW()
             WHERE recipient_id = $2`,
            [attemptsUsed, rec.recipient_id]
          );
          await client.query("COMMIT");
        }
        continue;
      }

      const next = emails.rows[1];
      if (next) {
        const delta = Math.max(0, next.send_delay_days - current.send_delay_days);
        const nextSendAt = new Date(Date.now() + delta * 86400000);
        await client.query(
          `UPDATE email_marketing_recipients
           SET current_step = $1, next_send_at = $2, updated_at = NOW()
           WHERE recipient_id = $3`,
          [next.sequence_position, nextSendAt, rec.recipient_id]
        );
      } else {
        await client.query(
          `UPDATE email_marketing_recipients
           SET current_step = $1, delivery_status = 'sent', next_send_at = NULL, updated_at = NOW()
           WHERE recipient_id = $2`,
          [current.sequence_position + 1, rec.recipient_id]
        );
      }
      await client.query(
        `UPDATE email_marketing_campaigns
         SET sent_count = sent_count + 1, updated_at = NOW()
         WHERE campaign_id = $1`,
        [rec.campaign_id]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Drip scheduler error:", err.message);
    } finally {
      client.release();
    }
  }

  // Alert each affected campaign's owner exactly once for this run. Only
  // recipients whose pending -> failed flip really hit a row are counted, and
  // the per-campaign tag collapses any duplicate deliveries. Best-effort:
  // alertOwnerOfFailedSend never throws and skips demo brands itself.
  //
  // Cross-run cooldown: an outage that spans several hourly runs makes NEW
  // recipients of the same campaign exhaust their attempts each run — the
  // per-run aggregation alone would still buzz the owner every hour (FCM
  // doesn't collapse by tag). Claim last_failure_alert_at atomically and
  // branch on the row count: only the run that wins the claim alerts, and the
  // same campaign stays silent for the cooldown window. The recipient rows
  // still flip to 'failed' regardless, so nothing is lost — only the repeat
  // notification is suppressed. Claim failures (DB error) skip the alert
  // rather than risk a spam loop; the next run retries the claim.
  for (const [campaignId, f] of failedByCampaign) {
    let claimed;
    try {
      claimed = await db.query(
        `UPDATE email_marketing_campaigns
         SET last_failure_alert_at = NOW(), updated_at = NOW()
         WHERE campaign_id = $1
           AND (last_failure_alert_at IS NULL
                OR last_failure_alert_at <= NOW() - ($2 * INTERVAL '1 hour'))
         RETURNING campaign_id`,
        [campaignId, DRIP_FAILURE_ALERT_COOLDOWN_HOURS]
      );
    } catch (err) {
      console.error(
        `Failed-email-campaign alert cooldown claim failed (campaign ${campaignId}):`,
        err.message
      );
      continue;
    }
    if (claimed.rows.length === 0) continue; // alerted within the cooldown window

    const why = String(f.reason || "Unknown error").slice(0, 160);
    const label = f.campaignName ? `"${f.campaignName}"` : "your email campaign";
    await alertOwnerOfFailedSend({
      brandId: f.brandId,
      title: "⚠️ Email campaign send failed",
      buildBody: (brand) =>
        `${f.failedCount} email${f.failedCount === 1 ? "" : "s"} in ${label} for ${brand.brand_name} couldn't be sent: ${why} Tap to review.`,
      url: "/dashboard?section=email",
      tag: `email-campaign-failed-${campaignId}`,
      mobileData: { type: "email_campaign_failed", campaignId: String(campaignId) },
      logLabel: "Failed-email-campaign",
    });
  }

  return { processed, sent, failed: failedByCampaign.size };
}

// Both ids in the retry route are UUIDs; reject malformed values up front so
// they surface as a clean 400 instead of a Postgres cast error.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/email-marketing/campaigns/:campaignId/recipients/:recipientId/retry
 * One-tap recovery for a drip recipient stuck at delivery_status='failed':
 * atomically flips failed -> pending, resets send_attempts to 0, and sets
 * next_send_at = NOW() so the next hourly drip tick picks it up. Mirrors the
 * social failed-post reschedule pattern: ownership enforced inside the UPDATE
 * via the brands join, and the handler branches on the atomic UPDATE's row
 * count (404 foreign / 409 wrong-state decided by a follow-up read only when
 * nothing was updated).
 */
async function retryDripRecipient(req, res) {
  const userId = req.user.userId;
  const { campaignId, recipientId } = req.params;
  if (!campaignId || !UUID_RE.test(campaignId)) {
    return res.status(400).json({ error: "Invalid campaign id" });
  }
  if (!recipientId || !UUID_RE.test(recipientId)) {
    return res.status(400).json({ error: "Invalid recipient id" });
  }
  try {
    const result = await db.query(
      `UPDATE email_marketing_recipients r
       SET delivery_status = 'pending', send_attempts = 0,
           next_send_at = NOW(), updated_at = NOW()
       FROM email_marketing_campaigns c
       JOIN brands b ON b.brand_id = c.brand_id
       WHERE r.recipient_id = $1
         AND r.campaign_id = $2
         AND c.campaign_id = r.campaign_id
         AND c.campaign_type = 'drip'
         AND b.user_id = $3
         AND r.delivery_status = 'failed'
       RETURNING r.recipient_id, r.email_address, r.delivery_status,
                 r.current_step, r.send_attempts, r.next_send_at`,
      [recipientId, campaignId, userId]
    );
    if (result.rows.length > 0) {
      return res.json({ recipient: result.rows[0] });
    }

    // Nothing updated: either the recipient isn't ours (404, same as any
    // foreign resource), the campaign isn't a drip (400), or the recipient
    // isn't in 'failed' (409 with the real status).
    const check = await db.query(
      `SELECT r.delivery_status, c.campaign_type
       FROM email_marketing_recipients r
       JOIN email_marketing_campaigns c ON c.campaign_id = r.campaign_id
       JOIN brands b ON b.brand_id = c.brand_id AND b.user_id = $3
       WHERE r.recipient_id = $1 AND r.campaign_id = $2`,
      [recipientId, campaignId, userId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: "Recipient not found" });
    }
    if (check.rows[0].campaign_type !== "drip") {
      return res
        .status(400)
        .json({ error: "Only drip sequence recipients can be retried" });
    }
    return res.status(409).json({
      error: `Only failed recipients can be retried (this recipient is '${check.rows[0].delivery_status}')`,
    });
  } catch (err) {
    console.error("Retry drip recipient error:", err.message);
    return res.status(500).json({ error: "Failed to retry recipient" });
  }
}

/**
 * POST /api/email-marketing/campaigns/:campaignId/recipients/retry-failed
 * One-tap bulk recovery: flips every failed recipient of a drip campaign back
 * to pending in a single atomic UPDATE (resets send_attempts to 0 and sets
 * next_send_at = NOW()) so the next hourly drip tick re-attempts them all.
 * Ownership is enforced inside the UPDATE via the brands join. When nothing is
 * updated a follow-up read disambiguates 404 (foreign campaign) / 400 (not a
 * drip) from a genuine "no failed recipients" (200 with retried: 0).
 */
async function retryFailedDripRecipients(req, res) {
  const userId = req.user.userId;
  const { campaignId } = req.params;
  if (!campaignId || !UUID_RE.test(campaignId)) {
    return res.status(400).json({ error: "Invalid campaign id" });
  }
  try {
    const result = await db.query(
      `UPDATE email_marketing_recipients r
       SET delivery_status = 'pending', send_attempts = 0,
           next_send_at = NOW(), updated_at = NOW()
       FROM email_marketing_campaigns c
       JOIN brands b ON b.brand_id = c.brand_id
       WHERE r.campaign_id = $1
         AND c.campaign_id = r.campaign_id
         AND c.campaign_type = 'drip'
         AND b.user_id = $2
         AND r.delivery_status = 'failed'
       RETURNING r.recipient_id`,
      [campaignId, userId]
    );
    if (result.rows.length > 0) {
      return res.json({ retried: result.rows.length });
    }

    // Nothing updated: either the campaign isn't ours (404), it isn't a drip
    // (400), or it simply has no failed recipients (200 with retried: 0).
    const check = await db.query(
      `SELECT c.campaign_type
       FROM email_marketing_campaigns c
       JOIN brands b ON b.brand_id = c.brand_id AND b.user_id = $2
       WHERE c.campaign_id = $1`,
      [campaignId, userId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (check.rows[0].campaign_type !== "drip") {
      return res
        .status(400)
        .json({ error: "Only drip sequence recipients can be retried" });
    }
    return res.json({ retried: 0 });
  } catch (err) {
    console.error("Retry failed drip recipients error:", err.message);
    return res.status(500).json({ error: "Failed to retry recipients" });
  }
}

// ---------------------------------------------------------------------------
// Scheduled one-time blast worker (invoked every 5 min from utils/scheduler.js)
// ---------------------------------------------------------------------------

/**
 * Alerts a blast's owner that it flipped to 'failed'. Callers invoke this only
 * where the status-guarded scheduled -> failed transition really hit a row;
 * the per-campaign tag collapses duplicate deliveries and the shared helper
 * skips demo brands itself.
 */
async function alertOwnerOfFailedEmailBlast({ campaignId, brandId, campaignName, reason }) {
  const why = String(reason || "Unknown error").slice(0, 160);
  const label = campaignName ? `"${campaignName}"` : "your email blast";
  await alertOwnerOfFailedSend({
    brandId,
    title: "⚠️ Scheduled email blast failed to send",
    buildBody: (brand) =>
      `Email blast ${label} for ${brand.brand_name} didn't send: ${why} Tap to review.`,
    url: "/dashboard?section=email",
    tag: `email-campaign-failed-${campaignId}`,
    mobileData: { type: "email_campaign_failed", campaignId: String(campaignId) },
    logLabel: "Failed-email-blast",
  });
}

/**
 * Sends every due scheduled one-time blast. Each campaign is claimed with
 * SELECT ... FOR UPDATE SKIP LOCKED inside its own transaction (the same
 * single-transaction shape as the manual send path), so overlapping ticks and
 * a concurrent manual "Send now" can never double-send. Returns
 * { processed, sent, failed }.
 *
 * Failure alerting: a blast where NOTHING went out (every send failed, no
 * email row, or no recipients left) flips to 'failed' via a status-guarded
 * UPDATE inside the claim transaction — only campaigns that really made that
 * transition alert the owner (deep link to the Email section, tag per
 * campaign, demo brands excluded at the query AND by the shared helper).
 * Partial success mirrors the manual path: the campaign is 'sent'.
 */
async function sendDueScheduledCampaigns() {
  const baseUrl = getPublicBaseUrl(null);
  const due = await db.query(
    `SELECT c.campaign_id
     FROM email_marketing_campaigns c
     JOIN brands b ON b.brand_id = c.brand_id
     WHERE c.campaign_type = 'one-time' AND c.status = 'scheduled'
       AND c.scheduled_at IS NOT NULL AND c.scheduled_at <= NOW()
       AND b.is_demo = false
     ORDER BY c.scheduled_at ASC
     LIMIT 20`
  );

  let processed = 0;
  let sentCampaigns = 0;
  let failedCampaigns = 0;
  // Alerts fire after each claim transaction COMMITs, never inside it.
  for (const { campaign_id } of due.rows) {
    const client = await db.getClient();
    let alertInfo = null;
    try {
      await client.query("BEGIN");
      const claim = await client.query(
        `SELECT c.campaign_id, c.brand_id, c.campaign_name
         FROM email_marketing_campaigns c
         WHERE c.campaign_id = $1 AND c.campaign_type = 'one-time'
           AND c.status = 'scheduled'
           AND c.scheduled_at IS NOT NULL AND c.scheduled_at <= NOW()
         FOR UPDATE OF c SKIP LOCKED`,
        [campaign_id]
      );
      const campaign = claim.rows[0];
      if (!campaign) {
        await client.query("ROLLBACK");
        continue;
      }
      processed += 1;

      const emailResult = await client.query(
        `SELECT subject_line, body_html FROM email_marketing_emails
         WHERE campaign_id = $1 AND sequence_position = 0`,
        [campaign_id]
      );
      const email = emailResult.rows[0];

      let recipients = { rows: [] };
      if (email) {
        recipients = await client.query(
          `SELECT recipient_id, email_address FROM email_marketing_recipients
           WHERE campaign_id = $1 AND delivery_status = 'pending'`,
          [campaign_id]
        );
      }

      let sent = 0;
      let lastError = null;
      if (!email) {
        lastError = "This campaign has no email to send.";
      } else if (recipients.rows.length === 0) {
        lastError = "No recipients left to send to (all unsubscribed or none matched).";
      }

      for (const r of recipients.rows) {
        if (await isOptedOut(campaign.brand_id, r.email_address, client)) {
          await client.query(
            `UPDATE email_marketing_recipients
             SET delivery_status = 'unsubscribed', unsubscribed_at = NOW(), updated_at = NOW()
             WHERE recipient_id = $1`,
            [r.recipient_id]
          );
          continue;
        }
        try {
          const html = buildTrackedHtml(email.body_html, {
            recipientId: r.recipient_id,
            brandId: campaign.brand_id,
            email: r.email_address,
            baseUrl,
          });
          await sendEmail({ to: r.email_address, subject: email.subject_line, html });
          await client.query(
            `UPDATE email_marketing_recipients
             SET delivery_status = 'sent', updated_at = NOW()
             WHERE recipient_id = $1`,
            [r.recipient_id]
          );
          sent += 1;
        } catch (err) {
          lastError = err.message;
          await client.query(
            `UPDATE email_marketing_recipients
             SET delivery_status = 'failed', updated_at = NOW()
             WHERE recipient_id = $1`,
            [r.recipient_id]
          );
          console.error(
            `Scheduled blast send failed (recipient ${r.recipient_id}):`,
            err.message
          );
        }
      }

      if (sent > 0) {
        await client.query(
          `UPDATE email_marketing_campaigns
           SET status = 'sent', sent_count = sent_count + $1, sent_at = NOW(), updated_at = NOW()
           WHERE campaign_id = $2 AND status = 'scheduled'`,
          [sent, campaign_id]
        );
        sentCampaigns += 1;
      } else {
        // Total failure: the real scheduled -> failed transition. Row-count
        // guarded so only the transaction that made the flip alerts.
        const flipped = await client.query(
          `UPDATE email_marketing_campaigns
           SET status = 'failed', updated_at = NOW()
           WHERE campaign_id = $1 AND status = 'scheduled'
           RETURNING campaign_id`,
          [campaign_id]
        );
        if (flipped.rows.length > 0) {
          failedCampaigns += 1;
          alertInfo = {
            campaignId: campaign_id,
            brandId: campaign.brand_id,
            campaignName: campaign.campaign_name,
            reason: lastError || "No emails could be sent.",
          };
        }
      }
      await client.query("COMMIT");
    } catch (err) {
      alertInfo = null;
      await client.query("ROLLBACK").catch(() => {});
      console.error("Scheduled blast worker error:", err.message);
    } finally {
      client.release();
    }
    // Best-effort: alertOwnerOfFailedSend never throws, skips demo brands.
    if (alertInfo) await alertOwnerOfFailedEmailBlast(alertInfo);
  }

  return { processed, sent: sentCampaigns, failed: failedCampaigns };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** GET /api/email-marketing/campaigns/:brandId — list campaigns with rates. */
async function getCampaigns(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const result = await db.query(
      `SELECT c.campaign_id, c.campaign_name, c.campaign_type, c.goal,
              c.segment_filter, c.status, c.recipient_count, c.sent_count,
              c.open_count, c.click_count, c.scheduled_at, c.sent_at,
              c.created_at, c.updated_at,
              COALESCE(f.failed_count, 0)::int AS failed_count
       FROM email_marketing_campaigns c
       LEFT JOIN (
         SELECT campaign_id, COUNT(*) AS failed_count
         FROM email_marketing_recipients
         WHERE delivery_status = 'failed'
         GROUP BY campaign_id
       ) f ON f.campaign_id = c.campaign_id
       WHERE c.brand_id = $1
       ORDER BY c.created_at DESC`,
      [brandId]
    );
    const rate = (num, denom) => (denom > 0 ? num / denom : 0);
    const campaigns = result.rows.map((row) => ({
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      campaignType: row.campaign_type,
      goal: row.goal,
      segment: row.segment_filter,
      status: row.status,
      recipientCount: row.recipient_count,
      sentCount: row.sent_count,
      openCount: row.open_count,
      clickCount: row.click_count,
      failedCount: row.failed_count,
      openRate: rate(row.open_count, row.sent_count),
      clickRate: rate(row.click_count, row.sent_count),
      scheduledAt: row.scheduled_at,
      sentAt: row.sent_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    return res.json({ brandId, count: campaigns.length, campaigns });
  } catch (err) {
    console.error("Get campaigns error:", err.message);
    return res.status(500).json({ error: "Failed to fetch campaigns" });
  }
}

/** GET /api/email-marketing/campaign/:campaignId — campaign + emails + recipients. */
async function getCampaignDetail(req, res) {
  const userId = req.user.userId;
  const { campaignId } = req.params;
  try {
    const campaign = await getOwnedCampaign(userId, campaignId);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    const emails = await db.query(
      `SELECT email_id, sequence_position, subject_line, preview_text,
              body_html, body_plain_text, send_delay_days
       FROM email_marketing_emails
       WHERE campaign_id = $1 ORDER BY sequence_position ASC`,
      [campaignId]
    );
    const recipients = await db.query(
      `SELECT recipient_id, email_address, delivery_status, current_step,
              opened_at, clicked_at, unsubscribed_at
       FROM email_marketing_recipients
       WHERE campaign_id = $1 ORDER BY created_at ASC LIMIT 500`,
      [campaignId]
    );
    return res.json({
      campaign,
      emails: emails.rows,
      recipients: recipients.rows,
    });
  } catch (err) {
    console.error("Get campaign detail error:", err.message);
    return res.status(500).json({ error: "Failed to fetch campaign detail" });
  }
}

async function setCampaignStatus(req, res, statuses, targetStatus, label) {
  const userId = req.user.userId;
  const { campaignId } = req.params;
  try {
    const campaign = await getOwnedCampaign(userId, campaignId);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (campaign.campaign_type !== "drip") {
      return res.status(400).json({ error: `Only drip sequences can be ${label}` });
    }
    if (!statuses.includes(campaign.status)) {
      return res.status(400).json({ error: `Campaign cannot be ${label} from its current state` });
    }
    await db.query(
      `UPDATE email_marketing_campaigns SET status = $1, updated_at = NOW() WHERE campaign_id = $2`,
      [targetStatus, campaignId]
    );
    return res.json({ campaignId, status: targetStatus });
  } catch (err) {
    console.error(`${label} campaign error:`, err.message);
    return res.status(500).json({ error: `Failed to ${label} campaign` });
  }
}

/** POST /api/email-marketing/campaigns/:campaignId/pause */
function pauseCampaign(req, res) {
  return setCampaignStatus(req, res, ["sending", "scheduled"], "paused", "pause");
}

/** POST /api/email-marketing/campaigns/:campaignId/resume */
function resumeCampaign(req, res) {
  return setCampaignStatus(req, res, ["paused"], "sending", "resume");
}

/** DELETE /api/email-marketing/campaigns/:campaignId — cancel + remove. */
async function cancelCampaign(req, res) {
  const userId = req.user.userId;
  const { campaignId } = req.params;
  try {
    const campaign = await getOwnedCampaign(userId, campaignId);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    await db.query(`DELETE FROM email_marketing_campaigns WHERE campaign_id = $1`, [campaignId]);
    return res.json({ campaignId, deleted: true });
  } catch (err) {
    console.error("Cancel campaign error:", err.message);
    return res.status(500).json({ error: "Failed to cancel campaign" });
  }
}

/** GET /api/email-marketing/contacts/:brandId — leads + subscription state. */
async function getContacts(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const result = await db.query(
      `SELECT l.lead_id, l.lead_name, l.email, l.temperature, l.conversion_status,
              (o.opt_out_id IS NOT NULL) AS unsubscribed
       FROM leads l
       LEFT JOIN email_opt_outs o
         ON o.brand_id = l.brand_id AND lower(o.email_address) = lower(l.email)
       WHERE l.brand_id = $1 AND l.email IS NOT NULL AND l.email <> ''
       ORDER BY l.created_at DESC`,
      [brandId]
    );
    const contacts = result.rows.map((row) => ({
      leadId: row.lead_id,
      name: row.lead_name,
      email: row.email,
      temperature: row.temperature,
      conversionStatus: row.conversion_status,
      subscribed: !row.unsubscribed,
    }));
    return res.json({
      brandId,
      count: contacts.length,
      subscribed: contacts.filter((c) => c.subscribed).length,
      contacts,
    });
  } catch (err) {
    console.error("Get contacts error:", err.message);
    return res.status(500).json({ error: "Failed to fetch contacts" });
  }
}

/** GET /api/email-marketing/analytics/:brandId — totals + 30-day activity. */
async function getAnalytics(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const totals = await db.query(
      `SELECT
         COUNT(*)::int AS total_campaigns,
         COALESCE(SUM(sent_count), 0)::int AS total_sent,
         COALESCE(SUM(open_count), 0)::int AS total_opens,
         COALESCE(SUM(click_count), 0)::int AS total_clicks
       FROM email_marketing_campaigns WHERE brand_id = $1`,
      [brandId]
    );
    const t = totals.rows[0];

    const monthSent = await db.query(
      `SELECT COUNT(*)::int AS sent_this_month
       FROM email_marketing_recipients r
       JOIN email_marketing_campaigns c ON c.campaign_id = r.campaign_id
       WHERE c.brand_id = $1 AND r.delivery_status = 'sent'
         AND r.updated_at >= date_trunc('month', NOW())`,
      [brandId]
    );

    const activity = await db.query(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              COALESCE(s.sent, 0)::int AS sent,
              COALESCE(s.opened, 0)::int AS opened
       FROM generate_series(
              date_trunc('day', NOW()) - INTERVAL '29 days',
              date_trunc('day', NOW()), INTERVAL '1 day') AS d(day)
       LEFT JOIN (
         SELECT date_trunc('day', r.updated_at) AS day,
                COUNT(*) FILTER (WHERE r.delivery_status = 'sent') AS sent,
                COUNT(*) FILTER (WHERE r.opened_at IS NOT NULL) AS opened
         FROM email_marketing_recipients r
         JOIN email_marketing_campaigns c ON c.campaign_id = r.campaign_id
         WHERE c.brand_id = $1
           AND r.updated_at >= date_trunc('day', NOW()) - INTERVAL '29 days'
         GROUP BY 1
       ) s ON s.day = d.day
       ORDER BY d.day ASC`,
      [brandId]
    );

    const rate = (num, denom) => (denom > 0 ? num / denom : 0);
    return res.json({
      brandId,
      totalCampaigns: t.total_campaigns,
      totalSent: t.total_sent,
      totalOpens: t.total_opens,
      totalClicks: t.total_clicks,
      sentThisMonth: monthSent.rows[0].sent_this_month,
      avgOpenRate: rate(t.total_opens, t.total_sent),
      avgClickRate: rate(t.total_clicks, t.total_sent),
      activity: activity.rows,
    });
  } catch (err) {
    console.error("Get analytics error:", err.message);
    return res.status(500).json({ error: "Failed to fetch analytics" });
  }
}

// ---------------------------------------------------------------------------
// Public endpoints (no auth): tracking + unsubscribe
// ---------------------------------------------------------------------------

/** GET /api/email-marketing/open/:recipientId — open-tracking pixel. */
async function trackOpen(req, res) {
  const { recipientId } = req.params;
  try {
    await db.query(
      `UPDATE email_marketing_campaigns c
       SET open_count = open_count + 1, updated_at = NOW()
       FROM email_marketing_recipients r
       WHERE r.recipient_id = $1 AND r.campaign_id = c.campaign_id
         AND r.opened_at IS NULL`,
      [recipientId]
    );
    await db.query(
      `UPDATE email_marketing_recipients
       SET opened_at = COALESCE(opened_at, NOW()), updated_at = NOW()
       WHERE recipient_id = $1`,
      [recipientId]
    );
  } catch (err) {
    console.error("Track open error:", err.message);
  }
  res.set("Content-Type", "image/gif");
  res.set("Cache-Control", "no-store, max-age=0");
  return res.end(TRACKING_PIXEL);
}

/** GET /api/email-marketing/click/:recipientId?u= — click tracker + redirect.
 * `u` is the AES-GCM encrypted destination URL (authored by us), preventing the
 * endpoint from being used as an open redirector. */
async function trackClick(req, res) {
  const { recipientId } = req.params;
  const token = req.query.u;
  let url = null;
  if (token) {
    try {
      url = decrypt(decodeURIComponent(token));
    } catch {
      url = null;
    }
  }
  if (!url || !isHttpUrl(url)) {
    return res.status(400).send("Invalid link");
  }
  try {
    await db.query(
      `UPDATE email_marketing_campaigns c
       SET click_count = click_count + 1, updated_at = NOW()
       FROM email_marketing_recipients r
       WHERE r.recipient_id = $1 AND r.campaign_id = c.campaign_id
         AND r.clicked_at IS NULL`,
      [recipientId]
    );
    await db.query(
      `UPDATE email_marketing_recipients
       SET clicked_at = COALESCE(clicked_at, NOW()), updated_at = NOW()
       WHERE recipient_id = $1`,
      [recipientId]
    );
  } catch (err) {
    console.error("Track click error:", err.message);
  }
  return res.redirect(302, url);
}

function unsubPage(message) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unsubscribe</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0b0c;color:#e5e7eb;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}.card{max-width:420px;padding:32px;border:1px solid #27272a;border-radius:16px;background:#111113;text-align:center}h1{font-size:20px;margin:0 0 12px}p{font-size:14px;color:#9ca3af;line-height:1.6;margin:0}</style></head><body><div class="card"><h1>EchoAI</h1><p>${message}</p></div></body></html>`;
}

/** Records an opt-out for (brandId, email) and marks any pending recipient rows. */
async function applyUnsubscribe(brandId, email) {
  await db.query(
    `INSERT INTO email_opt_outs (brand_id, email_address)
     VALUES ($1, $2)
     ON CONFLICT (brand_id, email_address) DO NOTHING`,
    [brandId, email]
  );
  await db.query(
    `UPDATE email_marketing_recipients r
     SET delivery_status = 'unsubscribed', unsubscribed_at = NOW(),
         next_send_at = NULL, updated_at = NOW()
     FROM email_marketing_campaigns c
     WHERE r.campaign_id = c.campaign_id AND c.brand_id = $1
       AND lower(r.email_address) = lower($2)
       AND r.delivery_status = 'pending'`,
    [brandId, email]
  );
}

/**
 * GET|POST /api/email-marketing/unsubscribe?token= — public unsubscribe. The
 * token is the AES-GCM payload embedded in every email's footer link.
 */
async function unsubscribe(req, res) {
  const token = req.query.token || (req.body && req.body.token);
  const wantsHtml = req.method === "GET";
  if (!token) {
    return wantsHtml
      ? res.status(400).send(unsubPage("This unsubscribe link is invalid."))
      : res.status(400).json({ error: "token is required" });
  }
  let payload;
  try {
    payload = JSON.parse(decrypt(decodeURIComponent(token)));
  } catch {
    return wantsHtml
      ? res.status(400).send(unsubPage("This unsubscribe link is invalid or has expired."))
      : res.status(400).json({ error: "Invalid token" });
  }
  if (!payload || !payload.brandId || !payload.email) {
    return wantsHtml
      ? res.status(400).send(unsubPage("This unsubscribe link is invalid."))
      : res.status(400).json({ error: "Invalid token" });
  }
  try {
    await applyUnsubscribe(payload.brandId, payload.email);
  } catch (err) {
    console.error("Unsubscribe error:", err.message);
    return wantsHtml
      ? res.status(500).send(unsubPage("Something went wrong. Please try again later."))
      : res.status(500).json({ error: "Failed to unsubscribe" });
  }
  return wantsHtml
    ? res.send(unsubPage("You've been unsubscribed and won't receive further emails from this business."))
    : res.json({ unsubscribed: true });
}

module.exports = {
  generateCampaignEmail,
  generateDripSequence,
  createCampaign,
  createDripSequence,
  sendCampaign,
  scheduleCampaign,
  unscheduleCampaign,
  sendDueDripEmails,
  retryDripRecipient,
  retryFailedDripRecipients,
  sendDueScheduledCampaigns,
  getCampaigns,
  getCampaignDetail,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  getContacts,
  getAnalytics,
  trackOpen,
  trackClick,
  unsubscribe,
};
