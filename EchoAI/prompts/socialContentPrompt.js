/**
 * Social Content Generation agent prompt + generator.
 *
 * - SUPPORTED_PLATFORMS: the platforms the system can generate/post for.
 * - buildSocialContentPrompt(brand, topic, platform): builds the system prompt
 *   that instructs the LLM to produce five platform-native post variations.
 * - generateSocialPosts(brand, topic, platform, count): calls the Anthropic API
 *   with the brand profile and returns the parsed variations.
 */

const { anthropic, MODEL } = require("../config/anthropic");
const { sageBlock } = require("../utils/sageContext");
const { campaignContextBlock } = require("../utils/politicalContext");
const { realEstateContextBlock } = require("../utils/realEstateContext");
const { geoContextBlock } = require("../utils/geoTargeting");

const SUPPORTED_PLATFORMS = [
  "facebook",
  "instagram",
  "tiktok",
  "linkedin",
  "twitter",
  "youtube",
];

// Per-platform guidance the agent must respect so each variation feels native.
const PLATFORM_GUIDELINES = {
  facebook: [
    "Conversational and community-oriented; 1-2 short paragraphs.",
    "Use at most 1-2 hashtags.",
    "Suggest an image or short video description for the post.",
    "Best posting times are typically weekdays 1-4pm.",
  ],
  instagram: [
    "Visual-first. Write a punchy caption with line breaks and tasteful emojis.",
    "Include 8-15 relevant, mixed-reach hashtags.",
    "ALWAYS include a vivid image or reel/video description.",
    "Best posting times are typically 11am-1pm and 7-9pm.",
  ],
  tiktok: [
    "Lead with a strong hook in the first line; keep the caption short and trend-aware.",
    "Use 3-5 trending hashtags and suggest fitting trending sounds.",
    "Describe the video concept / shot list.",
    "Best posting times are typically 6-10am and 7-11pm.",
  ],
  linkedin: [
    "Professional, insightful and value-led; 1-3 short paragraphs.",
    "Use no more than 3 focused hashtags.",
    "Suggest a supporting image or document if useful.",
    "Best posting times are typically Tue-Thu 8-10am.",
  ],
  twitter: [
    "Short and punchy; the post text must stay within 280 characters.",
    "Use 1-2 hashtags only.",
    "Best posting times are typically weekdays 9am-12pm.",
  ],
  youtube: [
    "Generate a compelling video title (<= 70 characters) and a keyword-rich description.",
    "Suggest a thumbnail concept.",
    "Use the platformExtras object for videoTitle and videoDescription.",
    "Best posting times are typically weekends 9-11am.",
  ],
};

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

/**
 * Builds the LLM instruction prompt for generating platform-native social posts.
 */
function buildSocialContentPrompt(brand, topic, platform) {
  const normalized = String(platform || "").toLowerCase();
  const name = brand.brand_name || "the brand";
  const personality = brand.brand_personality || "professional and approachable";
  const voice = brand.voice_description || "clear, friendly, and benefit-focused";
  const audience = describeAudience(brand.target_audience);
  const guidelines = PLATFORM_GUIDELINES[normalized] || [
    "Write a clear, on-brand social post.",
  ];
  const political = campaignContextBlock(brand);

  return [
    "You are EchoAI's Social Content agent. You write social media posts that are perfectly on-brand and native to a specific platform.",
    "",
    "Brand profile:",
    `- Name: ${name}`,
    `- Personality: ${personality}`,
    `- Voice: ${voice}`,
    `- Target audience: ${audience}`,
    "",
    `Target platform: ${normalized}`,
    `Content topic / theme: ${topic}`,
    "",
    `Platform rules for ${normalized}:`,
    ...guidelines.map((g) => `- ${g}`),
    ...(political ? ["", political] : []),
    ...(realEstateContextBlock(brand)
      ? [
          "",
          realEstateContextBlock(brand),
          "Real-estate content mix to draw from: new listing announcements, just-sold announcements, open house promotions, market update statistics (only real figures provided to you — never invent numbers), neighborhood spotlights, home buying and selling tips, and client testimonials (only real ones provided to you).",
        ]
      : []),
    ...(geoContextBlock(brand)
      ? [
          "",
          geoContextBlock(brand),
          "Tag/reference the correct local geographic locations for this service area in the post copy and hashtags (city names, neighborhoods, local hashtags).",
        ]
      : []),
    sageBlock(brand._sageContext),
    "",
    "Produce EXACTLY 5 distinct post variations. Each variation must feel native to the platform while staying true to the brand voice and personality.",
    "",
    "Return ONLY a JSON array of 5 objects (no prose, no markdown fences). Each object must have these keys:",
    '- "postText": the ready-to-post copy, respecting the platform character limits.',
    '- "hashtags": an array of hashtag strings (without surrounding text).',
    '- "visualIdea": a short image/video description (use a thumbnail concept for YouTube).',
    '- "callToAction": the call-to-action for the post.',
    '- "bestPostingTime": the recommended posting time/window for this platform.',
    '- "platformExtras": an object for platform-specific extras (e.g. trendingSounds for TikTok, videoTitle and videoDescription for YouTube). Use an empty object if none.',
  ].join("\n");
}

/**
 * Extracts a JSON array from an LLM response that may include prose or code
 * fences. Throws if no array can be parsed.
 */
function extractJsonArray(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Could not parse social content variations from the AI response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Generates `count` social post variations for a brand on a platform using the
 * Anthropic API. Returns an array of variation objects.
 */
async function generateSocialPosts(brand, topic, platform, count = 5) {
  const systemPrompt = buildSocialContentPrompt(brand, topic, platform);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Generate ${count} ${platform} post variations about: ${topic}. Respond with only the JSON array.`,
      },
    ],
  });

  const text = response.content?.[0]?.text || "";
  const variations = extractJsonArray(text);
  if (!Array.isArray(variations) || variations.length === 0) {
    throw new Error("The AI response did not contain any social post variations");
  }
  return variations;
}

module.exports = {
  SUPPORTED_PLATFORMS,
  PLATFORM_GUIDELINES,
  buildSocialContentPrompt,
  generateSocialPosts,
};
