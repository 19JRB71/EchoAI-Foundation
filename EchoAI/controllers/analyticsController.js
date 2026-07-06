const db = require("../config/db");
const { graphGet } = require("../utils/facebookApi");
const { decrypt } = require("../utils/encryption");
const { anthropic, MODEL } = require("../config/anthropic");

/**
 * Returns the ISO week's Monday (UTC) as a YYYY-MM-DD string.
 */
function weekStartDate(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // 0 = Sunday ... 6 = Saturday
  const diff = day === 0 ? -6 : 1 - day; // shift back to Monday
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

/**
 * Loads the user's connected Facebook integration and returns the decrypted
 * access token. Throws if not connected.
 */
async function getFacebookIntegration(userId) {
  const result = await db.query(
    `SELECT api_token_encrypted, account_ref, connection_status
     FROM api_integrations
     WHERE user_id = $1 AND platform = 'facebook'`,
    [userId]
  );

  if (result.rows.length === 0 || result.rows[0].connection_status !== "connected") {
    const err = new Error("No connected Facebook account found");
    err.statusCode = 400;
    throw err;
  }

  return { accessToken: decrypt(result.rows[0].api_token_encrypted) };
}

/**
 * Extracts the lead count from a Facebook insights "actions" array.
 */
function extractLeads(actions = []) {
  const leadAction = actions.find(
    (a) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped"
  );
  return leadAction ? Number(leadAction.value) : 0;
}

/**
 * Sums purchase/conversion revenue from a Facebook insights "action_values" array.
 */
function extractRevenue(actionValues = []) {
  if (!Array.isArray(actionValues)) return 0;
  const revenueActions = actionValues.filter(
    (a) =>
      a.action_type === "purchase" ||
      a.action_type === "omni_purchase" ||
      a.action_type === "onsite_conversion.purchase" ||
      a.action_type === "offsite_conversion.fb_pixel_purchase"
  );
  return revenueActions.reduce((sum, a) => sum + (Number(a.value) || 0), 0);
}

async function getOwnedBrand(brandId, userId) {
  const result = await db.query(
    `SELECT brand_id, user_id, brand_name, brand_personality, voice_description, target_audience
     FROM brands
     WHERE brand_id = $1 AND user_id = $2`,
    [brandId, userId]
  );
  return result.rows[0] || null;
}

/**
 * Core analytics aggregation for a single brand. Pulls all active campaigns,
 * fetches the latest 7-day performance from Facebook for each, calculates the
 * weekly totals, and upserts a record into the analytics table (keyed by
 * brand + ISO week so re-runs in the same week update in place).
 *
 * `brand` must include { brand_id, user_id }.
 * Used by both the manual record route and the cron scheduler.
 */
async function recordWeeklyAnalyticsForBrand(brand) {
  const { accessToken } = await getFacebookIntegration(brand.user_id);

  const campaigns = await db.query(
    `SELECT campaign_id, facebook_campaign_id
     FROM campaigns
     WHERE brand_id = $1 AND status = 'active' AND facebook_campaign_id IS NOT NULL`,
    [brand.brand_id]
  );

  let totalSpend = 0;
  let totalLeads = 0;
  let totalRevenue = 0;
  let totalClicks = 0;
  let totalImpressions = 0;

  for (const c of campaigns.rows) {
    const insights = await graphGet(
      `${c.facebook_campaign_id}/insights`,
      {
        fields: "spend,actions,action_values,clicks,impressions",
        date_preset: "last_7d",
      },
      accessToken
    );

    const row = insights.data && insights.data[0] ? insights.data[0] : {};
    totalSpend += Number(row.spend || 0);
    totalLeads += extractLeads(row.actions);
    totalRevenue += extractRevenue(row.action_values);
    totalClicks += Number(row.clicks || 0);
    totalImpressions += Number(row.impressions || 0);
  }

  const weekDate = weekStartDate();

  // Conversions: leads marked converted for this brand within the same ISO week
  // bucket as week_date (Monday 00:00 UTC through the following Monday).
  const conversionsResult = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM leads
     WHERE brand_id = $1 AND conversion_status = 'converted'
       AND updated_at >= $2::date
       AND updated_at < ($2::date + INTERVAL '7 days')`,
    [brand.brand_id, weekDate]
  );
  const conversions = conversionsResult.rows[0].count;

  const costPerLead = totalLeads > 0 ? totalSpend / totalLeads : null;
  // Weighted weekly ROAS: total attributed revenue / total spend.
  const returnOnAdSpend = totalSpend > 0 && totalRevenue > 0 ? totalRevenue / totalSpend : null;
  // Weighted weekly click-through rate (percent): total clicks / total impressions.
  // Real, non-fabricated — null when there were no impressions to measure.
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : null;

  const inserted = await db.query(
    `INSERT INTO analytics
       (brand_id, week_date, total_spend, total_leads, cost_per_lead, conversions,
        return_on_ad_spend, clicks, impressions, ctr)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (brand_id, week_date) DO UPDATE
       SET total_spend = EXCLUDED.total_spend,
           total_leads = EXCLUDED.total_leads,
           cost_per_lead = EXCLUDED.cost_per_lead,
           conversions = EXCLUDED.conversions,
           return_on_ad_spend = EXCLUDED.return_on_ad_spend,
           clicks = EXCLUDED.clicks,
           impressions = EXCLUDED.impressions,
           ctr = EXCLUDED.ctr
     RETURNING *`,
    [
      brand.brand_id,
      weekDate,
      totalSpend.toFixed(2),
      totalLeads,
      costPerLead !== null ? costPerLead.toFixed(2) : null,
      conversions,
      returnOnAdSpend !== null ? returnOnAdSpend.toFixed(4) : null,
      totalClicks,
      totalImpressions,
      ctr !== null ? ctr.toFixed(4) : null,
    ]
  );

  return inserted.rows[0];
}

/**
 * Generates a friendly, professional weekly summary email body via Anthropic,
 * matching the brand's voice profile. Returns { subject, body }.
 * Used by the reporting controller.
 */
async function generateWeeklyReport(brand, analytics) {
  const voice = brand.voice_description
    ? `Match this brand's voice profile: ${brand.voice_description}`
    : "Use a friendly, professional tone.";

  const system = [
    "You are EchoAI's weekly reporting assistant, writing a short weekly performance summary email to a small business owner.",
    "Explain the results in plain, jargon-free language. Highlight what's working, gently note any areas of concern, and suggest one or two simple next steps.",
    "Keep it warm, encouraging, and concise — a few short paragraphs, no tables.",
    voice,
  ].join("\n");

  const data = {
    brand: brand.brand_name,
    week_of: analytics.week_date,
    total_spend: analytics.total_spend,
    total_leads: analytics.total_leads,
    cost_per_lead: analytics.cost_per_lead,
    conversions: analytics.conversions,
    return_on_ad_spend: analytics.return_on_ad_spend,
  };

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [
      {
        role: "user",
        content: `Here is this week's marketing data. Write the weekly summary email body.\n\n${JSON.stringify(
          data,
          null,
          2
        )}`,
      },
    ],
  });

  const body = (response.content || []).map((b) => b.text || "").join("").trim();
  const subject = `Your EchoAI weekly report — ${brand.brand_name}`;

  return { subject, body };
}

