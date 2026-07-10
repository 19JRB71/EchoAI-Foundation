/**
 * Two-Way SMS Marketing controller (Professional tier).
 *
 * - Bulk AI-written SMS campaigns to a recipient segment (queued, then sent via
 *   each brand's own Twilio number).
 * - Two-way inbound: a public Twilio webhook auto-replies with an on-brand AI
 *   message, threads the conversation onto the lead, scores temperature, and
 *   fires the hot-lead alert on a non-hot -> hot transition.
 * - Opt-out: STOP keywords + every outbound send is checked against the
 *   platform-wide `sms_opt_outs` table (see utils/smsOptOut.js).
 *
 * Conventions followed: ownership via getOwnedBrand (404 on foreign brand),
 * AI upstream failures -> 502 (never mocked), AI output validated before
 * persistence, Twilio creds decrypted from twilio_config and never returned.
 */

const db = require("../config/db");
const twilioLib = require("twilio");
const { decrypt } = require("../utils/encryption");
const { buildClient, getPublicBaseUrl, validateTwilioRequest } = require("../config/twilio");
const { normalizeE164 } = require("../utils/phone");
const { applyLeadGeo } = require("../utils/leadGeoFlag");
const { isOptedOut, recordOptOut, removeOptOut, canonical } = require("../utils/smsOptOut");
const {
  generateSmsVariations,
  generateSmsAutoReply,
  VALID_TEMPERATURES,
} = require("../prompts/smsMarketingPrompt");
const autonomousEngine = require("./autonomousConversationController");
const emailController = require("./emailController");
const pushController = require("./pushController");
const mobilePushController = require("./mobilePushController");
const { alertOwnerOfFailedSend } = require("../utils/failedSendAlerts");

const SEGMENTS = ["all", "hot", "warm", "tire_kicker", "specific"];
const STOP_KEYWORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
const START_KEYWORDS = ["START", "UNSTOP", "YES"];

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Loads a brand only if it belongs to the authed user. */
async function getOwnedBrand(userId, brandId) {
  const { rows } = await db.query(
    `SELECT brand_id, brand_name, brand_personality, voice_description, target_audience
     FROM brands WHERE brand_id = $1 AND user_id = $2`,
    [brandId, userId],
  );
  return rows[0] || null;
}

/** Loads a brand's decrypted Twilio config, or null. */
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

/** Maps an Anthropic/OpenAI upstream error to a clean 502, anything else to 500. */
function handleAiError(res, err, label) {
  const status = err.status || err.statusCode;
  const upstream =
    err.aiInvalid === true ||
    status === 429 ||
    status === 401 ||
    status === 402 ||
    status === 529 ||
    (status >= 500 && status < 600) ||
    /anthropic|rate|quota|billing|overloaded/i.test(err.message || "");
  if (upstream) {
    return res.status(502).json({
      error: `The AI service is temporarily unavailable while ${label}. Please try again in a moment.`,
    });
  }
  console.error(`${label} failed:`, err.message);
  return res.status(500).json({ error: `Failed while ${label}.` });
}

// Twilio error codes that mean the message can NEVER be delivered as-is:
// invalid / non-mobile / unreachable numbers, opted-out recipients, and
// from-number problems. Retrying these unchanged just fails again — the owner
// has to fix the recipient (or the Twilio number) first. Everything else
// (network blips, 5xx, rate limits, transient carrier errors) is treated as
// retryable. See https://www.twilio.com/docs/api/errors
const PERMANENT_TWILIO_CODES = new Set([
  21211, // Invalid 'To' phone number
  21214, // 'To' phone number cannot be reached
  21217, // Phone number does not appear to be valid
  21401, // Invalid phone number
  21421, // PhoneNumber is not a valid phone number
  21610, // Recipient has opted out (unsubscribed)
  21612, // Cannot route to this number
  21614, // 'To' number is not a valid mobile number
  21408, // Permission to send to this region not enabled
  21606, // 'From' number not a valid, SMS-capable Twilio number
  21611, // This 'From' number has exceeded the max queue size
  30003, // Unreachable destination handset
  30005, // Unknown destination handset
  30006, // Landline or unreachable carrier
]);

/**
 * Classifies a Twilio send error into an owner-friendly reason string and a
 * permanence flag. `permanent === true` means retrying the blast unchanged
 * won't help; the owner must fix the number (or Twilio config) first.
 */
