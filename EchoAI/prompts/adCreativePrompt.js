/**
 * Ad Creative agent prompt + generator.
 *
 * - buildAdCreativePrompt(brand, opts): builds the instruction prompt that can be
 *   sent to an LLM to produce on-brand ad copy.
 * - generateCreativeVariations(brand, opts): produces structured, brand-tailored
 *   ad copy + image prompt variations derived from the brand profile.
 */

const {
  isPolitical,
  campaignContextBlock,
  requiredDisclaimer,
  ensureDisclaimer,
} = require("../utils/politicalContext");
const { realEstateContextBlock } = require("../utils/realEstateContext");
const { geoContextBlock } = require("../utils/geoTargeting");

function describeAudience(targetAudience) {
  if (!targetAudience) return "your ideal customers";
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

function describeVisualStyle(visualStyle) {
  if (!visualStyle) return "clean, modern visuals";
  if (typeof visualStyle === "string") return visualStyle;
  if (typeof visualStyle === "object") {
    return (
      visualStyle.description ||
      [visualStyle.palette, visualStyle.mood, visualStyle.style].filter(Boolean).join(", ") ||
      JSON.stringify(visualStyle)
    );
  }
  return String(visualStyle);
}

/**
 * Builds the LLM instruction prompt for generating ad creative for a brand.
 */
function buildAdCreativePrompt(brand, options = {}) {
  const { campaignGoal = "lead generation", variations = 3 } = options;

  const name = brand.brand_name || "the brand";
  const personality = brand.brand_personality || "professional and approachable";
  const voice = brand.voice_description || "clear, friendly, and benefit-focused";
  const audience = describeAudience(brand.target_audience);
  const visualStyle = describeVisualStyle(brand.visual_style_preferences);

  return [
    "You are Zorecho's Ad Creative agent. Your job is to write high-performing Facebook ad creative that is perfectly on-brand.",
    "",
    "Brand profile:",
    `- Name: ${name}`,
    `- Personality: ${personality}`,
    `- Voice: ${voice}`,
    `- Target audience: ${audience}`,
    `- Visual style: ${visualStyle}`,
    "",
    `Campaign goal: ${campaignGoal}`,
    ...(isPolitical(brand)
      ? [
          "",
          campaignContextBlock(brand),
          `Every ad's primary text MUST end with the exact disclosure line: "${requiredDisclaimer(brand)}".`,
        ]
      : []),
    ...(realEstateContextBlock(brand)
      ? [
          "",
          realEstateContextBlock(brand),
          "Follow Facebook's Special Ad Category rules for housing: no targeting language based on protected classes; focus every ad on the property, the market area, and the agent's service.",
        ]
      : []),
    ...(geoContextBlock(brand) ? ["", geoContextBlock(brand)] : []),
    "",
    `Produce ${variations} distinct ad variations. For each variation provide:`,
    "1. A scroll-stopping headline (<= 40 characters).",
    "2. Primary text (2-3 sentences) written in the brand voice and speaking directly to the target audience.",
    "3. A clear call-to-action.",
    "4. An image generation prompt that reflects the brand's visual style and personality.",
    "",
    "Return the result as a JSON array of objects with keys: headline, primaryText, callToAction, imagePrompt.",
  ].join("\n");
}

/**
 * Deterministically generates brand-tailored creative variations from the brand
 * profile. Each variation uses a different marketing angle.
 */
function generateCreativeVariations(brand, options = {}) {
  const { campaignGoal = "lead generation", count = 3 } = options;

  const name = brand.brand_name || "Your Brand";
  const personality = brand.brand_personality || "professional and approachable";
  const voice = brand.voice_description || "clear and friendly";
  const audience = describeAudience(brand.target_audience);
  const visualStyle = describeVisualStyle(brand.visual_style_preferences);

  const angles = [
    {
      angle: "Problem / Solution",
      headline: `Struggling? ${name} Can Help`,
      primaryText: `${audience} shouldn't have to settle. ${name} delivers a ${personality} solution built around what you actually need. See the difference today.`,
      callToAction: "Learn More",
    },
    {
      angle: "Social Proof",
      headline: `Why ${audience} Choose ${name}`,
      primaryText: `Join the people already getting results with ${name}. Our ${voice} approach makes it simple to get started and easy to stay.`,
      callToAction: "Get Started",
    },
    {
      angle: "Benefit-Led",
      headline: `${name}: Results You Can See`,
      primaryText: `Spend less time guessing and more time growing. ${name} brings a ${personality} edge to ${campaignGoal}, tailored for ${audience}.`,
      callToAction: "Sign Up",
    },
    {
      angle: "Question Hook",
      headline: `Ready to Level Up?`,
      primaryText: `What would change if ${name} handled the hard part? Built for ${audience} and powered by a ${voice} voice, we make ${campaignGoal} effortless.`,
      callToAction: "Discover More",
    },
    {
      angle: "Limited Offer",
      headline: `Don't Miss Out on ${name}`,
      primaryText: `Now is the time to act. ${name} is helping ${audience} reach their goals with a ${personality} experience. Get in before it's gone.`,
      callToAction: "Claim Offer",
    },
  ];

  const political = isPolitical(brand);
  return angles.slice(0, Math.max(1, Math.min(count, angles.length))).map((a) => ({
    angle: a.angle,
    headline: a.headline,
    // Political ads must always carry the required disclosure line — enforced
    // deterministically here, never left to chance.
    primaryText: political ? ensureDisclaimer(a.primaryText, brand) : a.primaryText,
    callToAction: a.callToAction,
    imagePrompt: `A ${personality} advertising image for "${name}" in the style of ${visualStyle}, designed to appeal to ${audience}. High quality, scroll-stopping, social-media ready.`,
  }));
}

module.exports = {
  buildAdCreativePrompt,
  generateCreativeVariations,
};
