/**
 * Scout — Grant & Funding Intelligence agent.
 *
 * generateFundingOpportunities(brand, profile) studies one business's profile and
 * surfaces REAL, well-known funding programs it may qualify for across five
 * sources: federal grants (Grants.gov), SBA programs, USDA programs, State of
 * Florida programs, and private foundations. For each it returns a complete
 * briefing — name, source, typical award amount, deadline cadence, eligibility,
 * a plain-English recommendation (apply/consider/skip) with rationale, and a
 * fit/impact/probability read used to rank the pipeline.
 *
 * Honesty guardrails baked into the prompt: only surface programs that plausibly
 * fit; NEVER invent a fake program or a fake hard deadline (use a cadence like
 * "Rolling" or "Annual (verify)" when unsure); the owner must confirm details on
 * the official page before applying. Output is validated before persistence; bad
 * output throws `err.aiInvalid = true` so the controller maps it to 502.
 */

const { createMessage, MODEL, DEFAULT_AI_TIMEOUT_MS } = require("../config/anthropic");

const SOURCES = new Set(["Federal", "SBA", "USDA", "Florida", "Foundation", "Other"]);
const RECOMMENDATIONS = new Set(["apply", "consider", "skip"]);

function clampScore(n, dflt = 5) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return dflt;
  return Math.max(1, Math.min(10, v));
}

/**
 * Accepts a concrete ISO date (YYYY-MM-DD) only. Anything ambiguous — a cadence
 * string, a partial/invalid date, or null — collapses to null so we never store
 * an invented deadline (honesty rule); the cadence lives in deadlineText.
 */
