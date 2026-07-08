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

const { MODEL, createMessage, HEAVY_AI_TIMEOUT_MS } = require("../config/anthropic");
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

// The variety of content styles the agent rotates through across the month. The
// controller assigns one type per slot in strict rotation so no two consecutive
// posts ever share a type — the AI writes copy for the type it is handed.
const CONTENT_TYPES = [
  "educational",
  "promotional",
  "inspirational",
  "behind_the_scenes",
  "engagement",
];

// The three daily posting windows (start of each requested range), expressed as
// 24h "HH:MM" wall-clock times in the business owner's timezone.
const POSTING_WINDOWS = {
  morning: "08:00", // 8-9am
  afternoon: "12:00", // 12-1pm
  evening: "18:00", // 6-7pm
};

// The DEFAULT per-platform posting schedule ("optimal" mode). Each platform
// posts on its own cadence at fixed daily windows:
// - daily platforms post every day at each listed time,
// - weekly platforms post `perWeek` times spread across the 7-day window.
// Twitter/X is not part of the owner's brief; it defaults to a single morning
// post so it still produces a sensible schedule when selected.
const PLATFORM_SCHEDULES = {
  facebook: { cadence: "daily", times: [POSTING_WINDOWS.morning, POSTING_WINDOWS.afternoon, POSTING_WINDOWS.evening] },
  instagram: { cadence: "daily", times: [POSTING_WINDOWS.morning, POSTING_WINDOWS.afternoon, POSTING_WINDOWS.evening] },
  tiktok: { cadence: "daily", times: [POSTING_WINDOWS.morning, POSTING_WINDOWS.afternoon, POSTING_WINDOWS.evening] },
  linkedin: { cadence: "daily", times: [POSTING_WINDOWS.morning] },
  youtube: { cadence: "weekly", perWeek: 3, times: [POSTING_WINDOWS.morning] },
  twitter: { cadence: "daily", times: [POSTING_WINDOWS.morning] },
};

// Supported cadences. "optimal" is the per-platform default (see
// PLATFORM_SCHEDULES); the legacy cadences map to how many of every rolling 7
// days carry a post, which the controller uses to pick posting days.
const POSTING_FREQUENCIES = {
  optimal: { label: "Optimal (per-platform, up to 3×/day)", perPlatform: true },
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

// Rotating angle seeds handed to the AI (one per post) so that even hundreds of
// posts across a month stay fresh and non-repetitive. They nudge distinct hooks
// and framings; the AI still writes fully original copy for each.
const ANGLE_SEEDS = [
  "a surprising fact or myth-buster",
  "a quick actionable tip",
  "a customer pain point and how you solve it",
  "a day-in-the-life or behind-the-scenes moment",
  "a question that invites replies",
  "a bold opinion or hot take",
  "a before/after or transformation story",
  "a seasonal or timely hook",
  "a common mistake to avoid",
  "a proud win or milestone",
  "a relatable everyday scenario",
  "a mini how-to in steps",
  "a value-driven promotion or offer",
  "an inspiring quote reframed for your audience",
  "a poll or this-or-that prompt",
];

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
    ...(campaignContextBlock(brand) ? ["", campaignContextBlock(brand)] : []),
    ...(realEstateContextBlock(brand)
      ? [
          "",
          realEstateContextBlock(brand),
          "Real-estate content mix to rotate through: new listing announcements, just-sold announcements, open house promotions, market updates (only real figures provided — never invent statistics), neighborhood spotlights, home buying and selling tips, and client testimonials (only real ones provided).",
        ]
      : []),
  ];
}

/**
 * Builds the system prompt for filling a batch of scheduled slots. Each slot is
 * a { index, day, platform, contentType, angle } object (index is 1-based and
 * global across the whole calendar). The content type is FIXED per slot by the
 * controller's rotation — the AI writes copy for the type it is handed, which is
 * what guarantees no two consecutive posts share a type.
 */