function classifySmsError(err) {
  const code = err && (err.code || err.status);
  const permanent = typeof code === "number" && PERMANENT_TWILIO_CODES.has(code);
  const message = (err && err.message ? String(err.message) : "Send failed").slice(0, 300);
  return { message, permanent };
}

/** Resolves the leads (with a phone number) that match a campaign segment. */
async function resolveRecipients(brandId, segment, leadIds) {
  if (segment === "specific") {
    if (!Array.isArray(leadIds) || leadIds.length === 0) return [];
    const { rows } = await db.query(
      `SELECT lead_id, lead_name, phone, temperature
       FROM leads
       WHERE brand_id = $1 AND lead_id = ANY($2::uuid[])
         AND phone IS NOT NULL AND phone <> ''`,
      [brandId, leadIds],
    );
    return rows;
  }
  if (["hot", "warm", "tire_kicker"].includes(segment)) {
    const { rows } = await db.query(
      `SELECT lead_id, lead_name, phone, temperature
       FROM leads
       WHERE brand_id = $1 AND temperature = $2
         AND phone IS NOT NULL AND phone <> ''`,
      [brandId, segment],
    );
    return rows;
  }
  // "all"
  const { rows } = await db.query(
    `SELECT lead_id, lead_name, phone, temperature
     FROM leads
     WHERE brand_id = $1 AND phone IS NOT NULL AND phone <> ''`,
    [brandId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Campaign copy generation
// ---------------------------------------------------------------------------

/** POST /api/sms/generate  { brandId, goal, audienceSegment?, callToAction? } */
async function generateMessages(req, res) {
  const userId = req.user.userId;
  const { brandId, goal, audienceSegment, callToAction } = req.body || {};
  if (!brandId || !goal) {
    return res.status(400).json({ error: "brandId and goal are required" });
  }
  const brand = await getOwnedBrand(userId, brandId);
  if (!brand) return res.status(404).json({ error: "Brand not found" });

  try {
    const variations = await generateSmsVariations(brand, goal, audienceSegment, callToAction);
    return res.json({ variations });
  } catch (err) {
    return handleAiError(res, err, "generating SMS variations");
  }
}

// ---------------------------------------------------------------------------
// Campaign create (queue) + send
// ---------------------------------------------------------------------------

/**
 * POST /api/sms/campaigns
 * { brandId, campaignName, messageContent, segmentFilter?, leadIds?, scheduledAt? }
 * Creates a draft campaign and queues one outbound message row per recipient.
 */
async function createCampaign(req, res) {
  const userId = req.user.userId;
  const { brandId, campaignName, messageContent, segmentFilter, leadIds, scheduledAt } =
    req.body || {};
  if (!brandId || !campaignName || !messageContent) {
    return res
      .status(400)
      .json({ error: "brandId, campaignName, and messageContent are required" });
  }
  const segment = SEGMENTS.includes(segmentFilter) ? segmentFilter : "all";

  const brand = await getOwnedBrand(userId, brandId);
  if (!brand) return res.status(404).json({ error: "Brand not found" });

  const recipients = await resolveRecipients(brandId, segment, leadIds);
  if (recipients.length === 0) {
    return res
      .status(400)
      .json({ error: "No recipients with a phone number match this segment" });
  }

  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO sms_campaigns
         (brand_id, campaign_name, message_content, segment_filter, recipient_count, scheduled_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        brandId,
        campaignName,
        messageContent,
        segment,
        recipients.length,
        scheduledAt || null,
      ],
    );
    const campaign = rows[0];

    for (const r of recipients) {
      await client.query(
        `INSERT INTO sms_messages
           (campaign_id, brand_id, lead_id, direction, message_body, delivery_status)
         VALUES ($1, $2, $3, 'outbound', $4, 'queued')`,
        [campaign.campaign_id, brandId, r.lead_id, messageContent],
      );
    }
    await client.query("COMMIT");
    return res.status(201).json({ campaign });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Create SMS campaign failed:", err.message);
    return res.status(500).json({ error: "Failed to create the campaign" });
  } finally {
    client.release();
  }
}

/**
 * POST /api/sms/campaigns/:campaignId/send
 * Sends every queued message in a campaign via the brand's Twilio number,
 * skipping opted-out numbers. Idempotent-ish: only ever sends 'queued' rows.
 */
async function sendCampaign(req, res) {
  const userId = req.user.userId;
  const { campaignId } = req.params;

  const { rows: campRows } = await db.query(
    `SELECT c.*
     FROM sms_campaigns c
     JOIN brands b ON b.brand_id = c.brand_id
     WHERE c.campaign_id = $1 AND b.user_id = $2`,
    [campaignId, userId],
  );
  const campaign = campRows[0];
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });
  if (campaign.status === "sending") {
    return res.status(409).json({ error: "Campaign is already being sent" });
  }
  if (campaign.status === "sent") {
    return res.status(409).json({ error: "Campaign has already been sent" });
  }

  const cfg = await getTwilioConfig(campaign.brand_id);
  if (!cfg) {
    return res
      .status(400)
      .json({ error: "Connect a Twilio number for this brand before sending SMS" });
  }

  // Atomic single-flight claim: only one request can transition the campaign
  // out of a sendable state, so concurrent sends can't both fetch the queued
  // rows and double-send.
  const { rows: claimed } = await db.query(
    `UPDATE sms_campaigns SET status = 'sending', updated_at = NOW()
     WHERE campaign_id = $1 AND status IN ('draft', 'failed')
     RETURNING campaign_id`,
    [campaignId],
  );
  if (claimed.length === 0) {
    return res.status(409).json({ error: "Campaign is already being sent" });
  }

  const outcome = await deliverQueuedMessages(campaign, cfg);
  return res.json(outcome);
}