function parseIsoDate(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

function normalizeSource(s) {
  const raw = String(s || "").trim();
  const lower = raw.toLowerCase();
  if (lower.includes("sba") || lower.includes("small business administration")) return "SBA";
  if (lower.includes("usda") || lower.includes("agriculture")) return "USDA";
  if (lower.includes("florida") || lower === "fl" || lower.includes("state of florida")) return "Florida";
  if (lower.includes("foundation") || lower.includes("private") || lower.includes("nonprofit")) return "Foundation";
  if (lower.includes("federal") || lower.includes("grants.gov") || lower.includes("government")) return "Federal";
  if (SOURCES.has(raw)) return raw;
  return "Other";
}

function buildFundingPrompt(brand, profile) {
  const name = brand.brand_name || "the business";
  return [
    "You are EchoAI's Scout — a funding & grants research specialist who finds capital for small businesses.",
    "You know the real landscape of U.S. small-business funding: federal grants on Grants.gov, SBA loan & grant programs, USDA Rural Development programs, State of Florida economic-development and small-business programs, and private/corporate foundation grant programs.",
    "Given ONE business's profile, surface the funding programs it most plausibly qualifies for. Be honest and specific.",
    "",
    "STRICT HONESTY RULES:",
    "- Only include programs that genuinely exist and plausibly fit this business. Do NOT invent programs.",
    "- Do NOT invent exact application deadlines. If you are not certain of a current deadline, use a cadence string such as 'Rolling', 'Annual (verify)', or 'Quarterly (verify)' instead of a specific date.",
    "- Award amounts are typical ranges; make clear they are approximate.",
    "- Every program must be something the owner can then verify on the official program page before applying.",
    "",
    `BUSINESS: ${name}`,
    brand.brand_personality ? `Brand personality: ${brand.brand_personality}` : "",
    brand.tagline ? `Tagline: ${brand.tagline}` : "",
    "",
    "BUSINESS PROFILE (real data, JSON):",
    "```json",
    JSON.stringify(profile, null, 2),
    "```",
    "",
    "Return ONLY a JSON object (no markdown fences, no prose outside the JSON) with EXACTLY this shape:",
    "{",
    '  "opportunities": [',
    "    {",
    '      "source": "Federal|SBA|USDA|Florida|Foundation|Other",',
    '      "name": "<official program name>",',
    '      "awardAmount": "<typical award or range, e.g. \'$5,000–$50,000\'>",',
    '      "amountMax": <number: approximate upper award in dollars, or null>,',
    '      "deadline": "<ISO date YYYY-MM-DD ONLY if you are certain of a real upcoming deadline, else null>",',
    '      "deadlineText": "<deadline cadence, e.g. \'Rolling\' or \'Annual (verify)\'>",',
    '      "eligibility": "<who qualifies — the concrete requirements>",',
    '      "description": "<what the program funds and why it fits THIS business>",',
    '      "recommendation": "apply|consider|skip",',
    '      "rationale": "<one plain-English paragraph: why apply / why not, grounded in this business>",',
    '      "fitScore": <integer 1-10: how well the business fits the eligibility>,',
    '      "impactScore": <integer 1-10: how much this funding would move the business>,',
    '      "probabilityScore": <integer 1-10: realistic odds of being awarded>,',
    '      "officialUrl": "<official program URL if known, else empty string>"',
    "    }",
    "    // 4-8 opportunities, the strongest fits first",
    "  ]",
    "}",
    "",
    "Rules: 4-8 opportunities; cover a mix of the five sources where relevant; scores are integers 1-10; recommendation is apply/consider/skip; ground each rationale in the business profile. Output valid JSON only.",
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

/** Validates + normalizes the AI funding output. Throws err.aiInvalid on bad data. */
function validateFunding(parsed) {
  const fail = (msg) => {
    const err = new Error(`AI funding output invalid: ${msg}`);
    err.aiInvalid = true;
    throw err;
  };

  if (!parsed || typeof parsed !== "object") fail("not an object");
  if (!Array.isArray(parsed.opportunities) || parsed.opportunities.length < 1) {
    fail("opportunities must be a non-empty array");
  }

  const opportunities = parsed.opportunities
    .map((o) => {
      if (!o || typeof o !== "object") return null;
      const name = String(o.name || "").trim();
      const eligibility = String(o.eligibility || "").trim();
      const description = String(o.description || "").trim();
      const rationale = String(o.rationale || "").trim();
      if (!name || !eligibility || !description || !rationale) return null;

      const impactScore = clampScore(o.impactScore);
      const probabilityScore = clampScore(o.probabilityScore);
      const rec = String(o.recommendation || "").toLowerCase();
      const amountMax = Number(o.amountMax);

      return {
        source: normalizeSource(o.source),
        name,
        awardAmount: String(o.awardAmount || "").trim(),
        amountMax: Number.isFinite(amountMax) && amountMax > 0 ? amountMax : null,
        deadline: parseIsoDate(o.deadline),
        deadlineText: String(o.deadlineText || "").trim() || "Verify on official page",
        eligibility,
        description,
        recommendation: RECOMMENDATIONS.has(rec) ? rec : "consider",
        rationale,
        fitScore: clampScore(o.fitScore),
        impactScore,
        probabilityScore,
        priorityScore: impactScore * probabilityScore,
        officialUrl: String(o.officialUrl || "").trim(),
      };
    })
    .filter(Boolean);

  if (opportunities.length === 0) fail("no valid opportunities after validation");
  return opportunities;
}

async function generateFundingOpportunities(brand, profile) {
  const system = buildFundingPrompt(brand, profile);

  const response = await createMessage(
    {
      model: MODEL,
      max_tokens: 3500,
      system,
      messages: [
        {
          role: "user",
          content: `Surface the strongest funding opportunities for ${brand.brand_name || "this business"} now. JSON only.`,
        },
      ],
    },
    { timeout: DEFAULT_AI_TIMEOUT_MS, label: "Funding intelligence" },
  );

  const text = response.content?.[0]?.text || "";
  if (!text.trim()) {
    const err = new Error("The AI returned no funding opportunities");
    err.aiInvalid = true;
    throw err;
  }

  let parsed;
  try {
    parsed = parseJsonObject(text);
  } catch {
    const err = new Error("The AI funding output was not valid JSON");
    err.aiInvalid = true;
    throw err;
  }

  return validateFunding(parsed);
}

module.exports = {
  buildFundingPrompt,
  validateFunding,
  normalizeSource,
  parseIsoDate,
  generateFundingOpportunities,
};
