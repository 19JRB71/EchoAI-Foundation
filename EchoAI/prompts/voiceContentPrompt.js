/**
 * Voice-driven content creation agent ("Hey Echo, let's create some content").
 *
 * Unlike the Content Calendar (which asks the owner a guided interview first),
 * this agent is HANDS-OFF: the controller gathers the brand's real intelligence
 * — profile, connected platforms, recent post performance, competitor ads and
 * the latest competitor report — and the agent drafts a small batch of posts
 * grounded in that data. When critical information is genuinely missing it
 * returns clarifying QUESTIONS instead of guessing (Echo asks them out loud);
 * it never fabricates statistics, testimonials, offers, or events.
 *
 * Output is validated before returning. Upstream provider failures map to 502
 * in the controller; parse/shape failures are tagged `err.aiInvalid = true`.
 */

const { MODEL, createMessage, HEAVY_AI_TIMEOUT_MS } = require("../config/anthropic");
const { campaignContextBlock } = require("../utils/politicalContext");
const { realEstateContextBlock } = require("../utils/realEstateContext");
const { geoContextBlock } = require("../utils/geoTargeting");

// How many posts one voice session drafts. Small on purpose: the owner reviews
// each one out loud, so a session should take a couple of minutes, not an hour.
const MIN_DRAFTS = 3;
const MAX_DRAFTS = 5;
// At most this many clarifying questions — Echo asks them by voice one at a
// time, so more than 3 would feel like an interrogation.
const MAX_QUESTIONS = 3;

