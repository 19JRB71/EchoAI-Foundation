/**
 * AI Content Calendar agent prompt + generators.
 *
 * The agent plans a full 30-day social content calendar for a brand. The
 * controller pre-computes the posting "slots" (which day each post lands on and
 * which platform it targets) from the chosen posting frequency, then this agent
 * fills every slot with a unique, on-brand, platform-native post. Content types
 * are varied across the month and no two consecutive posts repeat the same type,
 * so the calendar feels like it was planned by a professional social manager.
 *
 * - CONTENT_TYPES: the rotation of post styles the agent draws from.
 * - POSTING_FREQUENCIES: supported cadences + how many of every 7 days post.
 * - DEFAULT_POSTING_TIMES: per-platform fallback time when the AI omits one.
 * - generateCalendarPosts(brand, opts): fills an array of slots in one call.
 * - generateSingleCalendarPost(brand, opts): regenerates one post.
 */

const { anthropic, MODEL } = require("../config/anthropic");

const SUPPORTED_PLATFORMS = [
  "facebook",
  "instagram",
  "tiktok",
  "linkedin",
  "twitter",
  "youtube",
];

// The variety of content styles the agent rotates through across the month.
const CONTENT_TYPES = [
  "educational",
  "promotional",
  "behind_the_scenes",
  "customer_success",
  "tips_and_tricks",
  "call_to_action",
];

// Supported cadences -> how many of every rolling 7 days carry a post. The
// controller uses `perWeek` to deterministically pick the posting days.
const POSTING_FREQUENCIES = {
  daily: { label: "Daily", perWeek: 7 },
  five_per_week: { label: "5 times per week", perWeek: 5 },
  three_per_week: { label: "3 times per week", perWeek: 3 },
};

// Sensible default posting time (24h "HH:MM") per platform, used when the AI
// does not return a valid bestPostingTime for a slot.
const DEFAULT_POSTING_TIMES = {
  facebook: "13:00",
  instagram: "12:00",
  tiktok: "20:00",
  linkedin: "09:00",
  twitter: "10:00",
  youtube: "10:00",
};

