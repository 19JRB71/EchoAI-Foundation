const db = require("../config/db");
const { graphGet, graphPost, verifyAdAccount, createPausedAd } = require("../utils/facebookApi");
const { recordFailedLaunch, findExistingAdId } = require("../utils/facebookLaunchSafety");
const adLaunchSpine = require("../utils/adLaunchSpine");
const { encrypt, decrypt } = require("../utils/encryption");
const { buildAdCreativePrompt, generateCreativeVariations } = require("../prompts/adCreativePrompt");
const { fbGeoLocations } = require("../utils/geoTargeting");

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
    `SELECT api_token_encrypted, account_ref, facebook_pages, connection_status
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
    grantedPages: Array.isArray(row.facebook_pages) ? row.facebook_pages : [],
  };
}

/**
 * Resolves the Facebook Page + destination link for an ad launch from the
 * BRAND row (brands.facebook_page_id / brands.ad_link_url) — never from
 * environment variables and never from the user-scoped page_ref (which is
 * only a wizard default suggestion now). Also verifies the brand's Page is
 * still in the owner's granted list; a revoked/no-longer-granted Page fails
 * honestly with reconnect guidance instead of launching through a dead Page.
 *
 * Throws err.statusCode = 503 (config, not code, is the problem) so callers
 * fail fast BEFORE creating any Facebook object.
 */
function resolveBrandAdDestination(brand, grantedPages) {
  const pageId = brand.facebook_page_id;
  const linkUrl = brand.ad_link_url;
  if (!pageId || !linkUrl) {
    const err = new Error(
      !pageId
        ? "This brand has no Facebook Page selected for ads. Pick a Page for this brand in the Facebook Setup Wizard, then try again."
        : "This brand has no ad destination link. Add a website / destination link in the brand's settings, then try again."
    );
    err.statusCode = 503;
    throw err;
  }
  if (!grantedPages.some((p) => p && p.id === pageId)) {
    const err = new Error(
      "This brand's Facebook Page is no longer available on your connected Facebook account. Reconnect Facebook and grant access to that Page (or pick a different Page for this brand), then try again."
    );
    err.statusCode = 503;
    throw err;
  }
  return { pageId, linkUrl };
}

/**
 * Builds a Facebook targeting spec from supplied audience details.
 */
function buildTargeting(targetAudience = {}, brandGeo = null) {
  // Required by Facebook (subcode 1870227): the targeting spec must state the
  // Advantage Audience flag explicitly. We build explicit targeting, so it is
  // disabled (0) — never let Facebook auto-expand past our geo hard blocks.
  const targeting = { targeting_automation: { advantage_audience: 0 } };

  // Brand geographic targeting + exclusion zones are a HARD BLOCK: when
  // configured they override any audience-supplied countries entirely.
  const geoSpec = fbGeoLocations(brandGeo);
  if (geoSpec) {
    targeting.geo_locations = geoSpec.geo_locations;
    if (geoSpec.excluded_geo_locations) {
      targeting.excluded_geo_locations = geoSpec.excluded_geo_locations;
    }
  } else {
    const countries = targetAudience.countries || targetAudience.geo_locations?.countries;
    targeting.geo_locations = { countries: countries && countries.length ? countries : ["US"] };
  }

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
 * Launches a Facebook campaign + ad set for an OWNED brand and stores the
 * record in the campaigns table. Shared by the manual create-campaign endpoint
 * and Autopilot's approve-ad path so both go through the exact same steps.
 * The Facebook objects are created PAUSED (nothing spends until enabled at
 * Facebook), and the local row honestly says so: it is inserted as
 * 'created_paused'. Only the verification helper (Facebook read-back) can
 * ever mark a campaign 'live', and only live campaigns count as committed
 * spend.
 *
 * @param {object} p { userId, brand, name?, goal, budget, targetAudience?, creativeOverride? }
 * @returns {{campaignId, facebookCampaignId, facebookAdSetId, facebookCreativeId, objective}}
 */
async function launchFacebookCampaign(p) {
  const { userId, brand, name, goal, budget, targetAudience, creativeOverride } = p;

  const objective = GOAL_TO_OBJECTIVE[goal] || GOAL_TO_OBJECTIVE.leads;
  const campaignName = name || `${brand.brand_name} - ${goal}`;
  const dailyBudgetCents = Math.round(Number(budget) * 100);

  // Prompt 018 — canonical task-spine adopter (guide steps 1-2): the launch
  // request IS the approval; the canonical task and the pre-generated
  // campaigns.campaign_id exist BEFORE any Facebook call. Recording is
  // safeSpine'd — a spine failure never blocks or alters the launch.
  const spineActor = p.spineActor || `owner:${userId}`;
  const spineOrigin = p.spineOrigin || "manual";
  const launchRec = await adLaunchSpine.beginLaunch({
    brandId: brand.brand_id,
    userId,
    actor: spineActor,
    origin: spineOrigin,
    title: `Launch Facebook campaign: ${campaignName}`,
  });

  // Track every Facebook object id as it is created so a mid-chain failure can
  // be recorded (never silent) and the orphaned objects cleaned up.
  const ids = { campaignId: null, adSetId: null, creativeId: null, adId: null };

  let accessToken, accountRef, pageId, linkUrl, variations;
  try {
    const integration = await getFacebookIntegration(userId);
    accessToken = integration.accessToken;
    accountRef = integration.accountRef;

    // Fail fast BEFORE creating any Facebook object: a deliverable chain needs a
    // creative, which needs a Page + destination link — resolved from the BRAND
    // row, never from env vars (mirrors the Ad Creative Studio guard).
    ({ pageId, linkUrl } = resolveBrandAdDestination(brand, integration.grantedPages));

    variations = creativeOverride
      ? [creativeOverride]
      : generateCreativeVariations(brand, { campaignGoal: goal, count: 3 });
  } catch (preErr) {
    // Pre-provider failure (no Facebook object exists): classify + record on
    // the trail (guide step 5), then surface exactly as before.
    await adLaunchSpine.recordLaunchFailure({
      taskId: launchRec.taskId,
      campaignId: launchRec.campaignId,
      brandId: brand.brand_id,
      userId,
      ids,
      error: preErr,
    });
    throw preErr;
  }

  try {
    // 1. Create the campaign (paused so nothing spends until reviewed).
    const campaign = await graphPost(
      `${accountRef}/campaigns`,
      {
        name: campaignName,
        objective,
        status: "PAUSED",
        special_ad_categories: [],
        // Required by Facebook (subcode 4834011): budgets live on our ad
        // sets, so ad-set budget sharing must be explicitly disabled.
        is_adset_budget_sharing_enabled: false,
      },
      accessToken
    );
    ids.campaignId = campaign.id;

    // 2. Create the ad set (paused).
    const adSet = await graphPost(
      `${accountRef}/adsets`,
      {
        name: `${campaignName} - Ad Set`,
        campaign_id: campaign.id,
        daily_budget: dailyBudgetCents,
        billing_event: "IMPRESSIONS",
        // Required by Facebook (subcode 2490487): without an explicit bid
        // strategy it demands a bid cap. Automatic bidding needs no bid amount.
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        optimization_goal: objective === "OUTCOME_LEADS" ? "LEAD_GENERATION" : "REACH",
        // Required by Facebook (subcode 1885154): the ad set must name what
        // it promotes. Our ads promote the connected Page.
        promoted_object: { page_id: pageId },
        targeting: buildTargeting(targetAudience, brand.geo_targeting),
        status: "PAUSED",
      },
      accessToken
    );
    ids.adSetId = adSet.id;

    // 3. Create the ad creative (page + link guaranteed by the guard above).
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
    ids.creativeId = creative.id;

    // 4. Create the actual ad object — PAUSED, via the one shared helper.
    // Duplicate guard: never POST /ads twice for the same Facebook campaign.
    const existingAdId = await findExistingAdId(ids.campaignId);
    if (existingAdId) {
      ids.adId = existingAdId;
    } else {
      const ad = await createPausedAd(
        accountRef,
        { name: `${campaignName} - Ad`, adSetId: ids.adSetId, creativeId: ids.creativeId },
        accessToken
      );
      ids.adId = ad.id;
    }
  } catch (err) {
    // Honest partial-chain handling: record whatever was created for cleanup,
    // then surface the failure — never report success on a partial chain.
    await recordFailedLaunch({
      brandId: brand.brand_id,
      userId,
      campaignName,
      budget,
      variations,
      ids,
      error: err,
      campaignId: launchRec.campaignId,
    });
    // Guide step 5: partial chain -> EXTERNAL_FAILURE with the partial ids in
    // evidence (D-27 §11); pre-chain causes classify to their failure state.
    await adLaunchSpine.recordLaunchFailure({
      taskId: launchRec.taskId,
      campaignId: launchRec.campaignId,
      brandId: brand.brand_id,
      userId,
      ids,
      error: err,
    });
    err.partialChain = { ...ids };
    if (!err.statusCode) err.statusCode = 502;
    throw err;
  }

  console.log(
    `Facebook launch complete for brand ${brand.brand_id}: ` +
      `campaign=${ids.campaignId} adset=${ids.adSetId} creative=${ids.creativeId} ad=${ids.adId} (all PAUSED)`
  );

  // 5. Store the campaign record locally — facebook_ad_id is persisted only
  // here, after Facebook successfully returned the ad id. If the local write
  // fails AFTER Facebook succeeded, the chain is still recorded (or at minimum
  // logged with every id) so the objects are never silently orphaned.
  let inserted;
  try {
    inserted = await db.query(
      `INSERT INTO campaigns
         (campaign_id, brand_id, user_id, campaign_name, budget, ad_creative_variations,
          launch_date, facebook_campaign_id, facebook_adset_id,
          facebook_creative_id, facebook_ad_id, status)
       VALUES ($10, $1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, $8, $9, 'created_paused')
       RETURNING campaign_id`,
      [
        brand.brand_id,
        userId,
        campaignName,
        budget,
        JSON.stringify(variations),
        ids.campaignId,
        ids.adSetId,
        ids.creativeId,
        ids.adId,
        launchRec.campaignId,
      ]
    );
  } catch (err) {
    await recordFailedLaunch({
      brandId: brand.brand_id,
      userId,
      campaignName,
      budget,
      variations,
      ids,
      error: err,
      // Keep the failure row joined to the canonical task source id.
      campaignId: launchRec.campaignId,
    });
    // Provider chain complete, local persist failed: PROVIDER_ACCEPTED (ids
    // attached) then MANUAL_REVIEW — never a relaunch (Addendum F).
    await adLaunchSpine.recordPersistFailure({
      taskId: launchRec.taskId,
      campaignId: launchRec.campaignId,
      brandId: brand.brand_id,
      userId,
      ids,
      error: err,
    });
    err.partialChain = { ...ids };
    if (!err.statusCode) err.statusCode = 500;
    throw err;
  }

  // Guide steps 3-4: PROVIDER_ACCEPTED (all four ids) -> Prompt 005 read-back
  // -> proof row -> EXTERNALLY_VERIFIED -> REPORTED -> COMPLETED.
  await adLaunchSpine.recordLaunchSuccess({
    taskId: launchRec.taskId,
    campaignId: inserted.rows[0].campaign_id,
    brandId: brand.brand_id,
    userId,
    ids,
  });

  return {
    campaignId: inserted.rows[0].campaign_id,
    facebookCampaignId: ids.campaignId,
    facebookAdSetId: ids.adSetId,
    facebookCreativeId: ids.creativeId,
    facebookAdId: ids.adId,
    objective,
  };
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

    // Prompt 018: trusted internal callers (Echo companion, Setup Wizard)
    // label their launches for the audit trail; anything else is 'manual'.
    const origin = ["echo", "setup_wizard"].includes(req.body.origin) ? req.body.origin : "manual";

    const launched = await launchFacebookCampaign({
      userId,
      brand,
      name,
      goal,
      budget,
      targetAudience,
      spineActor: `owner:${userId}`,
      spineOrigin: origin,
    });

    return res.status(201).json(launched);
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("Create campaign error:", err.message);
    const body = { error: err.message || "Failed to create campaign" };
    // Surface a partial Facebook chain to the UI — never a silent partial launch.
    if (err.partialChain) body.partialChain = err.partialChain;
    return res.status(status).json(body);
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
       WHERE user_id = $1 AND status IN ('created_paused', 'live') AND facebook_campaign_id IS NOT NULL`,
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
  const { brandId } = req.query;
  if (brandId && !/^[0-9a-f-]{36}$/i.test(String(brandId))) {
    return res.status(400).json({ error: "Invalid brandId" });
  }

  try {
    let result;
    if (brandId) {
      // Brand-scoped: only the selected brand's campaigns, and only if the
      // brand belongs to this user (foreign brandId returns nothing).
      result = await db.query(
        `SELECT c.campaign_id, c.campaign_name, c.budget, c.cost_per_lead,
                c.conversion_rate, c.launch_date, c.facebook_campaign_id, c.status,
                c.activation_requested_at, c.last_verified_at
         FROM campaigns c
         JOIN brands b ON b.brand_id = c.brand_id AND b.user_id = $1
         WHERE c.brand_id = $2 AND c.status IN ('created_paused', 'live')
         ORDER BY c.launch_date DESC`,
        [userId, brandId]
      );
    } else {
      // Legacy all-brands view: never let demo-brand campaigns spill into it.
      result = await db.query(
        `SELECT c.campaign_id, c.campaign_name, c.budget, c.cost_per_lead,
                c.conversion_rate, c.launch_date, c.facebook_campaign_id, c.status,
                c.activation_requested_at, c.last_verified_at
         FROM campaigns c
         LEFT JOIN brands b ON b.brand_id = c.brand_id
         WHERE c.user_id = $1 AND c.status IN ('created_paused', 'live')
           AND COALESCE(b.is_demo, false) = false
         ORDER BY c.launch_date DESC`,
        [userId]
      );
    }

    const campaigns = result.rows.map((c) => ({
      campaignId: c.campaign_id,
      name: c.campaign_name,
      budget: c.budget,
      costPerLead: c.cost_per_lead,
      conversionRate: c.conversion_rate,
      launchDate: c.launch_date,
      facebookCampaignId: c.facebook_campaign_id,
      status: c.status,
      // Prompt 015: "Facebook is reviewing / activation pending" is honestly
      // distinct from "intentionally paused" (owner terms 5 & 7).
      activationPending: Boolean(c.activation_requested_at),
      lastVerifiedAt: c.last_verified_at,
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
  launchFacebookCampaign,
  resolveBrandAdDestination,
  createCampaign,
  optimizeCampaign,
  getCampaignPerformance,
  generateAdCreative,
};