// Short, platform-native guidance (mirrors the Content Calendar's).
const PLATFORM_GUIDELINES = {
  facebook:
    "Conversational, community-oriented, 1-2 short paragraphs, 1-2 hashtags.",
  instagram:
    "Visual-first punchy caption with line breaks and tasteful emojis, 8-15 mixed-reach hashtags.",
  tiktok: "Strong first-line hook, short trend-aware caption, 3-5 trending hashtags.",
  linkedin:
    "Professional, insightful, value-led, 1-3 short paragraphs, <=3 focused hashtags.",
  twitter:
    "Short and punchy, the post text must stay within 280 characters, 1-2 hashtags.",
  youtube:
    "A compelling video title plus a keyword-rich description and a thumbnail concept.",
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

/** One compact line per recent post so the model sees REAL performance. */
function performanceLines(recentPosts) {
  if (!Array.isArray(recentPosts) || recentPosts.length === 0) {
    return [
      "- No published posts with performance data yet (a new account — do not invent any past results).",
    ];
  }
  return recentPosts.slice(0, 12).map((p) => {
    const m = p.metrics || {};
    const stats = [
      Number.isFinite(Number(m.likes)) ? `${m.likes} likes` : null,
      Number.isFinite(Number(m.comments)) ? `${m.comments} comments` : null,
      Number.isFinite(Number(m.shares)) ? `${m.shares} shares` : null,
    ]
      .filter(Boolean)
      .join(", ");
    const excerpt = String(p.content || "").replace(/\s+/g, " ").slice(0, 140);
    return `- [${p.platform}] "${excerpt}"${stats ? ` — ${stats}` : " — no engagement data"}`;
  });
}

/** Competitor intelligence lines (only real scanned data; may be empty). */
function competitorLines(competitorAds, competitorReport) {
  const lines = [];
  if (Array.isArray(competitorAds) && competitorAds.length > 0) {
    lines.push("Competitors' live Facebook ads (real, scanned from the Ad Library):");
    for (const ad of competitorAds.slice(0, 8)) {
      const bits = [ad.headline, ad.bodyText]
        .filter(Boolean)
        .join(" — ")
        .replace(/\s+/g, " ")
        .slice(0, 160);
      lines.push(
        `- ${ad.competitorName}${ad.threatLevel ? ` (threat: ${ad.threatLevel})` : ""}: ${bits || "(no text captured)"}`
      );
    }
  }
  if (competitorReport) {
    if (competitorReport.summary) {
      lines.push(`Latest competitor intelligence summary: ${competitorReport.summary}`);
    }
    const gaps = Array.isArray(competitorReport.gaps) ? competitorReport.gaps : [];
    if (gaps.length > 0) {
      lines.push(
        `Content gaps competitors are missing (openings for us): ${gaps
          .map((g) => (typeof g === "string" ? g : g.gap || g.description || ""))
          .filter(Boolean)
          .slice(0, 5)
          .join("; ")}`
      );
    }
  }
  if (lines.length === 0) {
    lines.push(
      "No competitor data is available for this brand — draft from the brand's own profile and performance only (never invent competitor claims)."
    );
  }
  return lines;
}

function buildVoiceDraftPrompt(brand, intel, { requestText, answers }) {
  const name = brand.brand_name || "the brand";
  const personality = brand.brand_personality || "professional and approachable";
  const voice = brand.voice_description || "clear, friendly, and benefit-focused";
  const audience = describeAudience(brand.target_audience);
  const type = intel.businessType || brand.industry || "a small business";
  const platforms = intel.connectedPlatforms;

  const answeredLines =
    Array.isArray(answers) && answers.length > 0
      ? [
          "",
          "The owner answered your clarifying questions (use these, do not re-ask):",
          ...answers.map((a) => `- Q: ${a.question} A: ${a.answer}`),
        ]
      : [];

  return [
    "You are Echo, EchoAI's hands-free content strategist. The business owner just",
    "asked you BY VOICE to create social media content. You have studied their real",
    "data below. Draft posts grounded ONLY in that data.",
    "",
    "Brand profile:",
    `- Name: ${name}`,
    `- Business type: ${type}`,
    `- Personality: ${personality}`,
    `- Voice: ${voice}`,
    `- Target audience: ${audience}`,
    ...(campaignContextBlock(brand) ? ["", campaignContextBlock(brand)] : []),
    ...(realEstateContextBlock(brand) ? ["", realEstateContextBlock(brand)] : []),
    ...(geoContextBlock(brand) ? ["", geoContextBlock(brand)] : []),
    "",
    `Connected platforms you may draft for (ONLY these): ${platforms.join(", ")}`,
    "",
    "Recent post performance (real):",
    ...performanceLines(intel.recentPosts),
    "",
    ...competitorLines(intel.competitorAds, intel.competitorReport),
    "",
    `What the owner said: "${requestText || "let's create some content"}"`,
    ...answeredLines,
    "",
    "Decide:",
    `1. If you have enough to draft confidently, return ${MIN_DRAFTS}-${MAX_DRAFTS} posts.`,
    `2. If something CRITICAL is missing or ambiguous (e.g. the owner mentioned a promotion but gave no details), return up to ${MAX_QUESTIONS} short spoken-style clarifying questions INSTEAD of posts. Only ask what you truly cannot infer — the owner wants this hands-off.`,
    "",
    "Rules:",
    "- Never invent statistics, testimonials, discounts, events, or competitor claims.",
    "- Lean into what performed well before; counter competitor angles where the data shows an opening.",
    "- Vary the angle across posts (no two posts alike).",
    "- Tailor each post natively to its platform:",
    ...platforms.map((p) => `  - ${p}: ${PLATFORM_GUIDELINES[p] || "clear on-brand post"}`),
    "",
    "Return ONLY one JSON object (no prose, no markdown fences), either:",
    '{"questions": ["...", ...]}',
    "or:",
    '{"posts": [{"platform": "...", "postText": "...", "hashtags": ["..."], "visualIdea": "one-sentence image brief", "callToAction": "...", "rationale": "one spoken-style sentence on why this post, citing the real data you used", "bestPostingTime": "HH:MM"}]}',
  ].join("\n");
}

/** Extracts a single JSON object from an LLM response. */
function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    const err = new Error("Could not parse the content drafts from the AI response");
    err.aiInvalid = true;
    throw err;
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (parseErr) {
    const err = new Error("The AI response was not valid JSON");
    err.aiInvalid = true;
    throw err;
  }
}

function invalid(message) {
  const err = new Error(message);
  err.aiInvalid = true;
  return err;
}

/**
 * Drafts posts (or clarifying questions) for a voice session.
 * Returns { questions: [...] } XOR { posts: [...] }, fully validated.
 */
