/**
 * Autopilot weekly batch agent.
 *
 * Every Monday the autopilot engine gathers the brand's REAL intelligence
 * (profile, connected platforms, recent post performance, competitor ads +
 * latest report) and this agent drafts the whole week in one shot: the owner's
 * configured number of posts (each with a visual brief) plus fully drafted
 * Facebook test ads. Unlike the interactive voice flow it never asks
 * clarifying questions — autopilot is hands-off by design — but it still never
 * fabricates statistics, testimonials, offers, or events. When it lacks
 * specifics it writes evergreen brand-grounded content instead of inventing.
 *
 * Output is validated before returning. Upstream provider failures map to 502
 * at API surfaces; parse/shape failures are tagged `err.aiInvalid = true`.
 */

const { MODEL, createMessage, HEAVY_AI_TIMEOUT_MS } = require("../config/anthropic");
const { campaignContextBlock } = require("../utils/politicalContext");
const { realEstateContextBlock } = require("../utils/realEstateContext");
const { geoContextBlock } = require("../utils/geoTargeting");
const {
  PLATFORM_GUIDELINES,
  describeAudience,
  performanceLines,
  competitorLines,
  extractJsonObject,
} = require("./voiceContentPrompt");

function invalid(message) {
  const err = new Error(message);
  err.aiInvalid = true;
  return err;
}

function buildWeeklyBatchPrompt(brand, intel, { postsPerWeek, adsPerWeek }) {
  const name = brand.brand_name || "the brand";
  const personality = brand.brand_personality || "professional and approachable";
  const voice = brand.voice_description || "clear, friendly, and benefit-focused";
  const audience = describeAudience(brand.target_audience);
  const type = intel.businessType || brand.industry || "a small business";
  const platforms = intel.connectedPlatforms;

  return [
    "You are Echo, Zorecho's autopilot marketing strategist. The business owner",
    "has put you on a weekly cadence: you draft the entire week's content in one",
    "batch, they review it once by voice, and only approved items go out. You",
    "have studied their real data below. Draft ONLY from that data.",
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
    ...(brand._learningContext ? ["", brand._learningContext] : []),
    "",
    `Connected platforms you may draft posts for (ONLY these): ${platforms.join(", ")}`,
    "",
    "Recent post performance (real):",
    ...performanceLines(intel.recentPosts),
    "",
    ...competitorLines(intel.competitorAds, intel.competitorReport),
    "",
    `Draft exactly ${postsPerWeek} social post(s)` +
      (adsPerWeek > 0
        ? ` and ${adsPerWeek} Facebook test ad(s) for this week.`
        : " for this week (no ads this week)."),
    "",
    "Rules:",
    "- Never invent statistics, testimonials, discounts, events, or competitor claims.",
    "- No clarifying questions — you are on autopilot. When specifics are missing, write evergreen brand-grounded content.",
    "- Lean into what performed well before; counter competitor angles where the data shows an opening.",
    "- Spread the posts across the connected platforms and vary the angle (no two alike).",
    "- Tailor each post natively to its platform:",
    ...platforms.map((p) => `  - ${p}: ${PLATFORM_GUIDELINES[p] || "clear on-brand post"}`),
    ...(adsPerWeek > 0
      ? [
          "- Each ad is a TEST: a distinct angle worth measuring, with a headline (max 40 chars),",
          "  primary text (1-3 short paragraphs), and a one-sentence visual brief.",
          "- Do NOT set ad budgets — the owner's spending limits control that separately.",
        ]
      : []),
    "",
    "Return ONLY one JSON object (no prose, no markdown fences):",
    '{"posts": [{"platform": "...", "postText": "...", "hashtags": ["..."], "visualIdea": "one-sentence image brief", "callToAction": "...", "rationale": "one spoken-style sentence on why, citing the real data used", "bestPostingTime": "HH:MM"}],',
    ' "ads": [{"headline": "...", "primaryText": "...", "visualIdea": "one-sentence image brief", "rationale": "one spoken-style sentence on why this test, citing the real data used"}]}',
  ].join("\n");
}

/**
 * Drafts one week's batch: exactly `postsPerWeek` posts + `adsPerWeek` ads,
 * fully validated. Throws `err.aiInvalid` on bad shape (mapped upstream).
 */
