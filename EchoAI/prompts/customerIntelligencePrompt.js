/**
 * AI Customer Intelligence Agent — the "brain" of Zorecho.
 *
 * generateIntelligence(brand, profile) takes a complete, cross-channel
 * intelligence profile for ONE business (every metric pulled from every channel,
 * plus last week's intelligence for continuity) and synthesizes a growing
 * strategic intelligence document that gets smarter every week:
 *   - trajectoryScore (1-10): is this business trending up or down overall?
 *   - analysis: a plain-language strategic brief for the owner.
 *   - recommendations[5]: the highest-impact moves, ranked, each grounded in the
 *     brand's REAL data (title, explanation, impact, effort, expectedOutcome).
 *   - trends[]: the most important patterns detected in the data.
 *   - insights: a synthesized profile (ideal customer, content angles, channel
 *     mix, follow-up timing, competitive positioning, seasonal trends).
 *
 * Everything is grounded ONLY in the real numbers passed in. Output is validated
 * before persistence; empty/malformed output throws `err.aiInvalid = true` so the
 * controller maps it to 502 (never a mock, never placeholder strategy).
 */

const { anthropic, MODEL } = require("../config/anthropic");

const IMPACT_VALUES = new Set(["high", "medium", "low"]);
const EFFORT_VALUES = new Set(["low", "medium", "high"]);