/**
 * Shared send engine for sendCampaign and retryCampaign. The caller MUST have
 * already claimed the campaign atomically (status flipped to 'sending' with a
 * row-count-checked UPDATE) so only one request can be in here per campaign.
 * Sends every 'queued' outbound message, then makes the status-guarded final
 * flip and fires the failure alert only when this run's flip really landed.
 * Returns { campaign, delivered, skipped, failed }.
 */
async function deliverQueuedMessages(campaign, cfg) {
  const campaignId = campaign.campaign_id;
  const { rows: queued } = await db.query(
    `SELECT m.message_id, m.message_body, l.phone
     FROM sms_messages m
     LEFT JOIN leads l ON l.lead_id = m.lead_id
     WHERE m.campaign_id = $1 AND m.direction = 'outbound' AND m.delivery_status = 'queued'`,
    [campaignId],
  );

  const client = buildClient(cfg.accountSid, cfg.authToken);
  let delivered = 0;
  let skipped = 0;
  let failed = 0;
  let lastError = null;

  for (const msg of queued) {
    if (!msg.phone) {
      await db.query(
        `UPDATE sms_messages
         SET delivery_status = 'failed', error_message = $2, error_permanent = TRUE
         WHERE message_id = $1`,
        [msg.message_id, "Recipient has no phone number on file."],
      );
      failed += 1;
      lastError = lastError || "Recipient has no phone number on file.";
      continue;
    }
    if (await isOptedOut(campaign.brand_id, msg.phone)) {
      await db.query(
        `UPDATE sms_messages SET delivery_status = 'skipped' WHERE message_id = $1`,
        [msg.message_id],
      );
      skipped += 1;
      continue;
    }
    try {
      const sent = await client.messages.create({
        to: msg.phone,
        from: cfg.phoneNumber,
        body: msg.message_body,
      });
      await db.query(
        `UPDATE sms_messages
         SET delivery_status = 'sent', twilio_message_sid = $2, sent_at = NOW(),
             error_message = NULL, error_permanent = NULL
         WHERE message_id = $1`,
        [msg.message_id, sent.sid || null],
      );
      delivered += 1;
    } catch (err) {
      console.error("SMS send failed:", err.message);
      const { message: reason, permanent } = classifySmsError(err);
      await db.query(
        `UPDATE sms_messages
         SET delivery_status = 'failed', error_message = $2, error_permanent = $3
         WHERE message_id = $1`,
        [msg.message_id, reason, permanent],
      );
      failed += 1;
      lastError = err.message;
    }
  }

  // Status-guarded final flip: only the 'sending' row this request claimed can
  // transition, and the row count tells us whether the transition really
  // happened here (the health monitor's stale-send rescue can steal it if the
  // loop ran unusually long — that path alerts the owner itself).
  // delivered_count is recomputed from the messages table so a retry run
  // reflects the campaign's TOTAL sent messages, not just this run's.
  const finalStatus = delivered > 0 || skipped > 0 ? "sent" : "failed";
  const { rows: updated } = await db.query(
    `UPDATE sms_campaigns
     SET status = $2,
         delivered_count = (
           SELECT COUNT(*) FROM sms_messages
           WHERE campaign_id = $1 AND direction = 'outbound'
             AND delivery_status = 'sent'
         ),
         sent_at = NOW(), updated_at = NOW()
     WHERE campaign_id = $1 AND status = 'sending'
     RETURNING *`,
    [campaignId, finalStatus],
  );

  if (updated.length > 0 && finalStatus === "failed") {
    // Every recipient failed (Twilio outage, revoked credentials, bad
    // numbers): a blast can finish long after the owner walked away, so push
    // the failure alert too. Best-effort, demo brands skipped by the helper,
    // per-campaign tag dedupes.
    await alertOwnerOfFailedSmsCampaign({
      campaignId,
      brandId: campaign.brand_id,
      campaignName: campaign.campaign_name,
      reason: lastError || "No messages could be sent.",
    });
  }

  const campaignRow =
    updated[0] ||
    (await db.query(`SELECT * FROM sms_campaigns WHERE campaign_id = $1`, [campaignId]))
      .rows[0];

  return { campaign: campaignRow, delivered, skipped, failed };
}