async function generateWeeklyBatch(brand, intel, { postsPerWeek, adsPerWeek }) {
  const systemPrompt = buildWeeklyBatchPrompt(brand, intel, { postsPerWeek, adsPerWeek });

  const response = await createMessage(
    {
      model: MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: "Draft the week's batch now. Respond with only the JSON object.",
        },
      ],
    },
    { timeout: HEAVY_AI_TIMEOUT_MS, label: "autopilot weekly batch" }
  );

  const text = response.content?.[0]?.text || "";
  const parsed = extractJsonObject(text);

  if (!Array.isArray(parsed.posts) || parsed.posts.length === 0) {
    throw invalid("The AI batch contained no posts");
  }

  const allowed = new Set(intel.connectedPlatforms);
  const posts = parsed.posts.slice(0, postsPerWeek).map((post, i) => {
    const platform = String(post.platform || "").toLowerCase();
    if (!allowed.has(platform)) {
      throw invalid(`The AI drafted for an unconnected platform: ${platform || "(none)"}`);
    }
    const postText = String(post.postText || "").trim();
    if (!postText) throw invalid(`The AI batch was missing copy for post ${i + 1}`);
    const visualIdea = String(post.visualIdea || "").trim();
    if (!visualIdea) throw invalid(`The AI batch was missing a visual brief for post ${i + 1}`);
    return {
      platform,
      postText,
      hashtags: Array.isArray(post.hashtags)
        ? post.hashtags.map((h) => String(h).trim()).filter(Boolean)
        : [],
      visualIdea,
      callToAction: String(post.callToAction || "").trim(),
      rationale: String(post.rationale || "").trim(),
      bestPostingTime: String(post.bestPostingTime || "").trim(),
    };
  });

  let ads = [];
  if (adsPerWeek > 0) {
    if (!Array.isArray(parsed.ads) || parsed.ads.length === 0) {
      throw invalid("The AI batch contained no ads despite the ad cadence");
    }
    ads = parsed.ads.slice(0, adsPerWeek).map((ad, i) => {
      const headline = String(ad.headline || "").trim();
      const primaryText = String(ad.primaryText || "").trim();
      if (!headline || !primaryText) {
        throw invalid(`The AI batch was missing headline or text for ad ${i + 1}`);
      }
      return {
        headline: headline.slice(0, 60),
        primaryText,
        visualIdea: String(ad.visualIdea || "").trim(),
        rationale: String(ad.rationale || "").trim(),
      };
    });
  }

  return { posts, ads };
}

/**
 * Rewrites ONE ad draft following the owner's spoken instruction. Returns a
 * validated { headline, primaryText }.
 */
async function reviseAdDraft(brand, item, instruction) {
  const systemPrompt = [
    "You are Echo, Zorecho's autopilot marketing strategist. The business owner",
    "reviewed a drafted Facebook test ad BY VOICE and asked for a change.",
    "",
    `Brand: ${brand.brand_name || "the brand"} — voice: ${brand.voice_description || "clear, friendly, benefit-focused"}`,
    "",
    "Current ad:",
    `Headline: ${item.ad_headline || ""}`,
    `Primary text: ${item.post_content || ""}`,
    "",
    `Owner's spoken instruction: "${instruction}"`,
    "",
    "Rewrite the ad applying the instruction while keeping it on-brand.",
    "Never invent statistics, testimonials, discounts, or events the owner did not mention.",
    "",
    "Return ONLY one JSON object (no prose, no markdown fences):",
    '{"headline": "max 40 chars", "primaryText": "..."}',
  ].join("\n");

  const response = await createMessage({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      { role: "user", content: "Rewrite the ad now. Respond with only the JSON object." },
    ],
  });

  const text = response.content?.[0]?.text || "";
  const parsed = extractJsonObject(text);
  const headline = String(parsed.headline || "").trim();
  const primaryText = String(parsed.primaryText || "").trim();
  if (!headline || !primaryText) throw invalid("The AI ad revision was incomplete");
  return { headline: headline.slice(0, 60), primaryText };
}

module.exports = { buildWeeklyBatchPrompt, generateWeeklyBatch, reviseAdDraft };