function buildCalendarPrompt(brand, { businessType, theme, slots }) {
  const slotLines = slots.map(
    (s) =>
      `- Slot ${s.index}: day ${s.day} of 30, platform ${s.platform}, content type "${s.contentType}", angle: ${s.angle || "your choice"} (${PLATFORM_GUIDELINES[s.platform] || "write a clear on-brand post"})`
  );

  return [
    ...brandHeader(brand, businessType, theme),
    "",
    `Write EXACTLY ${slots.length} posts, one per slot below, in order:`,
    ...slotLines,
    "",
    "Rules:",
    "- Use the EXACT content type assigned to each slot — do not change it.",
    "- Every post must be completely unique — never reuse copy, hooks, angles, or CTAs, even across posts of the same type.",
    "- Use each slot's angle as a starting hook, then make it specific and on-brand.",
    "- Tailor each post natively to its platform and keep the brand voice throughout.",
    "",
    `Return ONLY a JSON array of ${slots.length} objects (no prose, no markdown fences), one per slot IN ORDER. Each object must have:`,
    '- "slot": the slot number (integer).',
    '- "contentType": the assigned content type (echo it back).',
    '- "postText": the ready-to-post copy, respecting the platform character limits.',
    '- "hashtags": an array of hashtag strings (without surrounding text; may be empty).',
    '- "visualIdea": a short image/video description (a thumbnail concept for YouTube).',
    '- "callToAction": the call-to-action for the post.',
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

// How many slots one AI call fills. A full month at 3×/day across several
// platforms is ~300 posts, which cannot fit in a single response's token budget,
// so the work is split into batches. Keep this small enough that each batch's
// JSON comfortably fits max_tokens.
const CALENDAR_BATCH_SIZE = 20;
// How many batch calls run at once. Bounded so we speed up big months without
// hammering the AI provider's rate limits.
const CALENDAR_BATCH_CONCURRENCY = 4;

/** Fills one batch of slots via a single AI call; returns aligned posts. */
async function generateCalendarBatch(brand, { businessType, theme, slots }) {
  const systemPrompt = buildCalendarPrompt(brand, { businessType, theme, slots });

  const response = await createMessage(
    {
      model: MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Write these ${slots.length} posts now. Respond with only the JSON array, one object per slot in order.`,
        },
      ],
    },
    { timeout: HEAVY_AI_TIMEOUT_MS, label: "content calendar batch" }
  );

  const text = response.content?.[0]?.text || "";
  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("The AI response did not contain any calendar posts");
  }

  // Align the AI output back to this batch's slots by order, validating each
  // post. The content type is taken from the slot (our rotation), NOT the AI, so
  // the "no two consecutive posts share a type" guarantee always holds.
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
      contentType: String(slot.contentType || CONTENT_TYPES[i % CONTENT_TYPES.length]),
      postText,
      hashtags,
      visualIdea: String(post.visualIdea || "").trim(),
      callToAction: String(post.callToAction || "").trim(),
      bestPostingTime: slot.time || normalizeTime(post.bestPostingTime, slot.platform),
    };
  });
}

/**
 * Generates content for every slot, batching large calendars across multiple AI
 * calls (bounded concurrency). Returns an array of validated post objects
 * aligned to the input slots (same order/length).
 */
async function generateCalendarPosts(brand, { businessType, theme, slots }) {
  // Split the slots into ordered batches.
  const batches = [];
  for (let i = 0; i < slots.length; i += CALENDAR_BATCH_SIZE) {
    batches.push(slots.slice(i, i + CALENDAR_BATCH_SIZE));
  }

  // Run batches with a bounded worker pool, keeping results in slot order.
  const batchResults = new Array(batches.length);
  let cursor = 0;
  async function worker() {
    while (cursor < batches.length) {
      const idx = cursor;
      cursor += 1;
      batchResults[idx] = await generateCalendarBatch(brand, {
        businessType,
        theme,
        slots: batches[idx],
      });
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(CALENDAR_BATCH_CONCURRENCY, batches.length); w += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return batchResults.flat();
}

/**
 * Regenerates a single post. Returns one validated post object.
 */
async function generateSingleCalendarPost(brand, opts) {
  const systemPrompt = buildSinglePostPrompt(brand, opts);

  const response = await createMessage({
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
  POSTING_WINDOWS,
  PLATFORM_SCHEDULES,
  ANGLE_SEEDS,
  DEFAULT_POSTING_TIMES,
  generateCalendarPosts,
  generateSingleCalendarPost,
  composePostContent,
  normalizeTime,
};