/**
 * POST /api/sms/campaigns/:campaignId/retry
 * One-tap recovery for a failed SMS blast: atomically claims the campaign
 * failed -> 'sending' (row-count guarded, so concurrent retries/sends can't
 * both run), re-queues this campaign's failed outbound messages, and runs the
 * shared send engine. Already-sent messages stay 'sent' and are never
 * re-queued, so a retry can't double-text anyone; opted-out numbers are
 * re-checked (and re-skipped) by the send loop.
 */
async function retryCampaign(req, res) {
  const userId = req.user.userId;
  const { campaignId } = req.params;

  const { rows: campRows } = await db.query(
    `SELECT c.*
     FROM sms_campaigns c
     JOIN brands b ON b.brand_id = c.brand_id
     WHERE c.campaign_id = $1 AND b.user_id = $2`,
    [campaignId, userId],
  );
  const campaign = campRows[0];
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  const cfg = await getTwilioConfig(campaign.brand_id);
  if (!cfg) {
    return res
      .status(400)
      .json({ error: "Connect a Twilio number for this brand before sending SMS" });
  }

  // Atomic single-flight claim, retry-specific: ONLY a failed campaign may be
  // retried. Claiming before the re-queue means no concurrent send/retry can
  // pick up the re-queued rows (sendCampaign only claims draft/failed).
  const { rows: claimed } = await db.query(
    `UPDATE sms_campaigns SET status = 'sending', updated_at = NOW()
     WHERE campaign_id = $1 AND status = 'failed'
     RETURNING campaign_id`,
    [campaignId],
  );
  if (claimed.length === 0) {
    return res.status(409).json({
      error: `Only failed campaigns can be retried (this campaign is '${campaign.status}')`,
    });
  }

  await db.query(
    `UPDATE sms_messages
     SET delivery_status = 'queued', twilio_message_sid = NULL, sent_at = NULL,
         error_message = NULL, error_permanent = NULL
     WHERE campaign_id = $1 AND direction = 'outbound' AND delivery_status = 'failed'`,
    [campaignId],
  );

  const outcome = await deliverQueuedMessages(campaign, cfg);
  return res.json(outcome);
}

/**
 * Alerts the brand owner that an SMS blast flipped to 'failed'. Callers invoke
 * this only where the atomic -> 'failed' transition really happened (row-count
 * branch); the per-campaign tag collapses duplicate deliveries; demo brands
 * never alert. Deep-links to the SMS section for a one-tap retry.
 */
async function alertOwnerOfFailedSmsCampaign({ campaignId, brandId, campaignName, reason }) {
  const why = String(reason || "Unknown error").slice(0, 160);
  const label = campaignName ? `"${campaignName}"` : "your SMS blast";
  await alertOwnerOfFailedSend({
    brandId,
    title: "⚠️ SMS blast failed to send",
    buildBody: (brand) =>
      `SMS blast ${label} for ${brand.brand_name} didn't send: ${why} Tap to review.`,
    url: "/dashboard?section=sms",
    tag: `sms-campaign-failed-${campaignId}`,
    mobileData: { type: "sms_campaign_failed", campaignId: String(campaignId) },
    logLabel: "Failed-SMS-campaign",
  });
}

// ---------------------------------------------------------------------------
// Campaign reads
// ---------------------------------------------------------------------------