/**
 * POST /api/analytics/:brandId/record
 * Manually triggers analytics recording for a brand.
 */
async function recordWeeklyAnalytics(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const brand = await getOwnedBrand(brandId, userId);
    if (!brand) {
      return res.status(404).json({ error: "Brand not found" });
    }

    const record = await recordWeeklyAnalyticsForBrand({ brand_id: brand.brand_id, user_id: userId });
    return res.status(201).json(record);
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("Record analytics error:", err.message);
    return res.status(status).json({ error: err.message || "Failed to record analytics" });
  }
}

/**
 * GET /api/analytics/:brandId
 * Returns all weekly analytics records for a brand, most recent first.
 */
async function getAnalytics(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const brand = await getOwnedBrand(brandId, userId);
    if (!brand) {
      return res.status(404).json({ error: "Brand not found" });
    }

    const result = await db.query(
      `SELECT analytics_id, brand_id, week_date, total_spend, total_leads,
              cost_per_lead, conversions, return_on_ad_spend, created_at
       FROM analytics
       WHERE brand_id = $1
       ORDER BY week_date DESC`,
      [brandId]
    );

    return res.json({ count: result.rows.length, analytics: result.rows });
  } catch (err) {
    console.error("Get analytics error:", err.message);
    return res.status(500).json({ error: "Failed to fetch analytics" });
  }
}

/**
 * GET /api/analytics/:brandId/current
 * Returns the most recent analytics record in a simple, human-readable format.
 */
async function getCurrentWeekSummary(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const brand = await getOwnedBrand(brandId, userId);
    if (!brand) {
      return res.status(404).json({ error: "Brand not found" });
    }

    const result = await db.query(
      `SELECT week_date, total_spend, total_leads, cost_per_lead, conversions, return_on_ad_spend
       FROM analytics
       WHERE brand_id = $1
       ORDER BY week_date DESC
       LIMIT 1`,
      [brandId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No analytics recorded yet for this brand" });
    }

    const a = result.rows[0];
    const costPerLead = a.cost_per_lead !== null ? `$${a.cost_per_lead}` : "N/A";

    return res.json({
      brand: brand.brand_name,
      summary: {
        weekOf: a.week_date,
        totalSpend: `$${a.total_spend}`,
        totalLeads: a.total_leads,
        costPerLead,
        conversions: a.conversions,
      },
    });
  } catch (err) {
    console.error("Get current week summary error:", err.message);
    return res.status(500).json({ error: "Failed to fetch current week summary" });
  }
}

module.exports = {
  recordWeeklyAnalytics,
  recordWeeklyAnalyticsForBrand,
  getAnalytics,
  getCurrentWeekSummary,
  generateWeeklyReport,
  getOwnedBrand,
};
