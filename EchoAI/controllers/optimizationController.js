const db = require("../config/db");
const { anthropic, MODEL } = require("../config/anthropic");
const { graphGet, graphPost } = require("../utils/facebookApi");
const { decrypt } = require("../utils/encryption");
const { generateCreativeVariations } = require("../prompts/adCreativePrompt");
const { enqueueOwnerVoiceEvent } = require("../utils/echoVoiceNotifications");
const {
  COMPETITOR_ANALYSIS_SYSTEM_PROMPT,
  CAMPAIGN_OPTIMIZATION_SYSTEM_PROMPT,
  buildCompetitorAnalysisPrompt,
  buildCampaignOptimizationPrompt,
  deriveNiche,
} = require("../prompts/campaignOptimizationPrompt");

function extractText(response) {
  return (response.content || [])
    .map((block) => block.text || "")
    .join("")
    .trim();
}

/**
 * Parses a JSON object out of an Anthropic text response, tolerating ``` fences.
 */
function parseJsonResponse(text) {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const error = new Error("Failed to parse the AI response as JSON");
    error.statusCode = 502;
    throw error;
  }
}

/**
 * Loads a brand owned by the user. Throws a 404 if it isn't found.
 */
async function getOwnedBrand(brandId, userId) {
  const result = await db.query(
    "SELECT * FROM brands WHERE brand_id = $1 AND user_id = $2",
    [brandId, userId]
  );
  if (result.rows.length === 0) {
    const err = new Error("Brand not found");
    err.statusCode = 404;
    throw err;
  }
  return result.rows[0];
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

  const row = result.rows[0];
  return {
    accessToken: decrypt(row.api_token_encrypted),
    accountRef: row.account_ref,
  };
}

/**
 * Calls the competitor analysis agent and stores the report. Reusable by both
 * the HTTP handler and any internal caller.
 *
 * @param {object} brand        Brand row.
 * @param {Array}  competitors  Competitor names or URLs.
 * @param {string} [niche]      Optional explicit niche override.
 * @returns {Promise<object>}   { intelligenceId, report }
 */
async function runCompetitorAnalysisForBrand(brand, competitors = [], niche) {
  const prompt = buildCompetitorAnalysisPrompt({
    niche: niche || deriveNiche(brand),
    competitors,
    targetAudience: brand.target_audience,
  });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: COMPETITOR_ANALYSIS_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const report = parseJsonResponse(extractText(response));

  const inserted = await db.query(
    `INSERT INTO competitor_intelligence (brand_id, competitor_names, intelligence_report)
     VALUES ($1, $2, $3)
     RETURNING intelligence_id, created_at`,
    [brand.brand_id, JSON.stringify(competitors), JSON.stringify(report)]
  );

  return {
    intelligenceId: inserted.rows[0].intelligence_id,
    createdAt: inserted.rows[0].created_at,
    report,
  };
}

/**
 * Pulls current performance metrics for a campaign from Facebook insights.
 */
async function pullCampaignPerformance(campaign, accessToken) {
  const insights = await graphGet(
    `${campaign.facebook_campaign_id}/insights`,
    { fields: "spend,clicks,impressions,actions,cpc,ctr", date_preset: "last_7d" },
    accessToken
  );

  const row = insights.data && insights.data[0] ? insights.data[0] : {};
  const spend = Number(row.spend || 0);
  const clicks = Number(row.clicks || 0);
  const leadAction = (row.actions || []).find(
    (a) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped"
  );
  const leads = leadAction ? Number(leadAction.value) : 0;
  const costPerLead = leads > 0 ? spend / leads : null;
  const conversionRate = clicks > 0 ? leads / clicks : 0;

  return { spend, clicks, leads, costPerLead, conversionRate };
}

/**
 * Runs the full auto-optimization flow for a single brand:
 *   1. Pulls brand profile, latest analytics, active campaigns, and the most
 *      recent competitor intelligence report.
 *   2. Calls the campaign optimization agent.
 *   3. Applies the recommended budget changes to active Facebook campaigns.
 *   4. Generates three new creative variations and queues them on each campaign.
 *   5. Logs all changes to the campaigns table and optimization_history.
 *
 * @param {object} brand  Brand row (must include brand_id and user_id).
 * @returns {Promise<object>} Summary of the optimization.
 */