// Short, platform-native guidance so each post reads correctly for its channel.
const PLATFORM_GUIDELINES = {
  facebook: "Conversational, community-oriented, 1-2 short paragraphs, 1-2 hashtags. Audience most active weekdays 1-4pm.",
  instagram: "Visual-first punchy caption with line breaks and tasteful emojis, 8-15 mixed-reach hashtags. Audience most active 11am-1pm and 7-9pm.",
  tiktok: "Strong first-line hook, short trend-aware caption, 3-5 trending hashtags. Audience most active 6-10am and 7-11pm.",
  linkedin: "Professional, insightful, value-led, 1-3 short paragraphs, <=3 focused hashtags. Audience most active Tue-Thu 8-10am.",
  twitter: "Short and punchy, the post text must stay within 280 characters, 1-2 hashtags. Audience most active weekdays 9am-12pm.",
  youtube: "A compelling video title plus a keyword-rich description and a thumbnail concept. Audience most active weekends 9-11am.",
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

function brandHeader(brand, businessType, theme) {
  const name = brand.brand_name || "the brand";
  const personality = brand.brand_personality || "professional and approachable";
  const voice = brand.voice_description || "clear, friendly, and benefit-focused";
  const audience = describeAudience(brand.target_audience);
  const type = businessType || brand.industry || "a small business";
  return [
    "You are EchoAI's AI Content Calendar agent — a seasoned social media manager",
    "who plans months of content that feels personal, varied, and deeply on-brand.",
    "",
    "Brand profile:",
    `- Name: ${name}`,
    `- Business type: ${type}`,
    `- Personality: ${personality}`,
    `- Voice: ${voice}`,
    `- Target audience: ${audience}`,
    theme ? `- Monthly theme / focus: ${theme}` : "- Monthly theme / focus: none specified (use a natural mix)",
  ];
}

/**
 * Builds the system prompt for filling every scheduled slot in the calendar.
 * `slots` is an array of { index, day, platform } objects (index is 1-based).
 */
function buildCalendarPrompt(brand, { businessType, theme, slots }) {
  const slotLines = slots.map(
    (s) =>
      `- Slot ${s.index}: day ${s.day} of 30, platform ${s.platform} (${PLATFORM_GUIDELINES[s.platform] || "write a clear on-brand post"})`
  );

  return [
    ...brandHeader(brand, businessType, theme),
    "",
    `Plan a 30-day content calendar with EXACTLY ${slots.length} posts, one per slot below, in order:`,
    ...slotLines,
    "",
    "Rules:",
    `- Vary the content type across these styles: ${CONTENT_TYPES.join(", ")}.`,
    "- No two CONSECUTIVE posts may share the same content type.",
    "- Every post must be unique — never reuse copy, hooks, or angles.",
    "- Tailor each post natively to its platform and keep the brand voice throughout.",
    "- Suggest a posting time (24h HH:MM) when that platform's audience is most active.",
    "",
    `Return ONLY a JSON array of ${slots.length} objects (no prose, no markdown fences), one per slot IN ORDER. Each object must have:`,
    '- "slot": the slot number (integer).',
    '- "contentType": one of the listed content types.',
    '- "postText": the ready-to-post copy, respecting the platform character limits.',
    '- "hashtags": an array of hashtag strings (without surrounding text; may be empty).',
    '- "visualIdea": a short image/video description (a thumbnail concept for YouTube).',
    '- "callToAction": the call-to-action for the post.',
    '- "bestPostingTime": the recommended posting time as 24h "HH:MM".',
  ].join("\n");
}

/**
 * Builds the system prompt for regenerating a single calendar post.
 */
function buildSinglePostPrompt(brand, { businessType, theme, platform, contentType }) {
  return [
    ...brandHeader(brand, businessType, theme),
    "",
    `Write ONE fresh, unique ${platform} post${contentType ? ` in the "${contentType}" style` : ""}.`,
    `Platform guidance: ${PLATFORM_GUIDELINES[platform] || "write a clear on-brand post"}`,
    "",
    "Return ONLY a single JSON object (no prose, no markdown fences) with:",
    '- "contentType": the content type used.',
    '- "postText": the ready-to-post copy, respecting the platform character limits.',
    '- "hashtags": an array of hashtag strings (may be empty).',
    '- "visualIdea": a short image/video description.',
    '- "callToAction": the call-to-action for the post.',
    '- "bestPostingTime": the recommended posting time as 24h "HH:MM".',
  ].join("\n");
}

/** Extracts a JSON array from an LLM response that may include prose/fences. */
function extractJsonArray(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Could not parse the content calendar from the AI response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Extracts a single JSON object from an LLM response. */
function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Could not parse the regenerated post from the AI response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Generates content for every slot in one Anthropic call. Returns an array of
 * validated post objects aligned to the input slots (same order/length).
 */
async function generateCalendarPosts(brand, { businessType, theme, slots }) {
  const systemPrompt = buildCalendarPrompt(brand, { businessType, theme, slots });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Generate the ${slots.length}-post calendar now. Respond with only the JSON array, one object per slot in order.`,
      },
    ],
  });

  const text = response.content?.[0]?.text || "";
  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("The AI response did not contain any calendar posts");
  }

  // Align the AI output back to our slots by order, validating each post.
  return slots.map((slot, i) => {
    const post = parsed[i] || {};
    const postText = String(post.postText || "").trim();
    if (!postText) {
      throw new Error(`The AI response was missing copy for slot ${slot.index}`);
    }
    const hashtags = Array.isArray(post.hashtags)
      ? post.hashtags.map((h) => String(h).trim()).filter(Boolean)
      : [];
    return {
      contentType: String(post.contentType || CONTENT_TYPES[i % CONTENT_TYPES.length]),
      postText,
      hashtags,
      visualIdea: String(post.visualIdea || "").trim(),
      callToAction: String(post.callToAction || "").trim(),
      bestPostingTime: normalizeTime(post.bestPostingTime, slot.platform),
    };
  });
}

/**
 * Regenerates a single post. Returns one validated post object.
 */
async function generateSingleCalendarPost(brand, opts) {
  const systemPrompt = buildSinglePostPrompt(brand, opts);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1536,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Write the ${opts.platform} post now. Respond with only the JSON object.`,
      },
    ],
  });

  const text = response.content?.[0]?.text || "";
  const post = extractJsonObject(text);
  const postText = String(post.postText || "").trim();
  if (!postText) {
    throw new Error("The AI response did not contain a post");
  }
  const hashtags = Array.isArray(post.hashtags)
    ? post.hashtags.map((h) => String(h).trim()).filter(Boolean)
    : [];
  return {
    contentType: String(post.contentType || opts.contentType || "educational"),
    postText,
    hashtags,
    visualIdea: String(post.visualIdea || "").trim(),
    callToAction: String(post.callToAction || "").trim(),
    bestPostingTime: normalizeTime(post.bestPostingTime, opts.platform),
  };
}

/** Validates an "HH:MM" 24h string, falling back to the platform default. */
function normalizeTime(value, platform) {
  const fallback = DEFAULT_POSTING_TIMES[platform] || "10:00";
  if (typeof value !== "string") return fallback;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return fallback;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/**
 * Composes the final ready-to-post content string stored in social_posts: the
 * post copy followed by its hashtags (this is what actually gets published).
 */
function composePostContent({ postText, hashtags }) {
  const tags = Array.isArray(hashtags) ? hashtags.filter(Boolean) : [];
  if (tags.length === 0) return postText;
  const formatted = tags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
  return `${postText}\n\n${formatted}`;
}

module.exports = {
  SUPPORTED_PLATFORMS,
  CONTENT_TYPES,
  POSTING_FREQUENCIES,
  DEFAULT_POSTING_TIMES,
  generateCalendarPosts,
  generateSingleCalendarPost,
  composePostContent,
  normalizeTime,
};
