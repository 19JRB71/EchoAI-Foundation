/**
 * AI Ad Creative Director agent prompt + validator.
 *
 * Unlike the deterministic `adCreativePrompt.js` (used by campaign launch &
 * optimization), this module drives a REAL Anthropic call: it asks the model to
 * act as an Ad Creative Director and return five complete, ready-to-launch ad
 * creative packages tailored to the brand's full profile, discovery insights,
 * and competitive positioning.
 */

// Supported campaign goals. The client mirrors this list; the controller maps
// each to a Facebook objective at launch time.
const CAMPAIGN_GOALS = [
  "lead_generation",
  "sales",
  "brand_awareness",
  "traffic",
  "engagement",
];

const PACKAGE_COUNT = 5;

const AD_CREATIVE_DIRECTOR_SYSTEM_PROMPT = [
  "You are EchoAI's Ad Creative Director — a world-class performance marketer and",
  "creative strategist. You design complete, ready-to-launch paid social ad",
  "creative that is perfectly on-brand and engineered to hit a specific campaign",
  "goal. You think in distinct marketing angles (problem/solution, social proof,",
  "benefit-led, emotional, aspirational, urgency, curiosity, authority) and never",
  "repeat the same angle twice. Every word respects the brand voice and speaks",
  "directly to the target audience. You return STRICT JSON only — no prose, no",
  "markdown fences.",
].join(" ");

function describeAudience(targetAudience) {
  if (!targetAudience) return "the brand's ideal customers";
  if (typeof targetAudience === "string") return targetAudience;
  if (typeof targetAudience === "object") {
    return (
      targetAudience.description ||
      targetAudience.summary ||
      [targetAudience.demographics, targetAudience.interests]
        .filter(Boolean)
        .join(", ") ||
      JSON.stringify(targetAudience)
    );
  }
  return String(targetAudience);
}

function describeVisualStyle(visualStyle) {
  if (!visualStyle) return "clean, modern visuals";
  if (typeof visualStyle === "string") return visualStyle;
  if (typeof visualStyle === "object") {
    return (
      visualStyle.description ||
      [visualStyle.palette, visualStyle.mood, visualStyle.style]
        .filter(Boolean)
        .join(", ") ||
      JSON.stringify(visualStyle)
    );
  }
  return String(visualStyle);
}

