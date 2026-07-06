/**
 * Campaign optimization prompts.
 *
 * Defines two AI agents used by the optimization engine:
 *
 *  1. Competitor Analysis agent — given a business niche, a list of competitor
 *     names / URLs, and a target-audience description, it researches the
 *     publicly known messaging, positioning, and marketing angles competitors
 *     use, identifies gaps/opportunities they are NOT exploiting, and returns a
 *     structured competitor intelligence report.
 *
 *  2. Campaign Optimization agent — given the brand profile, current campaign
 *     performance, a competitor intelligence report, and historical analytics,
 *     it analyzes what is working and what is not, produces three new on-brand
 *     ad creative variations, recommends audience-targeting and budget-allocation
 *     changes, and explains its recommendations in plain language.
 */

function describeAudience(targetAudience) {
  if (!targetAudience) return "the brand's ideal customers";
  if (typeof targetAudience === "string") return targetAudience;
  if (typeof targetAudience === "object") {
    return (
      targetAudience.description ||
      targetAudience.summary ||
      [targetAudience.demographics, targetAudience.interests].filter(Boolean).join(", ") ||
      JSON.stringify(targetAudience)
    );
  }
  return String(targetAudience);
}

function deriveNiche(brand) {
  return (
    brand.niche ||
    brand.brand_personality ||
    (brand.brand_name ? `${brand.brand_name}'s market` : "this business's market")
  );
}

const COMPETITOR_ANALYSIS_SYSTEM_PROMPT = [
  "You are EchoAI's Competitor Analysis agent.",
  "You analyze the competitive landscape for a business using publicly available knowledge about how competitors market themselves.",
  "You focus on competitor messaging, positioning, and marketing angles, and you surface gaps and opportunities the competitors are not exploiting.",
  "You always respond with a single valid JSON object and no other text.",
].join(" ");

const CAMPAIGN_OPTIMIZATION_SYSTEM_PROMPT = [
  "You are EchoAI's Campaign Optimization agent.",
  "You analyze advertising performance against competitor intelligence and historical results, then recommend concrete improvements.",
  "Your recommendations must stay true to the brand voice and be explained in plain language a non-technical business owner can act on.",
  "You always respond with a single valid JSON object and no other text.",
].join(" ");

/**
 * Builds the competitor analysis instruction prompt.
 *
 * @param {object} opts
 * @param {string} opts.niche            Business niche / market description.
 * @param {Array}  opts.competitors      Competitor names or website URLs.
 * @param {string} opts.targetAudience   Target audience description.
 */
function buildCompetitorAnalysisPrompt({ niche, competitors = [], targetAudience } = {}) {
  const competitorList =
    competitors.length > 0 ? competitors.map((c) => `- ${c}`).join("\n") : "- (none provided)";

  return [
    "Analyze the competitive landscape for the following business.",
    "",
    `Business niche: ${niche || "(not specified)"}`,
    `Target audience: ${describeAudience(targetAudience)}`,
    "Competitors (names or URLs):",
    competitorList,
    "",
    "Using publicly available knowledge, for each competitor describe:",
    "1. Their core messaging.",
    "2. Their market positioning.",
    "3. The marketing angles they appear to lean on.",
    "",
    "Then identify the gaps and opportunities these competitors are NOT exploiting that this business could use to stand out.",
    "",
    "Return a single JSON object with this exact shape:",
    "{",
    '  "niche": string,',
    '  "targetAudience": string,',
    '  "competitors": [',
    '    { "name": string, "messaging": string, "positioning": string, "marketingAngles": [string] }',
    "  ],",
    '  "gaps": [string],',
    '  "opportunities": [string],',
    '  "summary": string',
    "}",
  ].join("\n");
}

/**
 * Builds the campaign optimization instruction prompt.
 *
 * @param {object} opts
 * @param {object} opts.brand            Brand profile row.
 * @param {Array}  opts.performance      Active campaigns with current metrics.
 * @param {object} opts.competitorIntel  Latest competitor intelligence report (or null).
 * @param {Array}  opts.analytics        Historical weekly analytics rows.
 */