function buildIntelligencePrompt(brand, profile) {
  const name = brand.brand_name || "the business";
  const prior = profile.previous
    ? `Last week's trajectory score was ${profile.previous.trajectoryScore}/10. Last week's top recommendations were:\n${(profile.previous.recommendations || [])
        .map((r, i) => `  ${i + 1}. ${r.title}`)
        .join("\n")}\nBuild on this — note what has improved or regressed, and avoid simply repeating advice that was already given unless it remains the single most important move.`
    : "This is the FIRST intelligence brief for this business — establish a baseline read.";

  return [
    "You are Zorecho's Customer Intelligence Agent — the strategic brain that studies one business's entire marketing operation and tells the owner exactly what to do next.",
    "You think like a seasoned CMO + data analyst. You are honest, specific, and grounded ONLY in the real data provided. Never invent numbers. When data is thin, say so and recommend how to gather more.",
    "",
    `BUSINESS: ${name}`,
    brand.target_audience ? `Stated target audience: ${brand.target_audience}` : "",
    brand.brand_personality ? `Brand personality: ${brand.brand_personality}` : "",
    "",
    "COMPLETE CROSS-CHANNEL INTELLIGENCE PROFILE (real data, JSON):",
    "```json",
    JSON.stringify(profile.metrics, null, 2),
    "```",
    "",
    "CONTINUITY:",
    prior,
    "",
    "Synthesize ALL of the above into a single strategic intelligence document. Respond with ONLY a JSON object (no markdown fences, no prose outside the JSON) with EXACTLY this shape:",
    "{",
    '  "trajectoryScore": <integer 1-10, where 10 = thriving and accelerating, 1 = struggling and declining; weigh lead volume & quality, conversion rate, ROI, channel momentum, and feedback sentiment>,',
    '  "analysis": "<3-5 sentence executive brief: the single most important takeaway about where this business stands and where it is heading, in plain English>",',
    '  "recommendations": [',
    '    { "title": "<short action title>", "explanation": "<one paragraph grounded in THIS brand\'s specific numbers — cite the real figures that justify it>", "impact": "high|medium|low", "effort": "low|medium|high", "expectedOutcome": "<the concrete result the owner should expect>" }',
    "    // EXACTLY 5 recommendations, ordered most-impactful first",
    "  ],",
    '  "trends": [',
    '    { "label": "<the pattern, e.g. \'Hot-lead share rising\'>", "direction": "up|down|flat", "detail": "<what the data shows and why it matters>" }',
    "    // 3-6 of the most important detected patterns",
    "  ],",
    '  "insights": {',
    '    "idealCustomerProfile": "<who actually converts, inferred from real lead/conversion patterns>",',
    '    "bestContentAngles": "<the content/messaging angles that perform best, from social/email/ad data>",',
    '    "optimalChannelMix": "<where to spend time and money, from per-channel results>",',
    '    "followUpTiming": "<follow-up cadence/timing insights from sequence & call/SMS data>",',
    '    "competitivePositioning": "<how to position vs competitors, from competitor intelligence + brand data>",',
    '    "seasonalTrends": "<any seasonal/temporal patterns visible in the data, or an honest note that more history is needed>"',
    "  }",
    "}",
    "",
    "Rules: exactly 5 recommendations; trajectoryScore is an integer 1-10; impact is high/medium/low; effort is low/medium/high; every recommendation explanation must reference the brand's real data. Output valid JSON only.",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseJsonObject(text) {
  // The model is asked for raw JSON, but defensively strip code fences and grab
  // the outermost object if it wrapped the JSON in prose.
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

function validateIntelligence(parsed) {
  const fail = (msg) => {
    const err = new Error(`AI intelligence output invalid: ${msg}`);
    err.aiInvalid = true;
    throw err;
  };

  if (!parsed || typeof parsed !== "object") fail("not an object");

  const score = Number(parsed.trajectoryScore);
  if (!Number.isFinite(score) || score < 1 || score > 10) fail("trajectoryScore must be 1-10");
  const trajectoryScore = Math.round(score);

  if (typeof parsed.analysis !== "string" || !parsed.analysis.trim()) fail("missing analysis");

  if (!Array.isArray(parsed.recommendations) || parsed.recommendations.length < 1) {
    fail("recommendations must be a non-empty array");
  }
  const recommendations = parsed.recommendations.slice(0, 5).map((r, i) => {
    if (!r || typeof r.title !== "string" || !r.title.trim()) fail(`recommendation ${i + 1} missing title`);
    if (typeof r.explanation !== "string" || !r.explanation.trim()) {
      fail(`recommendation ${i + 1} missing explanation`);
    }
    const impact = String(r.impact || "").toLowerCase();
    const effort = String(r.effort || "").toLowerCase();
    return {
      title: r.title.trim(),
      explanation: r.explanation.trim(),
      impact: IMPACT_VALUES.has(impact) ? impact : "medium",
      effort: EFFORT_VALUES.has(effort) ? effort : "medium",
      expectedOutcome: typeof r.expectedOutcome === "string" ? r.expectedOutcome.trim() : "",
    };
  });

  if (!Array.isArray(parsed.trends)) fail("trends must be an array");
  const trends = parsed.trends
    .filter((t) => t && (t.label || t.detail))
    .map((t) => ({
      label: String(t.label || "").trim(),
      direction: ["up", "down", "flat"].includes(String(t.direction || "").toLowerCase())
        ? String(t.direction).toLowerCase()
        : "flat",
      detail: String(t.detail || "").trim(),
    }));
  if (trends.length === 0) fail("trends must be a non-empty array");

  const ins = parsed.insights && typeof parsed.insights === "object" ? parsed.insights : {};
  const insights = {
    idealCustomerProfile: String(ins.idealCustomerProfile || "").trim(),
    bestContentAngles: String(ins.bestContentAngles || "").trim(),
    optimalChannelMix: String(ins.optimalChannelMix || "").trim(),
    followUpTiming: String(ins.followUpTiming || "").trim(),
    competitivePositioning: String(ins.competitivePositioning || "").trim(),
    seasonalTrends: String(ins.seasonalTrends || "").trim(),
  };
  // The brief's value is the synthesized profile — reject output missing any of
  // the six required insight sections so a degraded brief never reaches the DB.
  for (const [key, val] of Object.entries(insights)) {
    if (!val) fail(`insights.${key} is required`);
  }

  return { trajectoryScore, analysis: parsed.analysis.trim(), recommendations, trends, insights };
}

async function generateIntelligence(brand, profile) {
  const systemPrompt = buildIntelligencePrompt(brand, profile);

  let response;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Produce the strategic intelligence document for ${brand.brand_name || "this business"} now. JSON only.`,
        },
      ],
    });
  } catch (err) {
    // SDK upstream failures (billing/rate/5xx) carry a numeric status; the
    // controller maps those to 502 as well.
    throw err;
  }

  const text = response.content?.[0]?.text || "";
  if (!text.trim()) {
    const err = new Error("The AI returned an empty intelligence document");
    err.aiInvalid = true;
    throw err;
  }

  let parsed;
  try {
    parsed = parseJsonObject(text);
  } catch {
    const err = new Error("The AI intelligence output was not valid JSON");
    err.aiInvalid = true;
    throw err;
  }

  return validateIntelligence(parsed);
}

module.exports = { buildIntelligencePrompt, generateIntelligence };
