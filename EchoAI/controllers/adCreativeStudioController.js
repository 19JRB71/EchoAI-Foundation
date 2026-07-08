const db = require("../config/db");
const { anthropic, MODEL } = require("../config/anthropic");
const { graphGet, graphPost } = require("../utils/facebookApi");
const { decrypt } = require("../utils/encryption");
const {
  CAMPAIGN_GOALS,
  AD_CREATIVE_DIRECTOR_SYSTEM_PROMPT,
  buildAdCreativeStudioPrompt,
  validateCreativePackages,
} = require("../prompts/adCreativeStudioPrompt");
const { isPolitical, ensureDisclaimer } = require("../utils/politicalContext");
const { fbGeoLocations } = require("../utils/geoTargeting");

// Maps an EchoAI campaign goal to a Facebook campaign objective.
const GOAL_TO_OBJECTIVE = {
  lead_generation: "OUTCOME_LEADS",
  sales: "OUTCOME_SALES",
  brand_awareness: "OUTCOME_AWARENESS",
  traffic: "OUTCOME_TRAFFIC",
  engagement: "OUTCOME_ENGAGEMENT",
};

function extractText(response) {
  return (response.content || [])
    .map((block) => block.text || "")
    .join("")
    .trim();
}

/**
 * Parses a JSON object out of an Anthropic text response, tolerating ``` fences.
 * A parse failure is an upstream AI problem → 502.
 */
function parseJsonResponse(text) {
  const cleaned = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const err = new Error("Failed to parse the AI response as JSON");
    err.statusCode = 502;
    throw err;
  }
}

/**
 * Maps an error to an HTTP status. Anthropic SDK upstream errors carry a numeric
 * `.status` (>= 400) → surface as 502 (never a generic 500). Our own typed
 * errors carry `.statusCode`.
 */
function statusFor(err) {
  if (err.statusCode) return err.statusCode;
  if (typeof err.status === "number" && err.status >= 400) return 502;
  return 500;
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
 * Loads the user's connected Facebook integration (decrypted access token + ad
 * account reference). Throws a 400 if not connected.
 */