function compact(value, max = 1500) {
  if (!value) return "";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

/**
 * Builds the Ad Creative Director user prompt.
 *
 * @param {object} params
 * @param {object} params.brand            Brand row.
 * @param {string} params.campaignGoal     One of CAMPAIGN_GOALS.
 * @param {string} [params.budgetRange]    Human budget hint, e.g. "$500-$1000/mo".
 * @param {string} [params.productFocus]   Optional product/offer to feature.
 * @param {string} [params.businessType]   Brand owner's industry.
 * @param {object} [params.discoveryProfile]  draft_profile from brand discovery.
 * @param {object} [params.competitorIntel]   Latest competitor intelligence report.
 */
function buildAdCreativeStudioPrompt({
  brand,
  campaignGoal,
  budgetRange,
  productFocus,
  businessType,
  discoveryProfile,
  competitorIntel,
} = {}) {
  const name = brand.brand_name || "the brand";
  const personality = brand.brand_personality || "professional and approachable";
  const voice = brand.voice_description || "clear, friendly, and benefit-focused";
  const audience = describeAudience(brand.target_audience);
  const visualStyle = describeVisualStyle(brand.visual_style_preferences);

  const lines = [
    "Create ad creative for the following brand.",
    "",
    "BRAND PROFILE",
    `- Name: ${name}`,
    `- Personality: ${personality}`,
    `- Voice: ${voice}`,
    `- Target audience: ${audience}`,
    `- Visual style: ${visualStyle}`,
  ];

  if (businessType) lines.push(`- Business type / industry: ${businessType}`);
  if (discoveryProfile) {
    lines.push("", "BRAND DISCOVERY INSIGHTS", compact(discoveryProfile));
  }
  if (competitorIntel) {
    lines.push("", "COMPETITIVE POSITIONING", compact(competitorIntel));
  }

  lines.push(
    "",
    "CAMPAIGN BRIEF",
    `- Goal: ${campaignGoal}`,
    `- Budget range: ${budgetRange || "not specified"}`,
    `- Product / offer to feature: ${productFocus || "the brand's core offering"}`,
    "",
    `Produce EXACTLY ${PACKAGE_COUNT} complete ad creative packages, each using a`,
    "DISTINCT marketing angle. Tailor everything to the campaign goal above.",
    "",
    "Return STRICT JSON in exactly this shape (no markdown, no commentary):",
    "{",
    '  "packages": [',
    "    {",
    '      "conceptName": "short memorable name for this concept",',
    '      "angle": "the marketing angle used",',
    '      "headline": "scroll-stopping headline (<= 40 chars)",',
    '      "bodyCopyVariations": ["2-3 distinct primary-text options in brand voice"],',
    '      "imageDescription": "detailed prompt for an AI image generator reflecting the visual style",',
    '      "videoScript": {',
    '        "hook": "first 3 seconds hook",',
    '        "scenes": ["scene 1", "scene 2", "scene 3"],',
    '        "cta": "spoken/closing call to action"',
    "      },",
    '      "audienceTargeting": {',
    '        "description": "who to target and why",',
    '        "ageMin": 18,',
    '        "ageMax": 65,',
    '        "interests": ["interest 1", "interest 2"],',
    '        "demographics": "key demographic notes"',
    "      },",
    '      "recommendedPlacements": ["e.g. Facebook Feed", "Instagram Stories", "Reels"],',
    '      "callToAction": "the button CTA, e.g. Learn More / Shop Now / Sign Up"',
    "    }",
    "  ]",
    "}",
  );

  return lines.join("\n");
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Validates the AI output before it is shown or persisted. Returns the cleaned
 * packages array, or throws a 502 error if the response is malformed/empty.
 */
function validateCreativePackages(parsed) {
  const packages = parsed && Array.isArray(parsed.packages) ? parsed.packages : null;

  const fail = (message) => {
    const err = new Error(message);
    err.statusCode = 502;
    throw err;
  };

  if (!isNonEmptyArray(packages)) {
    fail("The AI returned no ad creative packages");
  }
  if (packages.length < PACKAGE_COUNT) {
    fail(`The AI returned ${packages.length} packages; expected ${PACKAGE_COUNT}`);
  }

  const cleaned = packages.slice(0, PACKAGE_COUNT).map((p, i) => {
    if (!p || typeof p !== "object") fail(`Creative package ${i + 1} is malformed`);
    if (!isNonEmptyString(p.headline)) fail(`Creative package ${i + 1} is missing a headline`);
    if (!isNonEmptyArray(p.bodyCopyVariations) || !p.bodyCopyVariations.every(isNonEmptyString)) {
      fail(`Creative package ${i + 1} is missing body copy`);
    }
    if (!isNonEmptyString(p.imageDescription)) {
      fail(`Creative package ${i + 1} is missing an image description`);
    }
    const vs = p.videoScript;
    if (!vs || !isNonEmptyString(vs.hook) || !isNonEmptyArray(vs.scenes)) {
      fail(`Creative package ${i + 1} is missing a video script`);
    }
    const at = p.audienceTargeting;
    if (!at || !isNonEmptyString(at.description)) {
      fail(`Creative package ${i + 1} is missing audience targeting`);
    }
    if (!isNonEmptyArray(p.recommendedPlacements)) {
      fail(`Creative package ${i + 1} is missing recommended placements`);
    }
    if (!isNonEmptyString(p.callToAction)) {
      fail(`Creative package ${i + 1} is missing a call to action`);
    }
    return p;
  });

  return cleaned;
}

module.exports = {
  CAMPAIGN_GOALS,
  PACKAGE_COUNT,
  AD_CREATIVE_DIRECTOR_SYSTEM_PROMPT,
  buildAdCreativeStudioPrompt,
  validateCreativePackages,
};
