/**
 * Sage — Company Intelligence Report builder (Phase 1 "Company Truth").
 *
 * generateCompanyReport(brand, gathered, researchRequest) synthesizes every
 * REAL data source into the spec's Company Intelligence Report. Grounded ONLY
 * in the provided data plus live web research about the industry category;
 * where data is missing the report must say so (missingInformation), never
 * guess. Malformed output throws err.aiInvalid (controller maps to 502).
 */

const { createMessage, MODEL, HEAVY_AI_TIMEOUT_MS } = require("../config/anthropic");
const { REPORT_SECTIONS, validateCompanyReport } = require("../utils/companyTruth");

const SYSTEM = [
  "You are Sage, Zorecho's Company Intelligence Agent. You are building the single most important document in the platform: the Company Intelligence Report that, once the owner approves it, becomes the authoritative Company Truth every other AI department must follow.",
  "ABSOLUTE RULES:",
  "- Ground every statement in the REAL data provided (and live web research about the industry category). Never invent facts, numbers, competitors, or capabilities.",
  "- The EXACT business classification matters enormously. Example of the failure you exist to prevent: a pole barn builder being misread as a storage building facility. Pin down the precise category and explicitly list commonly confused or excluded categories.",
  "- Where information is missing or a data source was unavailable, say so plainly in the missingInformation section. An honest gap is valuable; a guess is poison.",
  "- Write for a business owner, in plain language. No marketing fluff.",
].join("\n");

function buildPrompt(brand, gathered, researchRequest) {
  const sectionList = REPORT_SECTIONS.map(
    ([key, label]) => `  "${key}": <string or array of strings — ${label}>`,
  ).join(",\n");

  return [
    `Build the Company Intelligence Report for "${brand.brand_name}".`,
    "",
    "REAL DATA GATHERED FROM THE PLATFORM (sources marked unavailable failed to load — treat them as unknown, never assume):",
    "```json",
    JSON.stringify(gathered.summary, null, 2),
    "```",
    researchRequest
      ? `\nTHE OWNER REVIEWED A PRIOR DRAFT AND REQUESTED ADDITIONAL RESEARCH:\n"${researchRequest}"\nAddress this request directly — it is the owner correcting or expanding your understanding.\n`
      : "",
    "Use web research to sharpen the industry classification, terminology, and commonly-confused-categories sections for this exact type of business.",
    "",
    "Respond with ONLY a JSON object (no markdown fences, no prose outside it):",
    "{",
    '  "plainSummary": "<a warm, plain-language summary (5-10 sentences) presenting the report to the owner: who we understand you are, what you sell, who you serve, and what we still need from you>",',
    '  "sections": {',
    sectionList,
    "  }",
    "}",
    "",
    'The "excludedCategories" section must explicitly name business categories this company is commonly confused with but is NOT.',
    'The "missingInformation" section must be an array listing every gap and every unavailable data source (empty array only if truly nothing is missing).',
  ]
    .filter(Boolean)
    .join("\n");
}

async function generateCompanyReport(brand, gathered, researchRequest) {
  const resp = await createMessage(
    {
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      messages: [{ role: "user", content: buildPrompt(brand, gathered, researchRequest) }],
    },
    { label: "Sage company truth", timeout: HEAVY_AI_TIMEOUT_MS, attempts: 2 },
  );

  const text = (resp.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    const err = new Error("Sage returned no JSON report");
    err.aiInvalid = true;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    const err = new Error("Sage returned malformed JSON");
    err.aiInvalid = true;
    throw err;
  }
  return validateCompanyReport(parsed);
}

module.exports = { generateCompanyReport, buildPrompt };