async function getFacebookIntegration(userId) {
  const result = await db.query(
    `SELECT api_token_encrypted, account_ref, page_ref, connection_status
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
    pageRef: row.page_ref,
  };
}

/**
 * Generates five complete creative packages for a brand using the AI Ad Creative
 * Director. Pulls the brand's discovery insights and competitive positioning to
 * deepen the brief. Throws 502 on any upstream/parse/validation failure.
 */
async function generateCreativePackagesForBrand(brand, opts = {}) {
  const { campaignGoal, budgetRange, productFocus } = opts;

  // Business type lives on the user, not the brand.
  const ownerResult = await db.query(
    "SELECT industry FROM users WHERE user_id = $1",
    [brand.user_id]
  );
  const businessType = ownerResult.rows[0] ? ownerResult.rows[0].industry : null;

  // Most recent completed brand-discovery profile (best-effort context).
  const discoveryResult = await db.query(
    `SELECT draft_profile
     FROM brand_discovery_sessions
     WHERE brand_id = $1 AND draft_profile IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
    [brand.brand_id]
  );
  const discoveryProfile = discoveryResult.rows[0]
    ? discoveryResult.rows[0].draft_profile
    : null;

  // Latest competitor intelligence report (best-effort context).
  const intelResult = await db.query(
    `SELECT intelligence_report
     FROM competitor_intelligence
     WHERE brand_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [brand.brand_id]
  );
  const competitorIntel = intelResult.rows[0]
    ? intelResult.rows[0].intelligence_report
    : null;

  const prompt = buildAdCreativeStudioPrompt({
    brand,
    campaignGoal,
    budgetRange,
    productFocus,
    businessType,
    discoveryProfile,
    competitorIntel,
  });

  let response;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: AD_CREATIVE_DIRECTOR_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    // Any upstream AI failure (billing/rate/network/runtime) surfaces as 502,
    // never a generic 500 and never a mocked fallback.
    const wrapped = new Error(err.message || "AI request failed");
    wrapped.statusCode = 502;
    throw wrapped;
  }

  const parsed = parseJsonResponse(extractText(response));
  const packages = validateCreativePackages(parsed);
  // Political campaigns: deterministically guarantee the required "Paid for by"
  // disclosure on every body-copy variation — never left to the AI's memory.
  if (isPolitical(brand)) {
    for (const pkg of packages) {
      pkg.bodyCopyVariations = pkg.bodyCopyVariations.map((copy) =>
        ensureDisclaimer(copy, brand)
      );
    }
  }
  return packages;
}

/**
 * POST /api/ad-studio/generate
 * Body: { brandId, campaignGoal, budgetRange?, productFocus? }
 * Generates (but does not persist) five creative packages for preview.
 */
async function generateCreatives(req, res) {
  const userId = req.user.userId;
  const { brandId, campaignGoal, budgetRange, productFocus } = req.body;

  if (!brandId || !campaignGoal) {
    return res.status(400).json({ error: "brandId and campaignGoal are required" });
  }
  if (!CAMPAIGN_GOALS.includes(campaignGoal)) {
    return res.status(400).json({
      error: `campaignGoal must be one of: ${CAMPAIGN_GOALS.join(", ")}`,
    });
  }

  try {
    const brand = await getOwnedBrand(brandId, userId);
    const packages = await generateCreativePackagesForBrand(brand, {
      campaignGoal,
      budgetRange,
      productFocus,
    });
    return res.json({ brand: brand.brand_name, campaignGoal, packages });
  } catch (err) {
    const status = statusFor(err);
    console.error("Generate ad creatives error:", err.message);
    return res.status(status).json({ error: err.message || "Failed to generate ad creatives" });
  }
}

/**
 * POST /api/ad-studio
 * Body: { brandId, campaignGoal, packages, budgetRange?, productFocus? }
 * Persists a generated set of creative packages as a draft creative.
 */
async function saveCreative(req, res) {
  const userId = req.user.userId;
  const { brandId, campaignGoal, packages, budgetRange, productFocus } = req.body;

  if (!brandId || !campaignGoal || !Array.isArray(packages) || packages.length === 0) {
    return res
      .status(400)
      .json({ error: "brandId, campaignGoal, and a non-empty packages array are required" });
  }
  if (!CAMPAIGN_GOALS.includes(campaignGoal)) {
    return res.status(400).json({
      error: `campaignGoal must be one of: ${CAMPAIGN_GOALS.join(", ")}`,
    });
  }

  try {
    await getOwnedBrand(brandId, userId);

    // Re-validate the supplied packages before persistence so no malformed/empty
    // creative reaches the DB even though save can be reached independently of
    // generate. A bad client payload here is a 400 (not an upstream AI 502).
    let cleanedPackages;
    try {
      cleanedPackages = validateCreativePackages({ packages });
    } catch {
      return res.status(400).json({ error: "The provided creative packages are invalid or incomplete" });
    }

    const concept = {
      packages: cleanedPackages,
      budgetRange: budgetRange || null,
      productFocus: productFocus || null,
    };

    const inserted = await db.query(
      `INSERT INTO ad_creatives (brand_id, campaign_goal, creative_concept, status)
       VALUES ($1, $2, $3, 'draft')
       RETURNING creative_id, brand_id, campaign_goal, creative_concept, status, created_at`,
      [brandId, campaignGoal, JSON.stringify(concept)]
    );

    return res.status(201).json({ creative: inserted.rows[0] });
  } catch (err) {
    const status = statusFor(err);
    console.error("Save ad creative error:", err.message);
    return res.status(status).json({ error: err.message || "Failed to save ad creative" });
  }
}

/**
 * GET /api/ad-studio/:brandId
 * Returns the creative library for a brand (newest first).
 */
async function getCreativeLibrary(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    await getOwnedBrand(brandId, userId);

    const result = await db.query(
      `SELECT creative_id, brand_id, campaign_goal, creative_concept, status,
              launched_package, facebook_campaign_id, performance_data,
              created_at, updated_at
       FROM ad_creatives
       WHERE brand_id = $1
       ORDER BY created_at DESC`,
      [brandId]
    );

    return res.json({ count: result.rows.length, creatives: result.rows });
  } catch (err) {
    const status = statusFor(err);
    console.error("Get creative library error:", err.message);
    return res.status(status).json({ error: err.message || "Failed to fetch creative library" });
  }
}

/**
 * Builds a conservative Facebook targeting spec from an AI audienceTargeting
 * object. Kept minimal (geo + age + gender) so launches don't fail on
 * unresolved interest IDs.
 */
function buildTargeting(audienceTargeting = {}, brandGeo = null) {
  const targeting = {};
  // Brand geo targeting/exclusions are a HARD BLOCK over any AI-suggested geo.
  const geoSpec = fbGeoLocations(brandGeo);
  if (geoSpec) {
    targeting.geo_locations = geoSpec.geo_locations;
    if (geoSpec.excluded_geo_locations) {
      targeting.excluded_geo_locations = geoSpec.excluded_geo_locations;
    }
  } else {
    const countries =
      (Array.isArray(audienceTargeting.countries) && audienceTargeting.countries) || ["US"];
    targeting.geo_locations = { countries };
  }

  const ageMin = Number(audienceTargeting.ageMin);
  const ageMax = Number(audienceTargeting.ageMax);
  if (Number.isFinite(ageMin)) targeting.age_min = Math.max(13, Math.min(65, ageMin));
  if (Number.isFinite(ageMax)) targeting.age_max = Math.max(13, Math.min(65, ageMax));
  if (Array.isArray(audienceTargeting.genders)) targeting.genders = audienceTargeting.genders;

  return targeting;
}

/**
 * POST /api/ad-studio/launch
 * Body: { creativeId, packageIndex, budget }
 * Launches a single creative package into the existing Facebook campaign infra
 * (paused so nothing spends until reviewed), records a campaigns row so the
 * optimizer/analytics pick it up, and marks the creative as launched.
 */
async function launchCreative(req, res) {
  const userId = req.user.userId;
  const { creativeId, packageIndex, budget } = req.body;

  if (!creativeId || packageIndex === undefined || budget === undefined) {
    return res
      .status(400)
      .json({ error: "creativeId, packageIndex, and budget are required" });
  }

  try {
    // Ownership: join to brands on user_id so a foreign creative 404s.
    const creativeResult = await db.query(
      `SELECT ac.*, b.user_id, b.brand_name, b.geo_targeting
       FROM ad_creatives ac
       JOIN brands b ON b.brand_id = ac.brand_id
       WHERE ac.creative_id = $1 AND b.user_id = $2`,
      [creativeId, userId]
    );
    if (creativeResult.rows.length === 0) {
      return res.status(404).json({ error: "Creative not found" });
    }
    const creative = creativeResult.rows[0];

    if (creative.status === "launched") {
      return res.status(409).json({ error: "This creative has already been launched" });
    }

    const packages =
      creative.creative_concept && Array.isArray(creative.creative_concept.packages)
        ? creative.creative_concept.packages
        : [];
    const pkg = packages[Number(packageIndex)];
    if (!pkg) {
      return res.status(400).json({ error: "packageIndex is out of range" });
    }

    const { accessToken, accountRef, pageRef } = await getFacebookIntegration(userId);

    // A real, deliverable launch needs an ad creative, which requires a Facebook
    // Page + destination link. The Page comes from the owner's Setup Wizard
    // selection (page_ref); fall back to FACEBOOK_PAGE_ID for legacy setups.
    // Fail fast (before creating any campaign/ad set) so we never report success
    // for a campaign that can't actually serve ads.
    const pageId = pageRef || process.env.FACEBOOK_PAGE_ID;
    const linkUrl = process.env.FACEBOOK_LINK_URL;
    if (!pageId || !linkUrl) {
      return res.status(503).json({
        error: !pageId
          ? "No Facebook Page is connected. Finish the Facebook Setup Wizard to pick a Page, then try again."
          : "Facebook ad creation is not configured. Set FACEBOOK_LINK_URL to launch creatives.",
      });
    }
    const objective = GOAL_TO_OBJECTIVE[creative.campaign_goal] || GOAL_TO_OBJECTIVE.lead_generation;
    const campaignName = `${creative.brand_name} - ${pkg.conceptName || pkg.angle || "Creative"}`;
    const dailyBudgetCents = Math.round(Number(budget) * 100);

    // 1. Campaign (paused).
    const campaign = await graphPost(
      `${accountRef}/campaigns`,
      { name: campaignName, objective, status: "PAUSED", special_ad_categories: [] },
      accessToken
    );

    // 2. Ad set (paused).
    const adSet = await graphPost(
      `${accountRef}/adsets`,
      {
        name: `${campaignName} - Ad Set`,
        campaign_id: campaign.id,
        daily_budget: dailyBudgetCents,
        billing_event: "IMPRESSIONS",
        optimization_goal: objective === "OUTCOME_LEADS" ? "LEAD_GENERATION" : "REACH",
        targeting: buildTargeting(pkg.audienceTargeting, creative.geo_targeting),
        status: "PAUSED",
      },
      accessToken
    );

    // 3. Ad creative (page + link guaranteed present by the guard above).
    const created = await graphPost(
      `${accountRef}/adcreatives`,
      {
        name: `${campaignName} - Creative`,
        object_story_spec: {
          page_id: pageId,
          link_data: {
            message: pkg.bodyCopyVariations[0],
            link: linkUrl,
            name: pkg.headline,
            call_to_action: { type: "LEARN_MORE", value: { link: linkUrl } },
          },
        },
      },
      accessToken
    );
    const facebookCreativeId = created.id;

    // 4. Record a campaigns row so the optimizer/analytics include it.
    const insertedCampaign = await db.query(
      `INSERT INTO campaigns
         (brand_id, user_id, campaign_name, budget, ad_creative_variations,
          launch_date, facebook_campaign_id, facebook_adset_id, status)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, 'active')
       RETURNING campaign_id`,
      [
        creative.brand_id,
        userId,
        campaignName,
        budget,
        JSON.stringify([pkg]),
        campaign.id,
        adSet.id,
      ]
    );

    // 5. Mark the creative launched and remember which package shipped.
    const launchedPackage = {
      conceptName: pkg.conceptName || null,
      angle: pkg.angle || null,
      headline: pkg.headline,
      callToAction: pkg.callToAction,
    };
    await db.query(
      `UPDATE ad_creatives
         SET status = 'launched',
             launched_package = $1,
             facebook_campaign_id = $2,
             facebook_adset_id = $3,
             campaign_id = $4
       WHERE creative_id = $5`,
      [
        JSON.stringify(launchedPackage),
        campaign.id,
        adSet.id,
        insertedCampaign.rows[0].campaign_id,
        creativeId,
      ]
    );

    return res.status(201).json({
      creativeId,
      campaignId: insertedCampaign.rows[0].campaign_id,
      facebookCampaignId: campaign.id,
      facebookAdSetId: adSet.id,
      facebookCreativeId,
      objective,
    });
  } catch (err) {
    const status = statusFor(err);
    console.error("Launch creative error:", err.message);
    return res.status(status).json({ error: err.message || "Failed to launch creative" });
  }
}

/**
 * Pulls real Facebook insights for a launched creative's campaign.
 */
async function pullCreativePerformance(creative, accessToken) {
  const insights = await graphGet(
    `${creative.facebook_campaign_id}/insights`,
    { fields: "spend,impressions,clicks,actions,cpc,ctr", date_preset: "last_7d" },
    accessToken
  );

  const row = insights.data && insights.data[0] ? insights.data[0] : {};
  const spend = Number(row.spend || 0);
  const impressions = Number(row.impressions || 0);
  const clicks = Number(row.clicks || 0);
  const ctr = Number(row.ctr || 0);
  const leadAction = (row.actions || []).find(
    (a) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped"
  );
  const leads = leadAction ? Number(leadAction.value) : 0;
  const costPerLead = leads > 0 ? spend / leads : null;
  const conversionRate = clicks > 0 ? leads / clicks : 0;

  return {
    spend,
    impressions,
    clicks,
    ctr,
    leads,
    costPerLead,
    conversionRate,
    measuredAt: new Date().toISOString(),
  };
}

/**
 * Refreshes stored performance_data for every launched creative of a brand with
 * the latest real Facebook metrics. Reusable by the weekly scheduler and the
 * performance endpoint. Throws if the brand has no connected Facebook account.
 *
 * @returns {Promise<number>} number of creatives refreshed.
 */
async function updateCreativePerformanceForBrand(brand) {
  const launched = await db.query(
    `SELECT creative_id, facebook_campaign_id
     FROM ad_creatives
     WHERE brand_id = $1 AND status = 'launched' AND facebook_campaign_id IS NOT NULL`,
    [brand.brand_id]
  );
  if (launched.rows.length === 0) return 0;

  const { accessToken } = await getFacebookIntegration(brand.user_id);

  let refreshed = 0;
  for (const creative of launched.rows) {
    try {
      const performance = await pullCreativePerformance(creative, accessToken);
      await db.query(
        "UPDATE ad_creatives SET performance_data = $1 WHERE creative_id = $2",
        [JSON.stringify(performance), creative.creative_id]
      );
      refreshed += 1;
    } catch (err) {
      console.error(
        `Could not refresh performance for creative ${creative.creative_id}:`,
        err.message
      );
    }
  }
  return refreshed;
}

/**
 * GET /api/ad-studio/performance/:brandId
 * Returns launched creatives with their real Facebook performance, grouped so
 * the client can compare which angles perform best. Attempts a best-effort live
 * refresh first; if Facebook is unreachable, returns the last stored metrics.
 */
async function getCreativePerformance(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;

  try {
    const brand = await getOwnedBrand(brandId, userId);

    // Best-effort live refresh — never fail the response if Facebook is down or
    // not connected; we fall back to the last stored real metrics.
    try {
      await updateCreativePerformanceForBrand(brand);
    } catch (err) {
      console.error(`Live creative performance refresh skipped for brand ${brandId}:`, err.message);
    }

    const result = await db.query(
      `SELECT creative_id, campaign_goal, launched_package, performance_data,
              facebook_campaign_id, updated_at
       FROM ad_creatives
       WHERE brand_id = $1 AND status = 'launched'
       ORDER BY updated_at DESC`,
      [brandId]
    );

    const creatives = result.rows.map((r) => ({
      creativeId: r.creative_id,
      campaignGoal: r.campaign_goal,
      concept: r.launched_package,
      performance: r.performance_data,
      facebookCampaignId: r.facebook_campaign_id,
      updatedAt: r.updated_at,
    }));

    return res.json({ count: creatives.length, creatives });
  } catch (err) {
    const status = statusFor(err);
    console.error("Get creative performance error:", err.message);
    return res.status(status).json({ error: err.message || "Failed to fetch creative performance" });
  }
}

module.exports = {
  generateCreatives,
  saveCreative,
  getCreativeLibrary,
  launchCreative,
  getCreativePerformance,
  updateCreativePerformanceForBrand,
};