async function autoOptimizeCampaignsForBrand(brand) {
  const userId = brand.user_id;
  const { accessToken } = await getFacebookIntegration(userId);

  // Active campaigns for this brand.
  const campaignsResult = await db.query(
    `SELECT campaign_id, campaign_name, budget, cost_per_lead, conversion_rate,
            facebook_campaign_id, facebook_adset_id, ad_creative_variations
     FROM campaigns
     WHERE brand_id = $1 AND status = 'active'`,
    [brand.brand_id]
  );
  const campaigns = campaignsResult.rows;

  // Historical weekly analytics (most recent first).
  const analyticsResult = await db.query(
    `SELECT week_date, total_spend, total_leads, cost_per_lead, conversions, return_on_ad_spend
     FROM analytics
     WHERE brand_id = $1
     ORDER BY week_date DESC
     LIMIT 8`,
    [brand.brand_id]
  );

  // Most recent competitor intelligence report.
  const intelResult = await db.query(
    `SELECT intelligence_report
     FROM competitor_intelligence
     WHERE brand_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [brand.brand_id]
  );
  const competitorIntel = intelResult.rows[0] ? intelResult.rows[0].intelligence_report : null;

  // Snapshot current performance (the "before" state) for each campaign.
  const performance = campaigns.map((c) => ({
    campaignId: c.campaign_id,
    name: c.campaign_name,
    budget: c.budget,
    costPerLead: c.cost_per_lead,
    conversionRate: c.conversion_rate,
  }));

  // Call the optimization agent.
  const prompt = buildCampaignOptimizationPrompt({
    brand,
    performance,
    competitorIntel,
    analytics: analyticsResult.rows,
  });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3072,
    system: CAMPAIGN_OPTIMIZATION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const recommendation = parseJsonResponse(extractText(response));
  const budgetRecs = Array.isArray(recommendation.budgetRecommendations)
    ? recommendation.budgetRecommendations
    : [];

  // The optimization agent generates the three new creative variations to queue
  // for testing. Fall back to the deterministic generator only if the agent's
  // output is missing or malformed.
  const queuedCreatives =
    Array.isArray(recommendation.creatives) && recommendation.creatives.length > 0
      ? recommendation.creatives
      : generateCreativeVariations(brand, { count: 3 });

  const optimizations = [];
  const underfundedCampaigns = [];

  for (const c of campaigns) {
    const rec = budgetRecs.find(
      (r) => r.campaign && r.campaign.toLowerCase() === c.campaign_name.toLowerCase()
    );

    // Backfill the performance_after of this campaign's most recent prior
    // optimization (whose impact can now be measured) before logging the new run.
    let measured = null;
    try {
      measured = await pullCampaignPerformance(c, accessToken);
      await db.query(
        `UPDATE optimization_history
           SET performance_after = $1
         WHERE optimization_id = (
           SELECT optimization_id FROM optimization_history
           WHERE campaign_id = $2 AND performance_after IS NULL
           ORDER BY created_at DESC
           LIMIT 1
         )`,
        [JSON.stringify(measured), c.campaign_id]
      );
    } catch (err) {
      console.error(
        `Could not measure performance for campaign ${c.campaign_id}:`,
        err.message
      );
    }

    // Apply the recommended budget change to the active Facebook ad set.
    let appliedBudget = null;
    let action = "maintain";
    if (rec) action = rec.action || "maintain";

    if (
      rec &&
      rec.action &&
      rec.action !== "maintain" &&
      Number.isFinite(Number(rec.recommendedDailyBudget)) &&
      c.facebook_adset_id
    ) {
      const newDaily = Math.round(Number(rec.recommendedDailyBudget) * 100);
      try {
        await graphPost(c.facebook_adset_id, { daily_budget: newDaily }, accessToken);
        appliedBudget = Number(rec.recommendedDailyBudget);
        await db.query("UPDATE campaigns SET budget = $1 WHERE campaign_id = $2", [
          appliedBudget,
          c.campaign_id,
        ]);
      } catch (err) {
        console.error(
          `Failed to apply budget change for campaign ${c.campaign_id}:`,
          err.message
        );
      }
    }

    // Queue the new creative variations on the campaign for testing.
    await db.query(
      "UPDATE campaigns SET ad_creative_variations = $1 WHERE campaign_id = $2",
      [JSON.stringify(queuedCreatives), c.campaign_id]
    );

    const changesMade = {
      budgetAction: action,
      appliedDailyBudget: appliedBudget,
      budgetReason: rec ? rec.reason || null : null,
      audienceRecommendations: recommendation.audienceRecommendations || [],
      queuedCreatives,
      analysis: recommendation.analysis || null,
      explanation: recommendation.explanation || null,
    };

    const performanceBefore = {
      budget: c.budget,
      costPerLead: c.cost_per_lead,
      conversionRate: c.conversion_rate,
    };

    const logged = await db.query(
      `INSERT INTO optimization_history (brand_id, campaign_id, changes_made, performance_before)
       VALUES ($1, $2, $3, $4)
       RETURNING optimization_id`,
      [
        brand.brand_id,
        c.campaign_id,
        JSON.stringify(changesMade),
        JSON.stringify(performanceBefore),
      ]
    );

    optimizations.push({
      optimizationId: logged.rows[0].optimization_id,
      campaignId: c.campaign_id,
      campaignName: c.campaign_name,
      budgetAction: action,
      appliedDailyBudget: appliedBudget,
    });

    // An "increase" recommendation means the campaign is performing but
    // budget-starved — a real "budget running low" signal for the owner.
    if (action === "increase") underfundedCampaigns.push(c.campaign_name);
  }

  // Speak a budget-low alert via Echo when campaigns are underfunded. Best-effort;
  // honors voice settings, dedup per brand per day so it speaks once per run.
  if (underfundedCampaigns.length > 0) {
    const n = underfundedCampaigns.length;
    const dayKey = new Date().toISOString().slice(0, 10);
    enqueueOwnerVoiceEvent(
      brand.user_id,
      "budget_low",
      (firstName) =>
        n === 1
          ? `${firstName}, heads up — your campaign "${underfundedCampaigns[0]}" is performing well but running low on budget. I recommend increasing its daily spend to capture more leads.`
          : `${firstName}, heads up — ${n} of your campaigns are performing well but running low on budget. I recommend increasing their daily spend to capture more leads.`,
      {
        brandId: brand.brand_id,
        title: "Budget running low",
        payload: { campaigns: underfundedCampaigns },
        dedupKey: `budgetlow:${brand.brand_id}:${dayKey}`,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      }
    ).catch((err) => console.error("Budget-low voice enqueue failed:", err.message));
  }

  return {
    brandId: brand.brand_id,
    optimized: optimizations.length,
    explanation: recommendation.explanation || null,
    audienceRecommendations: recommendation.audienceRecommendations || [],
    queuedCreatives,
    campaigns: optimizations,
  };
}

/**
 * POST /api/optimize/competitors
 * Body: { brandId, competitors: [names or URLs], niche? }
 */
async function runCompetitorAnalysis(req, res) {
  const userId = req.user.userId;
  const { brandId, competitors, niche } = req.body;

  if (!brandId || !Array.isArray(competitors) || competitors.length === 0) {
    return res
      .status(400)
      .json({ error: "brandId and a non-empty competitors array are required" });
  }

  try {
    const brand = await getOwnedBrand(brandId, userId);
    const result = await runCompetitorAnalysisForBrand(brand, competitors, niche);
    return res.status(201).json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("Competitor analysis error:", err.message);
    return res.status(status).json({ error: err.message || "Failed to run competitor analysis" });
  }
}

/**
 * POST /api/optimize/auto
 * Body: { brandId }
 */
async function autoOptimizeCampaigns(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.body;

  if (!brandId) {
    return res.status(400).json({ error: "brandId is required" });
  }

  try {
    const brand = await getOwnedBrand(brandId, userId);
    const result = await autoOptimizeCampaignsForBrand(brand);
    return res.json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("Auto optimize campaigns error:", err.message);
    return res.status(status).json({ error: err.message || "Failed to auto optimize campaigns" });
  }
}

/**
 * GET /api/optimize/history/:brandId
 * Returns the log of past optimizations for a brand, including the changes made
 * and the before/after performance impact.
 */
async function getOptimizationHistory(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    await getOwnedBrand(brandId, userId);

    const result = await db.query(
      `SELECT oh.optimization_id, oh.campaign_id, c.campaign_name,
              oh.changes_made, oh.performance_before, oh.performance_after, oh.created_at
       FROM optimization_history oh
       LEFT JOIN campaigns c ON c.campaign_id = oh.campaign_id
       WHERE oh.brand_id = $1
       ORDER BY oh.created_at DESC`,
      [brandId]
    );

    const history = result.rows.map((r) => ({
      optimizationId: r.optimization_id,
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      changesMade: r.changes_made,
      performanceBefore: r.performance_before,
      performanceAfter: r.performance_after,
      createdAt: r.created_at,
    }));

    return res.json({ count: history.length, history });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("Get optimization history error:", err.message);
    return res.status(status).json({ error: err.message || "Failed to fetch optimization history" });
  }
}

module.exports = {
  runCompetitorAnalysis,
  runCompetitorAnalysisForBrand,
  autoOptimizeCampaigns,
  autoOptimizeCampaignsForBrand,
  getOptimizationHistory,
};
