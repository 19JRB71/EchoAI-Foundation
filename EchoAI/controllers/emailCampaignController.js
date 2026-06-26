const db = require("../config/db");
const { sendEmail } = require("../utils/email");
const {
  generateEmailSequence,
  MIN_EMAILS,
  MAX_EMAILS,
} = require("../prompts/emailCampaignPrompt");

/**
 * Loads a brand only if it belongs to the authenticated user. Returns null when
 * the brand does not exist or is not owned by the user.
 */
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

/**
 * Loads a campaign only if it belongs to a brand owned by the user.
 */
async function getOwnedCampaign(userId, campaignId) {
  const result = await db.query(
    `SELECT ec.campaign_id, ec.brand_id, ec.campaign_name, ec.goal,
            ec.email_sequence, ec.status, ec.current_step
     FROM email_campaigns ec
     JOIN brands b ON b.brand_id = ec.brand_id
     WHERE ec.campaign_id = $1 AND b.user_id = $2`,
    [campaignId, userId]
  );
  return result.rows[0] || null;
}

function normalizeEmailCount(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  if (n < MIN_EMAILS || n > MAX_EMAILS) return null;
  return n;
}

/**
 * Validates and normalizes a sequence of email objects. Returns the cleaned
 * array, or throws if the shape is invalid. Used for both AI output and
 * client-supplied save payloads so malformed data never reaches the DB or SMTP.
 */
function validateEmailSequence(emails) {
  if (!Array.isArray(emails) || emails.length === 0) {
    throw new Error("emailSequence must be a non-empty array of emails");
  }
  if (emails.length < MIN_EMAILS || emails.length > MAX_EMAILS) {
    throw new Error(
      `An email sequence must contain between ${MIN_EMAILS} and ${MAX_EMAILS} emails`
    );
  }
  return emails.map((email, i) => {
    if (!email || typeof email !== "object") {
      throw new Error(`Email ${i + 1} is not a valid object`);
    }
    const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
    const subject = str(email.subject).trim();
    const body = str(email.body).trim();
    if (!subject) throw new Error(`Email ${i + 1} is missing a subject`);
    if (!body) throw new Error(`Email ${i + 1} is missing a body`);
    return {
      subject,
      previewText: str(email.previewText).trim(),
      body,
      callToAction: str(email.callToAction).trim(),
      sendTiming: str(email.sendTiming).trim() || `Day ${i + 1}`,
    };
  });
}

/**
 * POST /api/email-campaigns/generate
 * Generates a complete email sequence for a brand + goal + audience.
 */
async function generateSequence(req, res) {
  const userId = req.user.userId;
  const { brandId, goal, targetAudience, numEmails } = req.body;
  const count = normalizeEmailCount(numEmails);

  if (!brandId || !goal) {
    return res.status(400).json({ error: "brandId and goal are required" });
  }
  if (count === null) {
    return res.status(400).json({
      error: `numEmails must be a number between ${MIN_EMAILS} and ${MAX_EMAILS}`,
    });
  }

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const rawEmails = await generateEmailSequence(
      brand,
      goal,
      targetAudience,
      count
    );
    const emails = validateEmailSequence(rawEmails);
    return res.json({
      brandId,
      goal,
      targetAudience: targetAudience || null,
      count: emails.length,
      emails,
    });
  } catch (err) {
    console.error("Generate email sequence error:", err.message);
    if (typeof err.status === "number" && err.status >= 400) {
      return res.status(502).json({
        error:
          "The AI provider could not generate the email sequence right now. Please try again shortly.",
      });
    }
    return res.status(500).json({ error: "Failed to generate email sequence" });
  }
}

/**
 * POST /api/email-campaigns
 * Saves a generated email sequence as a new campaign (status 'draft').
 */
async function saveCampaign(req, res) {
  const userId = req.user.userId;
  const { brandId, campaignName, goal, emailSequence } = req.body;

  if (!brandId || !campaignName || !goal || !emailSequence) {
    return res.status(400).json({
      error: "brandId, campaignName, goal, and emailSequence are required",
    });
  }

  let sequence;
  try {
    sequence = validateEmailSequence(emailSequence);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `INSERT INTO email_campaigns
         (brand_id, campaign_name, goal, email_sequence, status)
       VALUES ($1, $2, $3, $4, 'draft')
       RETURNING campaign_id, brand_id, campaign_name, goal, email_sequence,
                 status, current_step, created_at, updated_at`,
      [brandId, campaignName, goal, JSON.stringify(sequence)]
    );
    return res.status(201).json({ campaign: result.rows[0] });
  } catch (err) {
    console.error("Save email campaign error:", err.message);
    return res.status(500).json({ error: "Failed to save email campaign" });
  }
}

/**
 * POST /api/email-campaigns/:campaignId/send
 * Sends the next email in the sequence to all of the brand's CRM leads that have
 * an email address. Records each send and advances the campaign's progress.
 *
 * The campaign row is locked (SELECT ... FOR UPDATE) inside a transaction for
 * the duration of the send so two concurrent requests cannot both claim the
 * same step and double-send. The DB also has a unique index on
 * (campaign_id, email_address, sequence_step) as a backstop against duplicates.
 */