function describeGoalTargets(goalTargets = {}) {
  const lines = [];
  if (Number.isFinite(Number(goalTargets.costPerLead))) {
    lines.push(
      `- Cost per lead target: $${Number(goalTargets.costPerLead)} or lower. ` +
        "Treat this as a hard guardrail — do not recommend changes that would push cost per lead above it; " +
        "prioritize keeping cost per lead at or under this number."
    );
  }
  if (Number.isFinite(Number(goalTargets.roas))) {
    lines.push(
      `- Return on ad spend target: ${Number(goalTargets.roas)}x or higher. ` +
        "Favor reallocations that protect or improve ROAS toward this target."
    );
  }
  if (Number.isFinite(Number(goalTargets.referrals))) {
    lines.push(
      `- Monthly referrals target: ${Number(goalTargets.referrals)} new referrals. ` +
        "For referral/affiliate-driven growth, favor creative and audiences that bring in " +
        "referral sign-ups and push toward this number."
    );
  }
  if (Number.isFinite(Number(goalTargets.commission))) {
    lines.push(
      `- Monthly affiliate commission target: $${Number(goalTargets.commission)}. ` +
        "Prioritize changes that grow commission-generating referred conversions toward this target."
    );
  }
  return lines;
}

function buildCampaignOptimizationPrompt({ brand = {}, performance = [], competitorIntel, analytics = [], goalTargets = {} } = {}) {
  const name = brand.brand_name || "the brand";
  const personality = brand.brand_personality || "professional and approachable";
  const voice = brand.voice_description || "clear, friendly, and benefit-focused";
  const audience = describeAudience(brand.target_audience);
  const targetLines = describeGoalTargets(goalTargets);

  return [
    "You are optimizing the advertising for the brand described below.",
    "",
    "Brand profile:",
    `- Name: ${name}`,
    `- Personality: ${personality}`,
    `- Voice: ${voice}`,
    `- Target audience: ${audience}`,
    `- Niche: ${deriveNiche(brand)}`,
    "",
    ...(targetLines.length
      ? ["Owner's performance goals (optimize toward these as guardrails):", ...targetLines, ""]
      : []),
    "Current campaign performance (active campaigns):",
    JSON.stringify(performance, null, 2),
    "",
    "Competitor intelligence report:",
    competitorIntel ? JSON.stringify(competitorIntel, null, 2) : "(no competitor intelligence available)",
    "",
    "Historical weekly analytics (most recent first):",
    analytics.length ? JSON.stringify(analytics, null, 2) : "(no historical analytics available)",
    "",
    "Analyze what is working and what is not. Then:",
    "1. Generate THREE new ad creative variations tailored to the brand voice, each with copy and image direction.",
    "2. Recommend audience-targeting adjustments.",
    "3. Recommend budget-allocation changes for the active campaigns (reference each campaign by its name).",
    "4. Explain your recommendations in plain language the business owner can understand.",
    "",
    "Return a single JSON object with this exact shape:",
    "{",
    '  "analysis": string,',
    '  "creatives": [',
    '    { "headline": string, "primaryText": string, "callToAction": string, "imagePrompt": string }',
    "  ],",
    '  "audienceRecommendations": [string],',
    '  "budgetRecommendations": [',
    '    { "campaign": string, "action": "increase" | "decrease" | "maintain", "recommendedDailyBudget": number, "reason": string }',
    "  ],",
    '  "explanation": string',
    "}",
    "The creatives array must contain exactly three items.",
  ].join("\n");
}

module.exports = {
  COMPETITOR_ANALYSIS_SYSTEM_PROMPT,
  CAMPAIGN_OPTIMIZATION_SYSTEM_PROMPT,
  buildCompetitorAnalysisPrompt,
  buildCampaignOptimizationPrompt,
  deriveNiche,
};
