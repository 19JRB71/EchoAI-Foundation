/**
 * Prompt 022 — Sage pre-interview public research AI calls.
 *
 * BOTH calls run entirely through config/anthropic.js createMessage (aiGate
 * admission + ai_usage_log accounting + bounded pause_turn continuation).
 * All external content is retrieved by Anthropic's SERVER-SIDE web_fetch /
 * web_search tools — this module performs ZERO local URL fetches (D-33 B1);
 * owner-supplied URLs travel only as data/text inside the prompt.
 *
 * Honesty contract: the model may only report what it actually read. A field
 * without a verbatim excerpt and the URL it came from is discarded by the
 * orchestrator — "no field without provenance" is enforced in code, not
 * trusted to the prompt.
 */

const { createMessage, MODEL } = require("../config/anthropic");

const FEATURE_LABEL = "sage_preinterview_research";

// Draft field keys Sage may propose. Anything else the model emits is dropped.
const FIELD_KEYS = Object.freeze([
  "business_name",
  "description",
  "services",
  "service_area",
  "address",
  "phone",
  "email",
  "hours",
  "target_audience",
]);

function aiInvalid(message) {
  const err = new Error(message);
  err.aiInvalid = true;
  return err;
}

function textOf(resp) {
  return ((resp && resp.content) || [])
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function extractJson(text) {
  const fail = (msg) => {
    const err = aiInvalid(msg);
    // Carry the raw text (bounded) so the orchestrator can run its single
    // tool-free corrective re-parse call instead of re-running the phase.
    if (text) err.rawText = String(text).slice(0, 6000);
    return err;
  };
  if (!text) throw fail("AI returned an empty response");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw fail("AI response contained no JSON object");
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (_e) {
    throw fail("AI response was not valid JSON");
  }
}

const FIELD_LIST = FIELD_KEYS.map((k) => `"${k}"`).join(", ");

const HONESTY_RULES = `CRITICAL HONESTY RULES — follow exactly:
- Only report facts you actually read from a page you retrieved. NEVER guess, infer beyond the evidence, or invent values.
- Every finding MUST include: the exact field key, the value, a short VERBATIM excerpt from the page that states it, and the URL of the page it came from.
- If you could not retrieve anything useful, output EXACTLY: {"found": false, "reason": "<short plain-English reason>"} and nothing else.
- Allowed field keys (use ONLY these): ${FIELD_LIST}.

Output ONE JSON object and nothing else:
{
  "found": true,
  "findings": [
    { "field": "<field key>", "value": "<the fact>", "excerpt": "<verbatim supporting text>", "url": "<page URL it came from>" }
  ]
}`;

const WEBSITE_SYSTEM = `You are Sage, Zorecho's business intelligence agent. The owner of a business gave us their own website URL during onboarding. Use the web_fetch tool to actually read that site (and, if clearly linked, one obvious sub-page such as an about, services, or contact page). Extract basic public business profile facts so we don't have to ask the owner for things they already publish.

${HONESTY_RULES}`;

const PUBLIC_WEB_SYSTEM = `You are Sage, Zorecho's business intelligence agent. A business owner is onboarding and we have little or no usable website/Facebook information. Use the web_search tool to look for this business's LEGITIMATE PUBLIC presence (directories, maps listings, review sites, news). Only use ordinary public, unauthenticated sources.

${HONESTY_RULES}`;

/**
 * Phase: read the owner's own website via Anthropic server-side web_fetch.
 * @returns {{found: boolean, reason?: string, findings?: Array}}
 */
async function researchWebsite(brand, websiteUrl, { timeout } = {}) {
  const resp = await createMessage(
    {
      model: MODEL,
      max_tokens: 1000,
      system: WEBSITE_SYSTEM,
      tools: [{ type: "web_fetch_20250910", name: "web_fetch", max_uses: 2 }],
      messages: [
        {
          role: "user",
          content: `Research the public website of "${brand.brand_name || "this business"}": ${websiteUrl}`,
        },
      ],
    },
    {
      label: "Sage pre-interview website research",
      feature: FEATURE_LABEL,
      brandId: brand.brand_id,
      userId: brand.user_id,
      timeout,
      attempts: 1, // budget reservation covers exactly one issued call
    },
  );
  return extractJson(textOf(resp));
}

/**
 * Phase: public-web fallback via Anthropic server-side web_search.
 * @returns {{found: boolean, reason?: string, findings?: Array}}
 */
async function researchPublicWeb(brand, hints, { timeout } = {}) {
  const hintText = [
    brand.brand_name ? `Business name: ${brand.brand_name}` : null,
    hints.websiteUrl ? `Website (may be unreachable): ${hints.websiteUrl}` : null,
    hints.facebookPageUrl ? `Facebook page: ${hints.facebookPageUrl}` : null,
    hints.industry ? `Industry: ${hints.industry}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const resp = await createMessage(
    {
      model: MODEL,
      max_tokens: 1000,
      system: PUBLIC_WEB_SYSTEM,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
      messages: [
        {
          role: "user",
          content: `Find the legitimate public presence of this business and extract profile facts:\n${hintText}`,
        },
      ],
    },
    {
      label: "Sage pre-interview public-web research",
      feature: FEATURE_LABEL,
      brandId: brand.brand_id,
      userId: brand.user_id,
      timeout,
      attempts: 1,
    },
  );
  return extractJson(textOf(resp));
}

/**
 * Bounded corrective re-parse: a TOOL-FREE call (so pause_turn cannot occur —
 * exactly one provider request) that extracts the findings JSON from a
 * malformed earlier response. Never sees URLs or fetches anything.
 */
async function reparseJson(brand, rawText, { timeout } = {}) {
  const resp = await createMessage(
    {
      model: MODEL,
      max_tokens: 800,
      system: `Extract the single JSON object of research findings from the text below. Output ONLY the corrected JSON object — same schema: {"found": boolean, "reason"?, "findings"?: [{"field","value","excerpt","url"}]}. Allowed field keys: ${FIELD_LIST}. Drop any finding that lacks a verbatim excerpt or URL. If no usable findings exist, output {"found": false, "reason": "unusable earlier output"}.`,
      messages: [{ role: "user", content: String(rawText).slice(0, 6000) }],
    },
    {
      label: "Sage pre-interview research re-parse",
      feature: FEATURE_LABEL,
      brandId: brand.brand_id,
      userId: brand.user_id,
      timeout,
      attempts: 1,
    },
  );
  return extractJson(textOf(resp));
}

module.exports = {
  FIELD_KEYS,
  FEATURE_LABEL,
  researchWebsite,
  researchPublicWeb,
  reparseJson,
  extractJson,
  textOf,
};