async function sendCampaign(req, res) {
  const userId = req.user.userId;
  const { campaignId } = req.params;

  const client = await db.getClient();
  try {
    await client.query("BEGIN");

    // Lock the campaign row (only if owned by the user) before reading its step.
    const lockResult = await client.query(
      `SELECT ec.brand_id, ec.campaign_name, ec.email_sequence, ec.status,
              ec.current_step
       FROM email_campaigns ec
       JOIN brands b ON b.brand_id = ec.brand_id
       WHERE ec.campaign_id = $1 AND b.user_id = $2
       FOR UPDATE OF ec`,
      [campaignId, userId]
    );
    const campaign = lockResult.rows[0];
    if (!campaign) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Campaign not found" });
    }

    const sequence = Array.isArray(campaign.email_sequence)
      ? campaign.email_sequence
      : [];
    const step = campaign.current_step;

    if (step >= sequence.length) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "All emails in this sequence have already been sent" });
    }

    const email = sequence[step];
    const subject = email.subject || `${campaign.campaign_name} (${step + 1})`;
    const bodyHtml = `<div>${String(email.body || "").replace(/\n/g, "<br>")}</div>`;

    const leadsResult = await client.query(
      `SELECT lead_id, email FROM leads
       WHERE brand_id = $1 AND email IS NOT NULL AND email <> ''`,
      [campaign.brand_id]
    );

    if (leadsResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "No CRM leads with an email address for this brand" });
    }

    let sent = 0;
    let failed = 0;
    for (const lead of leadsResult.rows) {
      try {
        await sendEmail({ to: lead.email, subject, html: bodyHtml });
        // ON CONFLICT DO NOTHING is a backstop: the row lock already prevents
        // concurrent duplicate steps, but this guarantees idempotency.
        await client.query(
          `INSERT INTO email_sends
             (campaign_id, lead_id, email_address, subject, sequence_step)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (campaign_id, email_address, sequence_step) DO NOTHING`,
          [campaignId, lead.lead_id, lead.email, subject, step]
        );
        sent += 1;
      } catch (err) {
        failed += 1;
        console.error(
          `Email send failed for lead ${lead.lead_id} (campaign ${campaignId}):`,
          err.message
        );
      }
    }

    // Advance progress only if at least one email actually went out, so a total
    // SMTP outage does not silently consume a sequence step.
    let newStep = step;
    let newStatus = campaign.status;
    if (sent > 0) {
      newStep = step + 1;
      newStatus = newStep >= sequence.length ? "completed" : "active";
      await client.query(
        `UPDATE email_campaigns SET current_step = $1, status = $2
         WHERE campaign_id = $3`,
        [newStep, newStatus, campaignId]
      );
    }

    if (sent === 0) {
      // Nothing went out — release the lock without consuming a step.
      await client.query("ROLLBACK");
      return res.status(502).json({
        error: "No emails could be sent (check SMTP configuration)",
        recipients: leadsResult.rows.length,
        sent,
        failed,
      });
    }

    await client.query("COMMIT");
    return res.json({
      campaignId,
      step: step + 1,
      totalEmails: sequence.length,
      recipients: leadsResult.rows.length,
      sent,
      failed,
      status: newStatus,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Send email campaign error:", err.message);
    return res.status(500).json({ error: "Failed to send email campaign" });
  } finally {
    client.release();
  }
}

/**
 * GET /api/email-campaigns/:brandId
 * Returns all email campaigns for a brand (newest first) with progress info.
 */
async function getCampaigns(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `SELECT campaign_id, brand_id, campaign_name, goal, email_sequence,
              status, current_step, created_at, updated_at
       FROM email_campaigns
       WHERE brand_id = $1
       ORDER BY created_at DESC`,
      [brandId]
    );

    const campaigns = result.rows.map((row) => {
      const sequence = Array.isArray(row.email_sequence) ? row.email_sequence : [];
      return {
        campaignId: row.campaign_id,
        brandId: row.brand_id,
        campaignName: row.campaign_name,
        goal: row.goal,
        status: row.status,
        emailCount: sequence.length,
        sentCount: row.current_step,
        emailSequence: sequence,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
    return res.json({ brandId, count: campaigns.length, campaigns });
  } catch (err) {
    console.error("Get email campaigns error:", err.message);
    return res.status(500).json({ error: "Failed to fetch email campaigns" });
  }
}

/**
 * GET /api/email-campaigns/performance/:brandId
 * Returns open, click, and unsubscribe rates per campaign for a brand.
 */
async function getCampaignPerformance(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `SELECT ec.campaign_id, ec.campaign_name, ec.status,
              COUNT(es.send_id)::int AS sent,
              COUNT(es.opened_at)::int AS opened,
              COUNT(es.clicked_at)::int AS clicked,
              COUNT(*) FILTER (WHERE es.unsubscribed)::int AS unsubscribed
       FROM email_campaigns ec
       LEFT JOIN email_sends es ON es.campaign_id = ec.campaign_id
       WHERE ec.brand_id = $1
       GROUP BY ec.campaign_id, ec.campaign_name, ec.status
       ORDER BY ec.created_at DESC`,
      [brandId]
    );

    const rate = (num, denom) => (denom > 0 ? num / denom : 0);
    const performance = result.rows.map((row) => ({
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      status: row.status,
      sent: row.sent,
      opened: row.opened,
      clicked: row.clicked,
      unsubscribed: row.unsubscribed,
      openRate: rate(row.opened, row.sent),
      clickRate: rate(row.clicked, row.sent),
      unsubscribeRate: rate(row.unsubscribed, row.sent),
    }));
    return res.json({ brandId, count: performance.length, performance });
  } catch (err) {
    console.error("Get email campaign performance error:", err.message);
    return res
      .status(500)
      .json({ error: "Failed to fetch email campaign performance" });
  }
}

module.exports = {
  generateSequence,
  saveCampaign,
  sendCampaign,
  getCampaigns,
  getCampaignPerformance,
};