async function generateVoiceDrafts(brand, intel, { requestText, answers } = {}) {
  const systemPrompt = buildVoiceDraftPrompt(brand, intel, { requestText, answers });

  const response = await createMessage(
    {
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content:
            "Draft the content now (or ask your clarifying questions). Respond with only the JSON object.",
        },
      ],
    },
    { timeout: HEAVY_AI_TIMEOUT_MS, label: "voice content drafts" }
  );

  const text = response.content?.[0]?.text || "";
  const parsed = extractJsonObject(text);

  if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
    const questions = parsed.questions
      .map((q) => String(q || "").trim())
      .filter(Boolean)
      .slice(0, MAX_QUESTIONS);
    if (questions.length === 0) throw invalid("The AI returned empty questions");
    return { questions };
  }

  if (!Array.isArray(parsed.posts) || parsed.posts.length === 0) {
    throw invalid("The AI response contained neither posts nor questions");
  }

  const allowed = new Set(intel.connectedPlatforms);
  const posts = parsed.posts.slice(0, MAX_DRAFTS).map((post, i) => {
    const platform = String(post.platform || "").toLowerCase();
    if (!allowed.has(platform)) {
      throw invalid(`The AI drafted for an unconnected platform: ${platform || "(none)"}`);
    }
    const postText = String(post.postText || "").trim();
    if (!postText) throw invalid(`The AI response was missing copy for post ${i + 1}`);
    const visualIdea = String(post.visualIdea || "").trim();
    if (!visualIdea) throw invalid(`The AI response was missing a visual brief for post ${i + 1}`);
    const hashtags = Array.isArray(post.hashtags)
      ? post.hashtags.map((h) => String(h).trim()).filter(Boolean)
      : [];
    return {
      platform,
      postText,
      hashtags,
      visualIdea,
      callToAction: String(post.callToAction || "").trim(),
      rationale: String(post.rationale || "").trim(),
      bestPostingTime: String(post.bestPostingTime || "").trim(),
    };
  });

  return { posts };
}

/**
 * Rewrites ONE draft's copy following the owner's spoken instruction
 * (e.g. "make it shorter", "mention the weekend special"). Returns a
 * validated { postText, hashtags, callToAction }.
 */
async function reviseVoiceDraft(brand, draft, instruction) {
  const systemPrompt = [
    "You are Echo, EchoAI's hands-free content strategist. The business owner",
    "reviewed a drafted social post BY VOICE and asked for a change.",
    "",
    `Brand: ${brand.brand_name || "the brand"} — voice: ${brand.voice_description || "clear, friendly, benefit-focused"}`,
    `Platform: ${draft.platform} (${PLATFORM_GUIDELINES[draft.platform] || "clear on-brand post"})`,
    "",
    "Current post:",
    draft.post_content,
    "",
    `Owner's spoken instruction: "${instruction}"`,
    "",
    "Rewrite the post applying the instruction while keeping it on-brand and",
    "platform-native. Never invent statistics, testimonials, discounts, or events",
    "the owner did not mention.",
    "",
    "Return ONLY one JSON object (no prose, no markdown fences):",
    '{"postText": "...", "hashtags": ["..."], "callToAction": "..."}',
  ].join("\n");

  const response = await createMessage({
    model: MODEL,
    max_tokens: 1536,
    system: systemPrompt,
    messages: [
      { role: "user", content: "Rewrite the post now. Respond with only the JSON object." },
    ],
  });

  const text = response.content?.[0]?.text || "";
  const parsed = extractJsonObject(text);
  const postText = String(parsed.postText || "").trim();
  if (!postText) throw invalid("The AI revision did not contain post copy");
  const hashtags = Array.isArray(parsed.hashtags)
    ? parsed.hashtags.map((h) => String(h).trim()).filter(Boolean)
    : [];
  return {
    postText,
    hashtags,
    callToAction: String(parsed.callToAction || "").trim(),
  };
}

module.exports = {
  MIN_DRAFTS,
  MAX_DRAFTS,
  MAX_QUESTIONS,
  buildVoiceDraftPrompt,
  generateVoiceDrafts,
  reviseVoiceDraft,
};
