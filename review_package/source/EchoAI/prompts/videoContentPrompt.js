/**
 * AI Video Content agent prompt + generator.
 *
 * - SUPPORTED_VIDEO_PLATFORMS / VIDEO_LENGTHS: the platforms and lengths the
 *   agent can produce video packages for.
 * - buildVideoContentPrompt(brand, topic, platform, length): builds the system
 *   prompt that instructs the LLM to produce a complete, on-brand video package.
 * - generateVideoScript(brand, topic, platform, length): calls the Anthropic API
 *   with the brand profile and returns the parsed video package object.
 */

const { anthropic, MODEL } = require("../config/anthropic");

const SUPPORTED_VIDEO_PLATFORMS = [
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
];

const VIDEO_LENGTHS = ["short", "medium", "long"];

// Human-readable guidance for each length bucket the UI offers.
const LENGTH_GUIDELINES = {
  short: "Under 60 seconds. Punchy and fast-paced; 3-5 tight scenes.",
  medium: "1 to 3 minutes. A clear arc with 5-8 scenes.",
  long: "5 to 10 minutes. In-depth and structured with 8-14 scenes.",
};

// Per-platform direction so each script feels native to where it will run.
const PLATFORM_GUIDELINES = {
  facebook:
    "Facebook ad-style script optimized for conversions. Lead with a problem/benefit hook, keep it skimmable with captions (most viewers watch muted), and drive to a single clear action.",
  instagram:
    "Instagram Reels: vertical, short, punchy and trend-aware. Strong visual hook in the first frame, fast cuts, bold on-screen text, and a loop-friendly ending.",
  tiktok:
    "TikTok: vertical, authentic and high-energy. Hook in the first 1-2 seconds, native/casual tone, trending-sound-friendly pacing, and an interactive CTA (comment/follow).",
  youtube:
    "YouTube: educational or entertaining long-form. A compelling hook + value promise up front, clear segmented teaching/story, retention beats, and an end CTA (subscribe/next video).",
};

function describeAudience(targetAudience) {
  if (!targetAudience) return "your ideal customers";
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

/**
 * Builds the LLM instruction prompt for generating a complete video package.
 */
function buildVideoContentPrompt(brand, topic, platform, length) {
  const normalizedPlatform = String(platform || "").toLowerCase();
  const normalizedLength = String(length || "").toLowerCase();
  const name = brand.brand_name || "the brand";
  const personality = brand.brand_personality || "professional and approachable";
  const voice = brand.voice_description || "clear, friendly, and benefit-focused";
  const audience = describeAudience(brand.target_audience);
  const platformRule =
    PLATFORM_GUIDELINES[normalizedPlatform] ||
    "Write a clear, on-brand video script native to the platform.";
  const lengthRule =
    LENGTH_GUIDELINES[normalizedLength] || "Match the requested video length.";

  return [
    "You are Zorecho's Video Content agent. You write complete, production-ready short-form and long-form video packages that are perfectly on-brand and native to a specific platform.",
    "",
    "Brand profile:",
    `- Name: ${name}`,
    `- Personality: ${personality}`,
    `- Voice: ${voice}`,
    `- Target audience: ${audience}`,
    "",
    `Target platform: ${normalizedPlatform}`,
    `Platform direction: ${platformRule}`,
    `Desired length: ${normalizedLength} — ${lengthRule}`,
    `Video topic / goal: ${topic}`,
    "",
    "The script must match the brand's voice and personality EXACTLY.",
    "",
    "Return ONLY a single JSON object (no prose, no markdown fences) with these keys:",
    '- "title": a short working title for the video.',
    '- "hook": the opening line/visual that grabs attention in the first 3 seconds.',
    '- "scenes": an array of scene objects. Each scene object must have:',
    '    - "scene": the scene number (integer starting at 1),',
    '    - "script": the spoken narration / dialogue for the scene,',
    '    - "visual": a suggested visual / shot description for the scene,',
    '    - "onScreenText": the on-screen text overlay or caption for the scene (empty string if none).',
    '- "callToAction": a strong call to action for the end of the video.',
    '- "musicStyle": a suggested background music style/mood.',
    '- "thumbnailConcept": a description of an eye-catching thumbnail concept.',
    "",
    "Make the number and pacing of scenes fit the desired length and platform.",
  ].join("\n");
}

/**
 * Extracts a JSON object from an LLM response that may include prose or code
 * fences. Throws if no object can be parsed.
 */
function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Could not parse the video package from the AI response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Generates a complete video package for a brand on a platform/length using the
 * Anthropic API. Returns the parsed video package object.
 */
async function generateVideoScript(brand, topic, platform, length) {
  const systemPrompt = buildVideoContentPrompt(brand, topic, platform, length);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Generate a complete ${length} ${platform} video package about: ${topic}. Respond with only the JSON object.`,
      },
    ],
  });

  const text = response.content?.[0]?.text || "";
  const pkg = extractJsonObject(text);
  if (!pkg || typeof pkg !== "object" || !Array.isArray(pkg.scenes)) {
    throw new Error("The AI response did not contain a valid video package");
  }
  return pkg;
}

module.exports = {
  SUPPORTED_VIDEO_PLATFORMS,
  VIDEO_LENGTHS,
  LENGTH_GUIDELINES,
  PLATFORM_GUIDELINES,
  buildVideoContentPrompt,
  generateVideoScript,
};
