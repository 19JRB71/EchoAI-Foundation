/**
 * Competitor Website Analysis prompts (Scout, Enterprise).
 *
 * analyzeWebsite() reads a competitor's website with Anthropic's `web_fetch` tool
 * (the same server-side fetch Sage uses for submitted links) and extracts a
 * structured analysis: pricing/offers, messaging/positioning, products/services,
 * CTAs/promos, plus a plain-English summary. HONESTY IS ENFORCED: the model must
 * actually retrieve the page; if it cannot (blocked, login-walled, fetch error),
 * it returns {"fetched": false, "reason": ...} and we throw `siteUnreadable` so
 * the caller marks the site 'error' — never a fabricated analysis.
 *
 * detectChanges() compares a stored snapshot against a fresh one and returns only
 * MEANINGFUL changes (new price, new offer, shifted messaging, added/dropped
 * product, changed CTA, redesign) — cosmetic edits are ignored. Any AI/upstream
 * failure surfaces as an error the controller maps to HTTP 502 (never mocked).
 */

const { createMessage, MODEL, HEAVY_AI_TIMEOUT_MS } = require("../config/anthropic");

/** An error the controller maps to a 502 (AI produced nothing usable). */
function aiInvalid(message) {
  const err = new Error(message || "AI produced no usable output");
  err.aiInvalid = true;
  return err;
}

/** The model reached us but truthfully could NOT read the page (honest status). */
function siteUnreadable(reason) {
  const err = new Error(reason || "This site could not be read automatically.");
  err.siteUnreadable = true;
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
  if (!text) throw aiInvalid("AI returned an empty response");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw aiInvalid("AI response contained no JSON object");
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (_e) {
    throw aiInvalid("AI response was not valid JSON");
  }
}

function nonEmptyStr(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function cleanStr(v) {
  return nonEmptyStr(v) ? v.trim() : "";
}
function nullable(v) {
  return nonEmptyStr(v) ? v.trim() : null;
}
function asArray(v) {
  return Array.isArray(v) ? v : [];
}

const ANALYZE_SYSTEM = `You are Scout, Zorecho's competitive intelligence agent. The business owner has given you a COMPETITOR's website URL. Use the web_fetch tool to actually read that page (and, if clearly linked from it, one obvious sub-page such as a pricing or products page). Then extract what matters for this business's marketing strategy.

CRITICAL HONESTY RULES — follow exactly:
- You MUST actually fetch and read the page with web_fetch. If web_fetch fails, is blocked, times out, returns an error, requires a login/paywall, or you cannot retrieve the real page content for any reason, DO NOT guess, infer, or invent anything. Output EXACTLY this and nothing else: {"fetched": false, "reason": "<short plain-English reason, e.g. the site blocked automated reading>"}
- Only report what is actually present on the page. If the page doesn't cover a field, set it to null. NEVER fabricate prices, offers, products, or claims.

When you successfully read the page, output ONE JSON object and nothing else:
{
  "fetched": true,
  "pricing": "the pricing, plans, or rates found on the page, or null",
  "offers": "current promotions, discounts, or limited-time offers, or null",
  "messaging": "their core messaging / value proposition / positioning, or null",
  "products": "the products or services they list, or null",
  "ctas": "the main calls-to-action and lead capture on the page, or null",
  "positioning": "one line: how they position themselves in the market, or null",
  "summary": "2-3 sentences: the key takeaway for a competitor watching this business"
}`;

/**
 * Read + analyze one competitor site. Returns the structured analysis, throws
 * `siteUnreadable` when the model honestly couldn't read it, or `aiInvalid` when
 * the AI produced nothing usable.
 */
async function analyzeWebsite(brand, site) {
  const url = cleanStr(site && site.url);
  if (!url) throw aiInvalid("No URL provided to analyze");

  const resp = await createMessage(
    {
      model: MODEL,
      max_tokens: 1800,
      system: ANALYZE_SYSTEM,
      tools: [{ type: "web_fetch_20250910", name: "web_fetch", max_uses: 4 }],
      messages: [
        {
          role: "user",
          content: `Read and analyze this competitor's website for ${
            brand.brand_name || "this business"
          }: ${url}`,
        },
      ],
    },
    { label: "Scout site analysis", timeout: HEAVY_AI_TIMEOUT_MS, attempts: 2 },
  );

  const parsed = extractJson(textOf(resp));
  if (parsed.fetched === false) {
    throw siteUnreadable(cleanStr(parsed.reason));
  }

  const analysis = {
    pricing: nullable(parsed.pricing),
    offers: nullable(parsed.offers),
    messaging: nullable(parsed.messaging),
    products: nullable(parsed.products),
    ctas: nullable(parsed.ctas),
    positioning: nullable(parsed.positioning),
    summary: nullable(parsed.summary),
  };
  if (!Object.values(analysis).some((v) => v)) {
    throw aiInvalid("Scout could not extract anything useful from the site");
  }
  return analysis;
}

const CHANGE_TYPES = new Set(["pricing", "offer", "messaging", "products", "cta", "redesign"]);

/** Normalize the model's raw change list into validated, typed change objects. */
function normalizeChanges(rawChanges) {
  return asArray(rawChanges)
    .filter((c) => c && nonEmptyStr(c.summary))
    .map((c) => {
      const type = cleanStr(c.type).toLowerCase();
      return {
        type: CHANGE_TYPES.has(type) ? type : "messaging",
        summary: cleanStr(c.summary),
        detail: nullable(c.detail),
      };
    })
    .slice(0, 8);
}

const CHANGE_SYSTEM = `You are Scout, Zorecho's competitive intelligence agent. You are comparing a competitor's website analysis from BEFORE against a NEW analysis of the SAME site, to decide whether anything MEANINGFUL changed that the business owner should know about.

MEANINGFUL — report these: a new or changed PRICE, a new/changed/expired OFFER or promotion, a clear shift in MESSAGING or positioning, a newly added or dropped PRODUCT or SERVICE, a changed primary CALL-TO-ACTION, or an apparent REDESIGN / relaunch.
COSMETIC — NEVER report: sentences reworded with the same meaning, image swaps, minor layout or styling tweaks, seasonal decoration, typo fixes, or anything with no strategic impact.

Be conservative: if you are not confident a change is real AND meaningful, do not report it. Returning an empty list is correct when nothing meaningful changed.

Output ONE JSON object and nothing else:
{ "changes": [ { "type": "pricing|offer|messaging|products|cta|redesign", "summary": "one plain-English sentence on what changed", "detail": "the before-vs-after specifics" } ] }`;

/**
 * Compare two analysis snapshots and return only meaningful changes ([] when
 * nothing meaningful changed). Throws (aiInvalid → 502) on AI/upstream failure.
 */
async function detectChanges(brand, previous, current) {
  const resp = await createMessage(
    {
      model: MODEL,
      max_tokens: 1200,
      system: CHANGE_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Competitor website for ${
            brand.brand_name || "this business"
          }.\n\nBEFORE:\n${JSON.stringify(previous)}\n\nNOW:\n${JSON.stringify(current)}`,
        },
      ],
    },
    { label: "Scout site change detection", timeout: HEAVY_AI_TIMEOUT_MS, attempts: 2 },
  );

  const parsed = extractJson(textOf(resp));
  return normalizeChanges(parsed.changes);
}

module.exports = {
  analyzeWebsite,
  detectChanges,
  // exported for unit tests
  normalizeChanges,
  extractJson,
  textOf,
  aiInvalid,
  siteUnreadable,
};
