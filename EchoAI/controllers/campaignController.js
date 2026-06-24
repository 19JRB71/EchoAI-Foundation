const db = require("../config/db");
const { graphGet, graphPost, verifyAdAccount } = require("../utils/facebookApi");
const { encrypt, decrypt } = require("../utils/encryption");
const { buildAdCreativePrompt, generateCreativeVariations } = require("../prompts/adCreativePrompt");

// Maps a human campaign goal to a Facebook campaign objective.
const GOAL_TO_OBJECTIVE = {
  leads: "OUTCOME_LEADS",
  lead_generation: "OUTCOME_LEADS",
  traffic: "OUTCOME_TRAFFIC",
  awareness: "OUTCOME_AWARENESS",
  sales: "OUTCOME_SALES",
  conversions: "OUTCOME_SALES",
  engagement: "OUTCOME_ENGAGEMENT",
  app_promotion: "OUTCOME_APP_PROMOTION",
};

function normalizeAdAccountId(id) {
  return String(id).startsWith("act_") ? String(id) : `act_${id}`;
}

/**
 * Loads the user's connected Facebook integration and returns the decrypted
 * access token + ad account reference. Throws if not connected.
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
 * Builds a Facebook targeting spec from supplied audience details.
 */
function buildTargeting(targetAudience = {}) {
  const targeting = {};

  const countries = targetAudience.countries || targetAudience.geo_locations?.countries;
  targeting.geo_locations = { countries: countries && countries.length ? countries : ["US"] };

  if (targetAudience.ageMin) targeting.age_min = targetAudience.ageMin;
  if (targetAudience.ageMax) targeting.age_max = targetAudience.ageMax;
  if (targetAudience.genders) targeting.genders = targetAudience.genders;

  if (Array.isArray(targetAudience.interests) && targetAudience.interests.length) {
    targeting.flexible_spec = [
      { interests: targetAudience.interests.map((i) => (typeof i === "object" ? i : { name: i })) },
    ];
  }

  return targeting;
}

/**
 * POST /api/campaigns/connect
 * Connects a Facebook ad account: verifies it via the Graph API and stores the
 * (encrypted) credentials in api_integrations.
 */
async function connectFacebookAccount(req, res) {
  const { adAccountId } = req.body;
  const userId = req.user.userId;

  if (!adAccountId) {
    return res.status(400).json({ error: "adAccountId is required" });
  }

  const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
  if (!accessToken) {
    return res.status(500).json({ error: "Server is missing FACEBOOK_ACCESS_TOKEN configuration" });
  }

  try {
    const account = await verifyAdAccount(adAccountId, accessToken);
    const normalized = normalizeAdAccountId(adAccountId);
    const encryptedToken = encrypt(accessToken);

    await db.query(
      `INSERT INTO api_integrations (user_id, platform, api_token_encrypted, account_ref, connection_status)
       VALUES ($1, 'facebook', $2, $3, 'connected')
       ON CONFLICT (user_id, platform)
       DO UPDATE SET api_token_encrypted = EXCLUDED.api_token_encrypted,
                     account_ref = EXCLUDED.account_ref,
                     connection_status = 'connected'`,
      [userId, encryptedToken, normalized]
    );

    return res.status(200).json({
      connected: true,
      adAccount: {
        id: normalized,
        name: account.name,
        accountStatus: account.account_status,
        currency: account.currency,
      },
    });
  } catch (err) {
    console.error("Connect Facebook account error:", err.message);
    // Record the failed connection state when we have a Facebook-level error.
    if (err.fbCode) {
      await db
        .query(
          `INSERT INTO api_integrations (user_id, platform, api_token_encrypted, account_ref, connection_status)
           VALUES ($1, 'facebook', '', $2, 'error')
           ON CONFLICT (user_id, platform)
           DO UPDATE SET connection_status = 'error'`,
          [userId, normalizeAdAccountId(adAccountId)]
        )
        .catch(() => {});
      return res.status(400).json({ error: `Failed to verify Facebook account: ${err.message}` });
    }
    return res.status(500).json({ error: "Failed to connect Facebook account" });
  }
}

/**
 * POST /api/campaigns
 * Creates a Facebook campaign + ad set + initial ad creative, stores the record
 * in the campaigns table, and returns the campaign ID.
 */
