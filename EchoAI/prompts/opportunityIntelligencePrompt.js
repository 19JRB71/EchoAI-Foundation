/**
 * Scout — Opportunity Intelligence agent.
 *
 * generateOpportunityIntelligence(brand, profile) produces one business's weekly
 * opportunity briefing: ranked business opportunities, competitor weaknesses to
 * exploit (negative reviews, pricing changes, service complaints), market trends,
 * partnership opportunities, and trending topics the business could capitalize
 * on. Everything is ranked by potential impact × probability of success.
 *
 * Grounded in the business profile + any competitor intelligence provided.
 * Output is validated before persistence; bad output throws `err.aiInvalid`.
 */

const { createMessage, MODEL, DEFAULT_AI_TIMEOUT_MS } = require("../config/anthropic");
const { sageBlock } = require("../utils/sageContext");

const LEVELS = new Set(["high", "medium", "low"]);
const DIRECTIONS = new Set(["up", "down", "flat"]);

function level(v, dflt = "medium") {
  const s = String(v || "").toLowerCase();
  return LEVELS.has(s) ? s : dflt;
}

function clampPriority(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 50;
  return Math.max(1, Math.min(100, v));
}

function buildOpportunityPrompt(brand, profile) {
  const name = brand.brand_name || "the business";
  return [
    "You are Zorecho's Scout — an opportunity intelligence analyst who finds ways for a small business to grow and win customers.",
    "Given ONE business's profile (and any competitor intelligence provided), produce this week's opportunity briefing.",
    "Be honest and specific; ground everything in the profile. Where the data is thin, say so and suggest how to gather more rather than inventing facts.",
    "",
    `BUSINESS: ${name}`,
    brand.brand_personality ? `Brand personality: ${brand.brand_personality}` : "",
    sageBlock(brand._sageContext),
    "",
    "BUSINESS PROFILE (real data, JSON):",
    "```json",
    JSON.stringify(profile, null, 2),
    "```",
    "",
    "Return ONLY a JSON object (no markdown fences, no prose outside the JSON) with EXACTLY this shape:",
    "{",
    '  "summary": "<3-5 sentence executive read of this week\'s biggest opportunities>",',
    '  "opportunities": [',
    '    { "title": "<the opportunity>", "detail": "<what it is and why it matters now>", "type": "<market|content|partnership|competitor|pricing|other>", "impact": "high|medium|low", "probability": "high|medium|low", "priorityScore": <integer 1-100 = impact x probability>, "action": "<the concrete first move the owner should make>" }',
    "    // 3-6 opportunities, highest priorityScore first",
    "  ],",
    '  "competitorWeaknesses": [',
    '    { "competitor": "<name or \'a local competitor\'>", "weakness": "<negative reviews, a price hike, service complaints, etc.>", "howToCapitalize": "<how this business can win those customers>" }',
    "  ],",
    '  "marketTrends": [',
    '    { "trend": "<the trend>", "detail": "<what the data/context shows>", "direction": "up|down|flat" }',
    "  ],",
    '  "partnerships": [',
    '    { "partner": "<type of partner or a concrete example>", "rationale": "<why this partnership would help>" }',
    "  ],",
    '  "trendingTopics": [',
    '    { "topic": "<trending topic the business could ride>", "angle": "<how to use it in marketing/content>" }',
    "  ]",
    "}",
    "",
    "Rules: 3-6 opportunities ranked by priorityScore (1-100); impact & probability are high/medium/low; the other four arrays each have 1-4 entries; ground everything in the profile. Output valid JSON only.",
  ]
    .filter(Boolean)
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

/** Validates + normalizes the AI opportunity briefing. Throws err.aiInvalid on bad data. */
function validateOpportunity(parsed) {
  const fail = (msg) => {
    const err = new Error(`AI opportunity output invalid: ${msg}`);
    err.aiInvalid = true;
    throw err;
  };

  if (!parsed || typeof parsed !== "object") fail("not an object");
  if (typeof parsed.summary !== "string" || !parsed.summary.trim()) fail("missing summary");
  if (!Array.isArray(parsed.opportunities) || parsed.opportunities.length < 1) {
    fail("opportunities must be a non-empty array");
  }

  const opportunities = parsed.opportunities
    .map((o) => {
      if (!o || typeof o !== "object") return null;
      const title = String(o.title || "").trim();
      const detail = String(o.detail || "").trim();
      if (!title || !detail) return null;
      return {
        title,
        detail,
        type: String(o.type || "other").trim().toLowerCase() || "other",
        impact: level(o.impact),
        probability: level(o.probability),
        priorityScore: clampPriority(o.priorityScore),
        action: String(o.action || "").trim(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.priorityScore - a.priorityScore);

  if (opportunities.length === 0) fail("no valid opportunities after validation");

  const competitorWeaknesses = (Array.isArray(parsed.competitorWeaknesses) ? parsed.competitorWeaknesses : [])
    .map((c) => (c && typeof c === "object"
      ? {
          competitor: String(c.competitor || "").trim(),
          weakness: String(c.weakness || "").trim(),
          howToCapitalize: String(c.howToCapitalize || "").trim(),
        }
      : null))
    .filter((c) => c && c.weakness);

  const marketTrends = (Array.isArray(parsed.marketTrends) ? parsed.marketTrends : [])
    .map((t) => (t && typeof t === "object"
      ? {
          trend: String(t.trend || "").trim(),
          detail: String(t.detail || "").trim(),
          direction: DIRECTIONS.has(String(t.direction || "").toLowerCase())
            ? String(t.direction).toLowerCase()
            : "flat",
        }
      : null))
    .filter((t) => t && t.trend);

  const partnerships = (Array.isArray(parsed.partnerships) ? parsed.partnerships : [])
    .map((p) => (p && typeof p === "object"
      ? { partner: String(p.partner || "").trim(), rationale: String(p.rationale || "").trim() }
      : null))
    .filter((p) => p && p.partner);

  const trendingTopics = (Array.isArray(parsed.trendingTopics) ? parsed.trendingTopics : [])
    .map((t) => (t && typeof t === "object"
      ? { topic: String(t.topic || "").trim(), angle: String(t.angle || "").trim() }
      : null))
    .filter((t) => t && t.topic);

  return {
    summary: parsed.summary.trim(),
    opportunities,
    competitorWeaknesses,
    marketTrends,
    partnerships,
    trendingTopics,
  };
}

async function generateOpportunityIntelligence(brand, profile) {
  const system = buildOpportunityPrompt(brand, profile);

  const response = await createMessage(
    {
      model: MODEL,
      max_tokens: 3500,
      system,
      messages: [
        {
          role: "user",
          content: `Produce this week's opportunity briefing for ${brand.brand_name || "this business"} now. JSON only.`,
        },
      ],
    },
    { timeout: DEFAULT_AI_TIMEOUT_MS, label: "Opportunity intelligence" },
  );

  const text = response.content?.[0]?.text || "";
  if (!text.trim()) {
    const err = new Error("The AI returned an empty opportunity briefing");
    err.aiInvalid = true;
    throw err;
  }

  let parsed;
  try {
    parsed = parseJsonObject(text);
  } catch {
    const err = new Error("The AI opportunity output was not valid JSON");
    err.aiInvalid = true;
    throw err;
  }

  return validateOpportunity(parsed);
}

module.exports = {
  buildOpportunityPrompt,
  validateOpportunity,
  generateOpportunityIntelligence,
};