/** GET /api/sms/campaigns/:brandId */
async function getCampaigns(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  const brand = await getOwnedBrand(userId, brandId);
  if (!brand) return res.status(404).json({ error: "Brand not found" });

  const { rows } = await db.query(
    `SELECT campaign_id, campaign_name, message_content, segment_filter, status,
            recipient_count, delivered_count, reply_count, scheduled_at, sent_at, created_at
     FROM sms_campaigns
     WHERE brand_id = $1
     ORDER BY created_at DESC`,
    [brandId],
  );
  return res.json({ campaigns: rows });
}

/** GET /api/sms/campaign/:campaignId — campaign + per-recipient delivery rows. */
async function getCampaignDetail(req, res) {
  const userId = req.user.userId;
  const { campaignId } = req.params;

  const { rows: campRows } = await db.query(
    `SELECT c.*
     FROM sms_campaigns c
     JOIN brands b ON b.brand_id = c.brand_id
     WHERE c.campaign_id = $1 AND b.user_id = $2`,
    [campaignId, userId],
  );
  const campaign = campRows[0];
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  const { rows: messages } = await db.query(
    `SELECT m.message_id, m.lead_id, m.message_body, m.delivery_status, m.sent_at,
            m.error_message, m.error_permanent,
            l.lead_name, l.phone, l.temperature
     FROM sms_messages m
     LEFT JOIN leads l ON l.lead_id = m.lead_id
     WHERE m.campaign_id = $1 AND m.direction = 'outbound'
     ORDER BY m.created_at ASC`,
    [campaignId],
  );
  return res.json({ campaign, messages });
}

// ---------------------------------------------------------------------------
// Conversations (two-way threads) + manual reply
// ---------------------------------------------------------------------------

/** GET /api/sms/conversations/:brandId */
async function getConversations(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  const brand = await getOwnedBrand(userId, brandId);
  if (!brand) return res.status(404).json({ error: "Brand not found" });

  const { rows } = await db.query(
    `SELECT m.message_id, m.lead_id, m.direction, m.message_body, m.delivery_status,
            m.created_at, l.lead_name, l.phone, l.temperature
     FROM sms_messages m
     LEFT JOIN leads l ON l.lead_id = m.lead_id
     WHERE m.brand_id = $1 AND m.lead_id IS NOT NULL
     ORDER BY m.created_at ASC`,
    [brandId],
  );

  const byLead = new Map();
  for (const m of rows) {
    if (!byLead.has(m.lead_id)) {
      byLead.set(m.lead_id, {
        leadId: m.lead_id,
        leadName: m.lead_name,
        phone: m.phone,
        temperature: m.temperature,
        messages: [],
        lastMessageAt: null,
      });
    }
    const thread = byLead.get(m.lead_id);
    thread.messages.push({
      messageId: m.message_id,
      direction: m.direction,
      body: m.message_body,
      deliveryStatus: m.delivery_status,
      at: m.created_at,
    });
    thread.lastMessageAt = m.created_at;
  }

  const conversations = Array.from(byLead.values()).sort(
    (a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt),
  );
  return res.json({ conversations });
}

/** POST /api/sms/reply  { brandId, leadId, message } — owner manual reply. */
async function sendManualReply(req, res) {
  const userId = req.user.userId;
  const { brandId, leadId, message } = req.body || {};
  if (!brandId || !leadId || !message || !String(message).trim()) {
    return res.status(400).json({ error: "brandId, leadId, and message are required" });
  }
  const brand = await getOwnedBrand(userId, brandId);
  if (!brand) return res.status(404).json({ error: "Brand not found" });

  const { rows: leadRows } = await db.query(
    `SELECT lead_id, phone FROM leads WHERE lead_id = $1 AND brand_id = $2`,
    [leadId, brandId],
  );
  const lead = leadRows[0];
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  if (!lead.phone) return res.status(400).json({ error: "This lead has no phone number" });

  if (await isOptedOut(brandId, lead.phone)) {
    return res.status(409).json({ error: "This contact has opted out of SMS" });
  }

  const cfg = await getTwilioConfig(brandId);
  if (!cfg) {
    return res.status(400).json({ error: "Connect a Twilio number for this brand first" });
  }

  try {
    const client = buildClient(cfg.accountSid, cfg.authToken);
    const sent = await client.messages.create({
      to: lead.phone,
      from: cfg.phoneNumber,
      body: String(message).trim(),
    });
    const { rows } = await db.query(
      `INSERT INTO sms_messages
         (brand_id, lead_id, direction, message_body, twilio_message_sid, delivery_status, sent_at)
       VALUES ($1, $2, 'outbound', $3, $4, 'sent', NOW())
       RETURNING message_id, direction, message_body, delivery_status, created_at`,
      [brandId, leadId, String(message).trim(), sent.sid || null],
    );
    return res.status(201).json({ message: rows[0] });
  } catch (err) {
    console.error("Manual SMS reply failed:", err.message);
    return res.status(502).json({ error: "Failed to send the SMS via Twilio" });
  }
}