async function createCampaign(req, res) {
  const userId = req.user.userId;
  const { brandId, name, goal, budget, targetAudience } = req.body;

  if (!brandId || !goal || budget === undefined) {
    return res.status(400).json({ error: "brandId, goal, and budget are required" });
  }

  try {
    // Verify the brand belongs to the requesting user.
    const brandResult = await db.query(
      "SELECT * FROM brands WHERE brand_id = $1 AND user_id = $2",
      [brandId, userId]
    );
    if (brandResult.rows.length === 0) {
      return res.status(404).json({ error: "Brand not found" });
    }
    const brand = brandResult.rows[0];

    const { accessToken, accountRef } = await getFacebookIntegration(userId);
    const objective = GOAL_TO_OBJECTIVE[goal] || GOAL_TO_OBJECTIVE.leads;
    const campaignName = name || `${brand.brand_name} - ${goal}`;
    const dailyBudgetCents = Math.round(Number(budget) * 100);

    // 1. Create the campaign (paused so nothing spends until reviewed).
    const campaign = await graphPost(
      `${accountRef}/campaigns`,
      {
        name: campaignName,
        objective,
        status: "PAUSED",
        special_ad_categories: [],
      },
      accessToken
    );

    // 2. Create the ad set.
    const adSet = await graphPost(
      `${accountRef}/adsets`,
      {
        name: `${campaignName} - Ad Set`,
        campaign_id: campaign.id,
        daily_budget: dailyBudgetCents,
        billing_event: "IMPRESSIONS",
        optimization_goal: objective === "OUTCOME_LEADS" ? "LEAD_GENERATION" : "REACH",
        targeting: buildTargeting(targetAudience),
        status: "PAUSED",
      },
      accessToken
    );

    // 3. Generate brand-tailored creative copy and (optionally) push an ad creative.
    const variations = generateCreativeVariations(brand, { campaignGoal: goal, count: 3 });
    let creativeId = null;
    const pageId = process.env.FACEBOOK_PAGE_ID;
    const linkUrl = process.env.FACEBOOK_LINK_URL;

    if (pageId && linkUrl) {
      const primary = variations[0];
      const creative = await graphPost(
        `${accountRef}/adcreatives`,
        {
          name: `${campaignName} - Creative`,
          object_story_spec: {
            page_id: pageId,
            link_data: {
              message: primary.primaryText,
              link: linkUrl,
              name: primary.headline,
              call_to_action: { type: "LEARN_MORE", value: { link: linkUrl } },
            },
          },
        },
        accessToken
      );
      creativeId = creative.id;
    }

    // 4. Store the campaign record locally.
    const inserted = await db.query(
      `INSERT INTO campaigns
         (brand_id, user_id, campaign_name, budget, ad_creative_variations,
          launch_date, facebook_campaign_id, facebook_adset_id, status)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, 'active')
       RETURNING campaign_id`,
      [
        brandId,
        userId,
        campaignName,
        budget,
        JSON.stringify(variations),
        campaign.id,
        adSet.id,
      ]
    );

    return res.status(201).json({
      campaignId: inserted.rows[0].campaign_id,
      facebookCampaignId: campaign.id,
      facebookAdSetId: adSet.id,
      facebookCreativeId: creativeId,
      objective,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("Create campaign error:", err.message);
    return res.status(status).json({ error: err.message || "Failed to create campaign" });
  }
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
 * POST /api/campaigns/optimize
 * Pulls performance for all active campaigns, computes cost-per-lead and
 * conversion rate, adjusts the ad set daily budget based on performance, and
 * updates the campaigns table with the latest metrics.
 */
async function optimizeCampaign(req, res) {
  const userId = req.user.userId;

  try {
    const { accessToken } = await getFacebookIntegration(userId);

    const campaignsResult = await db.query(
      `SELECT campaign_id, campaign_name, budget, facebook_campaign_id, facebook_adset_id
       FROM campaigns
       WHERE user_id = $1 AND status = 'active' AND facebook_campaign_id IS NOT NULL`,
      [userId]
    );

    const targetCostPerLead = Number(process.env.TARGET_COST_PER_LEAD || 20);
    const optimizations = [];

    for (const c of campaignsResult.rows) {
      const insights = await graphGet(
        `${c.facebook_campaign_id}/insights`,
        {
          fields: "spend,clicks,impressions,actions,cpc,ctr",
          date_preset: "last_7d",
        },
        accessToken
      );

      const row = insights.data && insights.data[0] ? insights.data[0] : {};
      const spend = Number(row.spend || 0);
      const clicks = Number(row.clicks || 0);
      const leads = extractLeads(row.actions);
      const costPerLead = leads > 0 ? spend / leads : null;
      const conversionRate = clicks > 0 ? leads / clicks : 0;

      // Simple bid/budget optimization: scale spenders that beat the target,
      // pull back on under-performers.
      let action = "no_change";
      if (c.facebook_adset_id && costPerLead !== null) {
        if (costPerLead <= targetCostPerLead) {
          const newDaily = Math.round(Number(c.budget) * 100 * 1.2);
          await graphPost(c.facebook_adset_id, { daily_budget: newDaily }, accessToken);
          action = "budget_increased";
        } else {
          const newDaily = Math.round(Number(c.budget) * 100 * 0.8);
          await graphPost(c.facebook_adset_id, { daily_budget: newDaily }, accessToken);
          action = "budget_decreased";
        }
      }

      await db.query(
        `UPDATE campaigns
           SET cost_per_lead = $1,
               conversion_rate = $2
         WHERE campaign_id = $3`,
        [costPerLead, conversionRate, c.campaign_id]
      );

      optimizations.push({
        campaignId: c.campaign_id,
        spend,
        leads,
        costPerLead,
        conversionRate,
        action,
      });
    }

    return res.json({ optimized: optimizations.length, campaigns: optimizations });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("Optimize campaign error:", err.message);
    return res.status(status).json({ error: err.message || "Failed to optimize campaigns" });
  }
}

/**
 * GET /api/campaigns/performance
 * Returns all active campaigns with their current performance metrics.
 */
async function getCampaignPerformance(req, res) {
  const userId = req.user.userId;

  try {
    const result = await db.query(
      `SELECT campaign_id, campaign_name, budget, cost_per_lead, conversion_rate,
              launch_date, facebook_campaign_id, status
       FROM campaigns
       WHERE user_id = $1 AND status = 'active'
       ORDER BY launch_date DESC`,
      [userId]
    );

    const campaigns = result.rows.map((c) => ({
      campaignId: c.campaign_id,
      name: c.campaign_name,
      budget: c.budget,
      costPerLead: c.cost_per_lead,
      conversionRate: c.conversion_rate,
      launchDate: c.launch_date,
      facebookCampaignId: c.facebook_campaign_id,
      status: c.status,
    }));

    return res.json({ count: campaigns.length, campaigns });
  } catch (err) {
    console.error("Get campaign performance error:", err.message);
    return res.status(500).json({ error: "Failed to fetch campaign performance" });
  }
}

/**
 * POST /api/campaigns/generate-creative
 * Generates brand-tailored ad copy and image prompts from a brand profile.
 */
async function generateAdCreative(req, res) {
  const userId = req.user.userId;
  const { brandId, campaignGoal, variations } = req.body;

  if (!brandId) {
    return res.status(400).json({ error: "brandId is required" });
  }

  try {
    const brandResult = await db.query(
      "SELECT * FROM brands WHERE brand_id = $1 AND user_id = $2",
      [brandId, userId]
    );
    if (brandResult.rows.length === 0) {
      return res.status(404).json({ error: "Brand not found" });
    }
    const brand = brandResult.rows[0];

    const count = Number(variations) || 3;
    const prompt = buildAdCreativePrompt(brand, { campaignGoal, variations: count });
    const creatives = generateCreativeVariations(brand, { campaignGoal, count });

    return res.json({
      brand: brand.brand_name,
      prompt,
      creatives,
    });
  } catch (err) {
    console.error("Generate ad creative error:", err.message);
    return res.status(500).json({ error: "Failed to generate ad creative" });
  }
}

module.exports = {
  connectFacebookAccount,
  createCampaign,
  optimizeCampaign,
  getCampaignPerformance,
  generateAdCreative,
};
