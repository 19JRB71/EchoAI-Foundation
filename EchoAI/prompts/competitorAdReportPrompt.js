/**
 * Competitor Ad Spy — Claude writers.
 *
 * Two deliverables, both grounded ONLY in the real competitor ads Scout pulled
 * from the Facebook Ad Library (no fabricated ads, audiences, or metrics):
 *
 *  1. generateAdReport(brand, ads) — the weekly competitor ad-intelligence
 *     report: an executive summary, the top-performing competitor ads (with WHY),
 *     the gaps/opportunities they leave open, and EXACTLY three concrete
 *     recommendations. Output is validated; bad output throws `err.aiInvalid`
 *     (the controller maps that to 502 — never mocked).
 *
 *  2. draftCounterCampaign(brand, ad) — an on-brand counter ad package the owner
 *     can launch to beat one specific competitor ad.
 *
 * Architecture split (see replit.md): Hermes decides (which ads are threats);
 * Claude writes here.
 */

const { createMessage, MODEL, DEFAULT_AI_TIMEOUT_MS } = require("../config/anthropic");

function aiInvalid(msg) {
  const err = new Error(`AI competitor ad output invalid: ${msg}`);
  err.aiInvalid = true;
  throw err;
}

/** Compact each real ad into a prompt line (deterministic, real data only). */
function adBlock(ads) {
  return ads
    .map((a, i) => {
      const parts = [`${i + 1}. Competitor: ${a.competitor_name || a.page_name || "unknown"}`];
      if (a.headline) parts.push(`headline: "${String(a.headline).slice(0, 160)}"`);
      if (a.body_text)
        parts.push(`copy: "${String(a.body_text).replace(/\s+/g, " ").slice(0, 400)}"`);
      if (a.cta_text) parts.push(`link caption: "${String(a.cta_text).slice(0, 120)}"`);
      if (Array.isArray(a.platforms) && a.platforms.length)
        parts.push(`platforms: ${a.platforms.join("/")}`);
      if (a.delivery_start) {
        const start = new Date(a.delivery_start);
        if (!Number.isNaN(start.getTime())) {
          const days = Math.max(0, Math.round((Date.now() - start.getTime()) / 86400000));
          parts.push(`running ${days} day(s) (since ${String(a.delivery_start).slice(0, 10)})`);
        }
      }
      if (a.threat_level && a.threat_level !== "none")
        parts.push(`Scout threat read: ${a.threat_level}`);
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");
}

function parseJsonObject(text) {
  let cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("unparseable");
  }
}

function buildReportSystem(brand, ads) {
  const name = brand.brand_name || "the business";
  return [
    "You are EchoAI's Scout — a competitive-ad intelligence analyst for a small business.",
    "You are given the REAL competitor ads Scout pulled from the Facebook Ad Library for this business's confirmed competitor watch list.",
    "Produce this week's competitor ad intelligence report. Ground EVERYTHING in the ads provided — do NOT invent ads, audiences, spend, or performance numbers. The Ad Library does not expose reach/spend for commercial ads, so judge 'top performing' by longevity (how long an ad has been running is the strongest public signal that it works) and by the strength/clarity of its offer and angle. Where evidence is thin, say so.",
    "",
    `BUSINESS: ${name}`,
    brand.brand_personality ? `Brand personality: ${String(brand.brand_personality).slice(0, 300)}` : "",
    brand.industry ? `Industry: ${String(brand.industry).slice(0, 120)}` : "",
    "",
    "REAL COMPETITOR ADS (from the Facebook Ad Library):",
    adBlock(ads),
    "",
    "Return ONLY a JSON object (no markdown fences, no prose outside the JSON) with EXACTLY this shape:",
    "{",
    '  "summary": "<3-5 sentence executive read of what competitors are doing in ads right now>",',
    '  "topAds": [ { "competitor": "<name>", "headline": "<the ad angle/headline>", "whyWorking": "<why this ad is likely working — longevity, offer strength, clarity>" } ],',
    '  "gaps": [ { "gap": "<an angle/offer/audience competitors are NOT covering>", "opportunity": "<how this business can own it>" } ],',
    '  "recommendations": [ { "title": "<the move>", "detail": "<the concrete action the owner should take this week>" } ]',
    "}",
    "",
    "Rules: topAds = 1-5 entries (highest-longevity/strongest first); gaps = 1-4 entries; recommendations = EXACTLY 3 concrete, specific actions. Output valid JSON only.",
  ]
    .filter(Boolean)
    .join("\n");
}

function validateReport(parsed) {
  if (!parsed || typeof parsed !== "object") aiInvalid("not an object");
  if (typeof parsed.summary !== "string" || !parsed.summary.trim())
    aiInvalid("missing summary");

  const topAds = (Array.isArray(parsed.topAds) ? parsed.topAds : [])
    .map((a) =>
      a && typeof a === "object"
        ? {
            competitor: String(a.competitor || "").trim(),
            headline: String(a.headline || "").trim(),
            whyWorking: String(a.whyWorking || "").trim(),
          }
        : null,
    )
    .filter((a) => a && (a.headline || a.competitor));

  const gaps = (Array.isArray(parsed.gaps) ? parsed.gaps : [])
    .map((g) =>
      g && typeof g === "object"
        ? { gap: String(g.gap || "").trim(), opportunity: String(g.opportunity || "").trim() }
        : null,
    )
    .filter((g) => g && g.gap);

  const recommendations = (Array.isArray(parsed.recommendations) ? parsed.recommendations : [])
    .map((r) =>
      r && typeof r === "object"
        ? { title: String(r.title || "").trim(), detail: String(r.detail || "").trim() }
        : null,
    )
    .filter((r) => r && (r.title || r.detail));

  if (recommendations.length === 0) aiInvalid("no valid recommendations");

  return {
    summary: parsed.summary.trim(),
    topAds,
    gaps,
    recommendations: recommendations.slice(0, 3),
  };
}

/**
 * Generate the weekly competitor ad intelligence report from REAL ads.
 * @param {object} brand
 * @param {Array}  ads   competitor_ads rows (real data only)
 */
async function generateAdReport(brand, ads) {
  if (!Array.isArray(ads) || ads.length === 0) {
    aiInvalid("no competitor ads to analyze");
  }
  const system = buildReportSystem(brand, ads);
  const response = await createMessage(
    {
      model: MODEL,
      max_tokens: 2500,
      system,
      messages: [
        {
          role: "user",
          content: `Produce this week's competitor ad intelligence report for ${brand.brand_name || "this business"} now. JSON only.`,
        },
      ],
    },
    { timeout: DEFAULT_AI_TIMEOUT_MS, label: "Competitor ad report" },
  );

  const text = response.content?.[0]?.text || "";
  if (!text.trim()) aiInvalid("empty report");
  let parsed;
  try {
    parsed = parseJsonObject(text);
  } catch {
    aiInvalid("not valid JSON");
  }
  return validateReport(parsed);
}

function buildCounterSystem(brand) {
  const name = brand.brand_name || "the business";
  return [
    "You are EchoAI's Forge — an ad-creative writer for a small business.",
    "The owner wants to counter ONE specific competitor ad with a stronger, on-brand ad of their own.",
    "Write a single counter ad package that beats the competitor's angle honestly — do NOT make false claims, disparage the competitor by name, or invent guarantees the business has not stated. Play to THIS business's strengths.",
    "",
    `BUSINESS: ${name}`,
    brand.brand_personality ? `Brand personality: ${String(brand.brand_personality).slice(0, 300)}` : "",
    brand.voice_description ? `Brand voice: ${String(brand.voice_description).slice(0, 300)}` : "",
    "",
    "Return ONLY a JSON object (no markdown fences) with EXACTLY this shape:",
    "{",
    '  "angle": "<the counter-strategy in one line>",',
    '  "headline": "<the ad headline>",',
    '  "primaryText": "<the ad primary text / body>",',
    '  "cta": "<a short call to action>",',
    '  "rationale": "<why this beats the competitor ad>"',
    "}",
    "Output valid JSON only.",
  ]
    .filter(Boolean)
    .join("\n");
}

function validateCounter(parsed) {
  if (!parsed || typeof parsed !== "object") aiInvalid("counter: not an object");
  const headline = String(parsed.headline || "").trim();
  const primaryText = String(parsed.primaryText || "").trim();
  if (!headline || !primaryText) aiInvalid("counter: missing headline or primary text");
  return {
    angle: String(parsed.angle || "").trim(),
    headline,
    primaryText,
    cta: String(parsed.cta || "").trim(),
    rationale: String(parsed.rationale || "").trim(),
  };
}

/**
 * Draft an on-brand counter ad package targeting one competitor ad.
 * @param {object} brand
 * @param {object} ad     a competitor_ads row
 */
async function draftCounterCampaign(brand, ad) {
  const system = buildCounterSystem(brand);
  const target = [
    `Competitor: ${ad.competitor_name || ad.page_name || "a competitor"}`,
    ad.headline ? `Their headline: "${String(ad.headline).slice(0, 200)}"` : "",
    ad.body_text ? `Their copy: "${String(ad.body_text).replace(/\s+/g, " ").slice(0, 500)}"` : "",
    ad.cta_text ? `Their link caption: "${String(ad.cta_text).slice(0, 160)}"` : "",
    "",
    "Write the counter ad package now. JSON only.",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await createMessage(
    {
      model: MODEL,
      max_tokens: 1200,
      system,
      messages: [{ role: "user", content: target }],
    },
    { timeout: DEFAULT_AI_TIMEOUT_MS, label: "Competitor counter campaign" },
  );

  const text = response.content?.[0]?.text || "";
  if (!text.trim()) aiInvalid("counter: empty output");
  let parsed;
  try {
    parsed = parseJsonObject(text);
  } catch {
    aiInvalid("counter: not valid JSON");
  }
  return validateCounter(parsed);
}

module.exports = {
  generateAdReport,
  draftCounterCampaign,
  validateReport,
  validateCounter,
  buildReportSystem,
};