// ---------------------------------------------------------------------------
// Contacts + manual re-subscribe
// ---------------------------------------------------------------------------

/** GET /api/sms/contacts/:brandId — leads with a phone + opt-out status. */
async function getContacts(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  const brand = await getOwnedBrand(userId, brandId);
  if (!brand) return res.status(404).json({ error: "Brand not found" });

  const { rows } = await db.query(
    `SELECT l.lead_id, l.lead_name, l.phone, l.temperature, l.conversion_status,
            (o.opt_out_id IS NOT NULL) AS opted_out, o.opted_out_at
     FROM leads l
     LEFT JOIN sms_opt_outs o
       ON o.brand_id = l.brand_id AND o.phone_number = l.phone
     WHERE l.brand_id = $1 AND l.phone IS NOT NULL AND l.phone <> ''
     ORDER BY l.created_at DESC`,
    [brandId],
  );
  return res.json({ contacts: rows });
}

/** POST /api/sms/resubscribe  { brandId, phone } — manual re-subscribe. */
async function resubscribe(req, res) {
  const userId = req.user.userId;
  const { brandId, phone } = req.body || {};
  if (!brandId || !phone) {
    return res.status(400).json({ error: "brandId and phone are required" });
  }
  const brand = await getOwnedBrand(userId, brandId);
  if (!brand) return res.status(404).json({ error: "Brand not found" });

  await removeOptOut(brandId, phone);
  return res.json({ success: true });
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/** GET /api/sms/analytics/:brandId */
async function getAnalytics(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  const brand = await getOwnedBrand(userId, brandId);
  if (!brand) return res.status(404).json({ error: "Brand not found" });

  const [totals, campaignAgg, optOuts, activity] = await Promise.all([
    db.query(
      `SELECT
         COUNT(*) FILTER (WHERE direction = 'outbound') AS sent,
         COUNT(*) FILTER (WHERE direction = 'inbound') AS received
       FROM sms_messages
       WHERE brand_id = $1 AND created_at >= date_trunc('month', NOW())`,
      [brandId],
    ),
    db.query(
      `SELECT
         COUNT(*) AS campaigns,
         COALESCE(SUM(recipient_count), 0) AS recipients,
         COALESCE(SUM(delivered_count), 0) AS delivered,
         COALESCE(SUM(reply_count), 0) AS replies
       FROM sms_campaigns
       WHERE brand_id = $1 AND status = 'sent'`,
      [brandId],
    ),
    db.query(`SELECT COUNT(*) AS n FROM sms_opt_outs WHERE brand_id = $1`, [brandId]),
    db.query(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
              COUNT(*) FILTER (WHERE direction = 'outbound') AS sent,
              COUNT(*) FILTER (WHERE direction = 'inbound') AS received
       FROM sms_messages
       WHERE brand_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY 1 ORDER BY 1 ASC`,
      [brandId],
    ),
  ]);

  const agg = campaignAgg.rows[0];
  const recipients = Number(agg.recipients) || 0;
  const delivered = Number(agg.delivered) || 0;
  const replies = Number(agg.replies) || 0;

  return res.json({
    sentThisMonth: Number(totals.rows[0].sent) || 0,
    receivedThisMonth: Number(totals.rows[0].received) || 0,
    campaignsSent: Number(agg.campaigns) || 0,
    deliveryRate: recipients > 0 ? Math.round((delivered / recipients) * 100) : 0,
    replyRate: delivered > 0 ? Math.round((replies / delivered) * 100) : 0,
    optOuts: Number(optOuts.rows[0].n) || 0,
    activity: activity.rows.map((r) => ({
      day: r.day,
      sent: Number(r.sent) || 0,
      received: Number(r.received) || 0,
    })),
  });
}

// ---------------------------------------------------------------------------
// Inbound webhook (PUBLIC — Twilio calls this; auth via X-Twilio-Signature)
// ---------------------------------------------------------------------------

function emptyTwiml(res) {
  const twiml = new twilioLib.twiml.MessagingResponse();
  return res.type("text/xml").send(twiml.toString());
}

function messageTwiml(res, body) {
  const twiml = new twilioLib.twiml.MessagingResponse();
  twiml.message(body);
  return res.type("text/xml").send(twiml.toString());
}

/** Fires the standard hot-lead alert across email + web push + mobile push. */
async function fireHotLeadAlert(owner, brand, lead, summary) {
  try {
    if (owner.owner_email) {
      await emailController
        .sendHotLeadAlert({
          ownerEmail: owner.owner_email,
          brandName: brand.brand_name,
          lead,
          summary,
        })
        .catch((err) => console.error("Hot-lead email failed:", err.message));
    }
    if (owner.owner_user_id) {
      pushController
        .sendPushToUser(owner.owner_user_id, {
          title: "🔥 Hot SMS lead",
          body: `${lead.lead_name || lead.phone} is a hot lead over SMS`,
          url: "/dashboard",
          tag: `sms-hot-${lead.lead_id}`,
        })
        .catch((err) => console.error("Hot-lead push failed:", err.message));
      mobilePushController
        .sendToUser(owner.owner_user_id, {
          title: "🔥 Hot SMS lead",
          body: `${lead.lead_name || lead.phone} is a hot lead over SMS`,
          data: { type: "hot_lead", leadId: lead.lead_id },
        })
        .catch((err) => console.error("Hot-lead mobile push failed:", err.message));
    }
  } catch (err) {
    console.error("Hot-lead alert failed:", err.message);
  }
}

/**
 * POST /api/sms/inbound — Twilio inbound SMS webhook (public).
 * Always returns 200 + TwiML so Twilio doesn't retry-loop, even on internal error.
 */
async function handleInbound(req, res) {
  try {
    const toNumber = normalizeE164(req.body.To);
    const fromRaw = req.body.From;
    const body = (req.body.Body || "").trim();
    if (!toNumber || !fromRaw) return emptyTwiml(res);

    // Identify the brand (and owner) by the Twilio number that was texted.
    const { rows } = await db.query(
      `SELECT tc.brand_id, tc.auth_token_encrypted,
              b.brand_name, b.brand_personality, b.voice_description, b.target_audience,
              b.user_id AS owner_user_id, u.email AS owner_email
       FROM twilio_config tc
       JOIN brands b ON b.brand_id = tc.brand_id
       JOIN users u ON u.user_id = b.user_id
       WHERE tc.phone_number = $1`,
      [toNumber],
    );
    const cfg = rows[0];
    if (!cfg) return emptyTwiml(res);

    const authToken = decrypt(cfg.auth_token_encrypted);
    const fullUrl = `${getPublicBaseUrl(req)}/api/sms/inbound`;
    if (!validateTwilioRequest(req, authToken, fullUrl)) {
      return res.status(403).type("text/xml").send("Invalid signature");
    }

    const brand = {
      brand_id: cfg.brand_id,
      brand_name: cfg.brand_name,
      brand_personality: cfg.brand_personality,
      voice_description: cfg.voice_description,
      target_audience: cfg.target_audience,
    };
    const owner = { owner_user_id: cfg.owner_user_id, owner_email: cfg.owner_email };
    const upper = body.toUpperCase();

    // Opt-out / opt-in keywords come first.
    if (STOP_KEYWORDS.includes(upper)) {
      await recordOptOut(cfg.brand_id, fromRaw);
      return messageTwiml(
        res,
        "You've been unsubscribed and won't receive further messages. Reply START to resubscribe.",
      );
    }
    if (START_KEYWORDS.includes(upper)) {
      await removeOptOut(cfg.brand_id, fromRaw);
      return messageTwiml(res, "You're resubscribed — welcome back!");
    }

    // Find or create the lead for this conversation (brand-scoped, by phone).
    const fromNorm = normalizeE164(fromRaw) || fromRaw;
    let lead = (
      await db.query(
        `SELECT lead_id, lead_name, phone, temperature, conversation_history
         FROM leads WHERE brand_id = $1 AND phone IN ($2, $3) LIMIT 1`,
        [cfg.brand_id, fromNorm, fromRaw],
      )
    ).rows[0];
    if (!lead) {
      lead = (
        await db.query(
          `INSERT INTO leads (brand_id, phone, temperature, conversion_status, conversation_history)
           VALUES ($1, $2, 'tire_kicker', 'new', '[]'::jsonb)
           RETURNING lead_id, lead_name, phone, temperature, conversation_history`,
          [cfg.brand_id, fromNorm],
        )
      ).rows[0];
      // Geo flag from Twilio's caller location headers (best-effort).
      const fromCity = req.body.FromCity || null;
      const fromState = req.body.FromState || null;
      const fromZip = req.body.FromZip || null;
      if (fromCity || fromState || fromZip) {
        applyLeadGeo(cfg.brand_id, lead.lead_id, {
          city: fromCity,
          state: fromState,
          zip: fromZip,
        }).catch(() => {});
      }
    }
    const prevTemp = lead.temperature;
    const history = Array.isArray(lead.conversation_history)
      ? lead.conversation_history
      : [];

    // Reply tracking: credit the lead's most recent campaign once per reply burst.
    const { rows: lastOut } = await db.query(
      `SELECT campaign_id, created_at FROM sms_messages
       WHERE brand_id = $1 AND lead_id = $2 AND direction = 'outbound' AND campaign_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [cfg.brand_id, lead.lead_id],
    );
    if (lastOut[0]) {
      const { rows: priorReply } = await db.query(
        `SELECT 1 FROM sms_messages
         WHERE brand_id = $1 AND lead_id = $2 AND direction = 'inbound' AND created_at > $3
         LIMIT 1`,
        [cfg.brand_id, lead.lead_id, lastOut[0].created_at],
      );
      if (priorReply.length === 0) {
        await db.query(
          `UPDATE sms_campaigns SET reply_count = reply_count + 1, updated_at = NOW()
           WHERE campaign_id = $1`,
          [lastOut[0].campaign_id],
        );
      }
    }

    // Record the inbound message.
    await db.query(
      `INSERT INTO sms_messages (brand_id, lead_id, direction, message_body, delivery_status)
       VALUES ($1, $2, 'inbound', $3, 'received')`,
      [cfg.brand_id, lead.lead_id, body || "(no content)"],
    );

    // Honor opt-out: thread the inbound message but never auto-reply to a
    // contact who has opted out (they may text again without saying START).
    if (await isOptedOut(cfg.brand_id, fromRaw)) {
      return emptyTwiml(res);
    }

    // Hand the reply to the Two-Way Autonomous Conversation engine: Hermes reads
    // the lead's message, Claude writes the response in the brand voice, the CRM
    // history + live temperature are updated, terminal conditions (stop / booked
    // / converted) close the thread, and a STRONG buying signal alerts the owner
    // (voice + SMS) with a transfer offer. When the owner has taken over
    // (transferred), Echo stays silent.
    let result;
    try {
      result = await autonomousEngine.handleInboundReply({
        brand,
        ownerUserId: cfg.owner_user_id,
        lead,
        channel: "sms",
        inboundText: body,
        history,
      });
    } catch (err) {
      console.error("Autonomous SMS handling failed:", err.message);
      return emptyTwiml(res);
    }

    // Owner is handling it, the lead asked to stop, or the AI turn was skipped
    // (upstream failure) — acknowledge silently without sending a reply.
    if (result.transferred || !result.reply) {
      return emptyTwiml(res);
    }
    const reply = result.reply;
    const newTemp = result.temperature || prevTemp;

    // Record the outbound reply (sent via the TwiML <Message> below).
    await db.query(
      `INSERT INTO sms_messages (brand_id, lead_id, direction, message_body, delivery_status, sent_at)
       VALUES ($1, $2, 'outbound', $3, 'sent', NOW())`,
      [cfg.brand_id, lead.lead_id, reply],
    );

    // Hot-lead alert (email/push) only on a genuine non-hot -> hot transition.
    // (The engine separately fires the voice + SMS transfer offer on a strong
    // buying signal — these are complementary, not duplicates.)
    if (newTemp === "hot" && prevTemp !== "hot") {
      await fireHotLeadAlert(
        owner,
        brand,
        { ...lead, temperature: newTemp },
        `Inbound SMS: "${body}"`,
      );
    }

    return messageTwiml(res, reply);
  } catch (err) {
    console.error("Inbound SMS handler failed:", err.message);
    return emptyTwiml(res);
  }
}

module.exports = {
  generateMessages,
  createCampaign,
  sendCampaign,
  retryCampaign,
  getCampaigns,
  getCampaignDetail,
  getConversations,
  sendManualReply,
  getContacts,
  resubscribe,
  getAnalytics,
  handleInbound,
  alertOwnerOfFailedSmsCampaign,
};
