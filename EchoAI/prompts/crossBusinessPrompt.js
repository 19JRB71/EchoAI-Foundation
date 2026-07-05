/**
 * Echo — Cross-Business Intelligence agent (Multi-Business Chief of Staff).
 *
 * generateCrossBusinessIntelligence(businesses) studies the owner's ENTIRE
 * portfolio of REAL businesses at once (the demo brand is already excluded by the
 * caller) and surfaces the connections a single-business view can never see:
 *   - shared audiences / cross-promotion opportunities between the businesses
 *   - cross-referral value (customers of one that should hear about another)
 *   - resource & budget reallocation across businesses (winners vs laggards)
 *   - skill / tactic transfer (what's working in one, try in another)
 *   - attention-vs-revenue allocation (where the owner over/under-invests time)
 *
 * Honesty guardrails: only draw conclusions the provided portfolio data supports;
 * never invent businesses, numbers, or customers; if two businesses have no real
 * overlap say so. Output is validated before persistence; bad output throws
 * `err.aiInvalid = true` so the controller maps it to 502.
 */

const { createMessage, MODEL, DEFAULT_AI_TIMEOUT_MS } = require("../config/anthropic");

const CATEGORIES = new Set([
  "shared_audience",
  "cross_referral",
  "resource_allocation",
  "skill_transfer",
  "attention_allocation",
]);

function clampScore(n, dflt = 5) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return dflt;
  return Math.max(1, Math.min(10, v));
}

function normalizeCategory(c) {
  const raw = String(c || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (CATEGORIES.has(raw)) return raw;
  if (raw.includes("referr")) return "cross_referral";
  if (raw.includes("audien") || raw.includes("promot")) return "shared_audience";
  if (raw.includes("budget") || raw.includes("resource") || raw.includes("reallocat"))
    return "resource_allocation";
  if (raw.includes("skill") || raw.includes("tactic") || raw.includes("transfer"))
    return "skill_transfer";
  if (raw.includes("attention") || raw.includes("time") || raw.includes("focus"))
    return "attention_allocation";
  return "shared_audience";
}

function buildCrossBusinessPrompt(businesses) {
  return [
    "You are Echo, the Multi-Business Chief of Staff inside EchoAI — an AI marketing platform.",
    "The owner runs MULTIPLE businesses. You see all of them at once, so your job is to surface the cross-business connections and reallocation opportunities that a single-business view cannot.",
    "",
    "STRICT HONESTY RULES:",
    "- Ground EVERY insight in the portfolio data provided below. Never invent a business, a customer, a number, or an overlap.",
    "- If two businesses genuinely have no meaningful overlap or transferable tactic, do not manufacture one.",
    "- Be concrete and specific — name the businesses involved and cite the real signal (leads, revenue, health, activity) behind each insight.",
    "",
    "PORTFOLIO (real data, JSON — the owner's businesses, demo/sandbox already excluded):",
    "```json",
    JSON.stringify(businesses, null, 2),
    "```",
    "",
    "Return ONLY a JSON object (no markdown fences, no prose outside the JSON) with EXACTLY this shape:",
    "{",
    '  "insights": [',
    "    {",
    '      "category": "shared_audience|cross_referral|resource_allocation|skill_transfer|attention_allocation",',
    '      "title": "<short, specific headline>",',
    '      "businesses": ["<business name>", "<business name>"],',
    '      "insight": "<what you see across these businesses, grounded in the data>",',
    '      "recommendedAction": "<the single concrete next step the owner should take>",',
    '      "impactScore": <integer 1-10: how much acting on this would move the portfolio>',
    "    }",
    "    // 3-6 insights, highest impact first, spread across the categories where the data supports it",
    "  ],",
    '  "summary": "<2-4 sentence executive read of the whole portfolio: where momentum is, where attention is misallocated, the single biggest cross-business opportunity>"',
    "}",
    "",
    "Rules: 3-6 insights; impactScore is an integer 1-10; every insight names the real businesses involved; ground everything in the data. Output valid JSON only.",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseJsonObject(text) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
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

/** Validates + normalizes the AI cross-business output. Throws err.aiInvalid on bad data. */
function validateCrossBusiness(parsed) {
  const fail = (msg) => {
    const err = new Error(`AI cross-business output invalid: ${msg}`);
    err.aiInvalid = true;
    throw err;
  };

  if (!parsed || typeof parsed !== "object") fail("not an object");
  if (!Array.isArray(parsed.insights) || parsed.insights.length < 1) {
    fail("insights must be a non-empty array");
  }

  const insights = parsed.insights
    .map((i) => {
      if (!i || typeof i !== "object") return null;
      const title = String(i.title || "").trim();
      const insight = String(i.insight || "").trim();
      const recommendedAction = String(i.recommendedAction || "").trim();
      if (!title || !insight || !recommendedAction) return null;
      const businesses = Array.isArray(i.businesses)
        ? i.businesses.map((b) => String(b || "").trim()).filter(Boolean)
        : [];
      return {
        category: normalizeCategory(i.category),
        title,
        businesses,
        insight,
        recommendedAction,
        impactScore: clampScore(i.impactScore),
      };
    })
    .filter(Boolean);

  if (insights.length === 0) fail("no valid insights after validation");

  const summary = String(parsed.summary || "").trim();
  if (!summary) fail("summary is required");

  insights.sort((a, b) => b.impactScore - a.impactScore);
  return { insights, summary };
}

async function generateCrossBusinessIntelligence(businesses) {
  const system = buildCrossBusinessPrompt(businesses);

  const response = await createMessage(
    {
      model: MODEL,
      max_tokens: 3000,
      system,
      messages: [
        {
          role: "user",
          content:
            "Analyze this portfolio and surface the strongest cross-business opportunities now. JSON only.",
        },
      ],
    },
    { timeout: DEFAULT_AI_TIMEOUT_MS, label: "Cross-business intelligence" },
  );

  const text = response.content?.[0]?.text || "";
  if (!text.trim()) {
    const err = new Error("The AI returned no cross-business intelligence");
    err.aiInvalid = true;
    throw err;
  }

  let parsed;
  try {
    parsed = parseJsonObject(text);
  } catch {
    const err = new Error("The AI cross-business output was not valid JSON");
    err.aiInvalid = true;
    throw err;
  }

  return validateCrossBusiness(parsed);
}

module.exports = {
  buildCrossBusinessPrompt,
  validateCrossBusiness,
  normalizeCategory,
  generateCrossBusinessIntelligence,
};
