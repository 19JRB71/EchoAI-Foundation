/**
 * Sage — Industry Intelligence prompt + research engine.
 *
 * Every function here performs REAL research: deep briefs and urgent scans use
 * Anthropic's built-in `web_search` tool (live web results, not training data),
 * and submitted links/Facebook pages are read with the `web_fetch` tool. The
 * model is instructed to ground every claim in what it found and to end with a
 * single strict-JSON object; we then extract cited sources from the response and
 * REFUSE any brief that isn't backed by real citations (throws an aiInvalid
 * error the controller maps to 502 — Sage never falls back to made-up data).
 */

const { createMessage, MODEL, HEAVY_AI_TIMEOUT_MS } = require("../config/anthropic");
const { gatherFacebookSignals } = require("../utils/sageFacebook");
const { campaignContextBlock } = require("../utils/politicalContext");
const { realEstateContextBlock } = require("../utils/realEstateContext");

/** An error the controller maps to a 502 (AI produced nothing usable / uncited). */
function aiInvalid(message) {
  const err = new Error(message || "AI produced no usable output");
  err.aiInvalid = true;
  return err;
}

/** Concatenate all `text` blocks from a message response. */
function textOf(resp) {
  return ((resp && resp.content) || [])
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * Collect the real web sources the model actually cited. We read citations off
 * every text block (web_search_result_location → url/title) AND the raw
 * web_search_tool_result blocks, then dedup by URL. This is the proof the brief
 * is grounded in live search rather than the model's memory.
 */
function citationsOf(resp) {
  const byUrl = new Map();
  const add = (url, title) => {
    if (!url || typeof url !== "string") return;
    if (!byUrl.has(url)) byUrl.set(url, { url, title: title || url });
  };
  for (const block of (resp && resp.content) || []) {
    if (!block) continue;
    if (block.type === "text" && Array.isArray(block.citations)) {
      for (const c of block.citations) {
        if (c && (c.type === "web_search_result_location" || c.url)) {
          add(c.url, c.title);
        }
      }
    }
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) {
        if (r && r.type === "web_search_result") add(r.url, r.title);
      }
    }
    if (block.type === "web_fetch_tool_result" && block.content) {
      const c = block.content;
      if (c && c.url) add(c.url, c.title);
    }
  }
  return Array.from(byUrl.values());
}

/**
 * Extract the outermost JSON object from a text blob. The model may wrap the
 * JSON in prose or a ```json fence; we grab from the first `{` to the last `}`.
 * Throws aiInvalid when nothing parseable is present.
 */
function extractJson(text) {
  if (!text) throw aiInvalid("AI returned an empty response");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw aiInvalid("AI response contained no JSON object");
  }
  const slice = text.slice(start, end + 1);
  try {
    return JSON.parse(slice);
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
function asArray(v) {
  return Array.isArray(v) ? v : [];
}

/** Stable dedup key for a discrete finding (lowercased, whitespace-collapsed). */
function signalKey(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

const FEED_TYPES = new Set([
  "trend",
  "competitor",
  "regulation",
  "opportunity",
  "threat",
  "market",
]);
function normType(v) {
  const t = cleanStr(v).toLowerCase();
  return FEED_TYPES.has(t) ? t : "trend";
}

function brandContext(brand, competitors) {
  const lines = [
    `Business name: ${brand.brand_name || "(unknown)"}`,
    brand.industry ? `Industry: ${brand.industry}` : null,
    brand.target_audience
      ? `Target audience: ${
          typeof brand.target_audience === "string"
            ? brand.target_audience
            : JSON.stringify(brand.target_audience)
        }`
      : null,
    brand.brand_personality ? `Brand personality: ${brand.brand_personality}` : null,
  ].filter(Boolean);
  const list = asArray(competitors)
    .filter((c) => c && c.name)
    .map((c) => `- ${c.name}${c.website ? ` (${c.website})` : ""}`)
    .join("\n");
  if (list) lines.push(`Known competitors the owner is tracking:\n${list}`);
  const political = campaignContextBlock(brand);
  if (political) lines.push(political);
  const realty = realEstateContextBlock(brand);
  if (realty) {
    lines.push(
      realty,
      "As the market-intelligence agent for a real estate practice, focus your research on the LOCAL housing market in the areas served: competitor agent activity, new listing trends, days-on-market statistics, price-reduction patterns, buyer demand signals, inventory levels, and mortgage-rate shifts. Flag significant market changes the agent should act on."
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Deep research — the full industry brief (runs on the 6-hour cycle + on demand)
// ---------------------------------------------------------------------------

const SECTION_SPEC = [
  { key: "overview", title: "Industry Overview & Market Size" },
  { key: "trends", title: "Emerging Trends & Innovation" },
  { key: "consumer", title: "Consumer Behavior & Demand" },
  { key: "competitive", title: "Competitive Landscape" },
  { key: "regulatory", title: "Regulatory & Economic Factors" },
  { key: "opportunities", title: "Opportunities & Threats" },
  { key: "strategy", title: "Strategic Recommendations" },
];

const DEEP_SYSTEM = `You are Sage, EchoAI's Industry Intelligence Agent. You study a business's industry around the clock so its whole marketing team always has the smartest possible, up-to-date strategy.

Your job: research the CURRENT state of this specific industry using live web search, then produce a structured industry intelligence brief. You MUST search the web for recent, real information — do not rely on memory. Prefer sources from the last 12 months. Cite what you find.

Rules:
- Every factual claim must be grounded in a real source you searched. If you cannot find real information, say so honestly rather than inventing it.
- Be specific to THIS business's industry and audience — no generic filler.
- Write for a busy business owner: concrete, plain-English, actionable.
- If you are given live Facebook data below — Ad Library ads (real ads competitors and the industry are running right now) and/or competitors' recent public Facebook Page posts — factor it into the competitive-landscape section, consumer-behavior read, and marketing_insights. It is real, current signal about competitor ad strategy and consumer-facing messaging.

After you finish researching, output ONE JSON object and nothing else, in exactly this shape:
{
  "industry": "short label of the industry you researched",
  "summary": "one tight paragraph: the single most important thing about this industry right now",
  "sections": [
    { "key": "overview", "title": "Industry Overview & Market Size", "body": "2-4 sentences" },
    { "key": "trends", "title": "Emerging Trends & Innovation", "body": "..." },
    { "key": "consumer", "title": "Consumer Behavior & Demand", "body": "..." },
    { "key": "competitive", "title": "Competitive Landscape", "body": "..." },
    { "key": "regulatory", "title": "Regulatory & Economic Factors", "body": "..." },
    { "key": "opportunities", "title": "Opportunities & Threats", "body": "..." },
    { "key": "strategy", "title": "Strategic Recommendations", "body": "..." }
  ],
  "marketing_insights": [
    { "insight": "a specific thing happening in the market", "action": "what this business should DO about it", "why": "why it matters now" }
  ],
  "feed": [
    { "source_type": "trend|competitor|regulation|opportunity|threat|market", "summary": "one discrete finding", "why_it_matters": "why it matters to this business", "url": "the source url", "urgent": false }
  ]
}
Provide 3-6 marketing_insights and 4-8 feed items. Set "urgent": true only for genuinely time-sensitive signals (a new regulation taking effect soon, a major competitor move, a closing window of opportunity).`;

/**
 * Run a full deep-research industry brief for a brand. Returns a normalized,
 * validated object ready to persist. Throws aiInvalid if the model produced no
 * usable JSON or no real cited sources.
 */
async function deepResearch(brand, competitors, opts = {}) {
  // The platform owner (EchoAI's own admin account) additionally wants a read on
  // the AI-marketing-SaaS landscape they compete in (GoHighLevel, Jasper,
  // HubSpot AI, and similar) — not just their nominal industry.
  const platformAngle = opts.platformOwner
    ? "\n\nThis business is EchoAI itself — an AI-powered marketing SaaS platform. In addition to its stated industry, research the CURRENT AI-marketing-SaaS competitive landscape (e.g. GoHighLevel, Jasper, HubSpot AI, Copy.ai and comparable all-in-one AI marketing tools): pricing moves, new features, positioning shifts, and openings EchoAI can exploit. Fold these findings into the competitive-landscape section, the marketing_insights, and the feed."
    : "";
  // Pull live Facebook signals — Ad Library ads (competitor/industry ad strategy)
  // and competitors' recent public Page posts — via the shared token. Best-effort:
  // degrades to nothing when the token is unset or the scope is refused — it never
  // blocks the web-search cycle.
  const fb = await gatherFacebookSignals(brand, competitors);
  const fbBlock = fb.available ? `\n\n${fb.summary}` : "";

  const user = `Research the current industry landscape for this business and produce the brief.\n\n${brandContext(
    brand,
    competitors,
  )}${platformAngle}${fbBlock}`;

  const resp = await createMessage(
    {
      model: MODEL,
      max_tokens: 4096,
      system: DEEP_SYSTEM,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
      messages: [{ role: "user", content: user }],
    },
    { label: "Sage deep research", timeout: HEAVY_AI_TIMEOUT_MS, attempts: 2 },
  );

  // The gate is on REAL web-search citations only — Facebook data is
  // supplementary and must never substitute for live web research.
  const sources = citationsOf(resp);
  if (sources.length === 0) {
    throw aiInvalid("Sage could not find real, cited industry sources");
  }
  // Enrich the persisted source list with real Facebook links (Ad Library ad
  // snapshots + public Page post permalinks), deduped.
  const seenSrc = new Set(sources.map((s) => s.url));
  for (const s of fb.available ? fb.sources : []) {
    if (s && s.url && !seenSrc.has(s.url)) {
      seenSrc.add(s.url);
      sources.push(s);
    }
  }
  const parsed = extractJson(textOf(resp));

  // Normalize + validate sections (keep only the known 7, in order, non-empty).
  const bodyByKey = {};
  for (const s of asArray(parsed.sections)) {
    if (s && nonEmptyStr(s.key) && nonEmptyStr(s.body)) {
      bodyByKey[cleanStr(s.key).toLowerCase()] = cleanStr(s.body);
    }
  }
  const sections = SECTION_SPEC.map((spec) => ({
    key: spec.key,
    title: spec.title,
    body: bodyByKey[spec.key] || "",
  })).filter((s) => s.body);
  if (sections.length === 0) {
    throw aiInvalid("Sage brief had no usable sections");
  }

  const marketing_insights = asArray(parsed.marketing_insights)
    .filter((m) => m && nonEmptyStr(m.insight) && nonEmptyStr(m.action))
    .map((m) => ({
      insight: cleanStr(m.insight),
      action: cleanStr(m.action),
      why: cleanStr(m.why),
    }))
    .slice(0, 8);

  const feed = normalizeFeed(parsed.feed, sources);

  return {
    industry: cleanStr(parsed.industry) || cleanStr(brand.industry),
    summary: cleanStr(parsed.summary),
    sections,
    marketing_insights,
    sources: sources.slice(0, 12),
    feed,
  };
}

/** Turn raw feed items into validated rows, backfilling urls from cited sources. */
function normalizeFeed(rawFeed, sources) {
  const fallbackUrl = sources[0] ? sources[0].url : null;
  const fallbackTitle = sources[0] ? sources[0].title : null;
  const out = [];
  const seen = new Set();
  for (const f of asArray(rawFeed)) {
    if (!f || !nonEmptyStr(f.summary) || !nonEmptyStr(f.why_it_matters)) continue;
    const summary = cleanStr(f.summary);
    const key = signalKey(summary);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // Match the item's declared url against a real cited source when possible.
    const matched =
      sources.find((s) => nonEmptyStr(f.url) && s.url === cleanStr(f.url)) || null;
    out.push({
      source_type: normType(f.source_type),
      summary,
      why_it_matters: cleanStr(f.why_it_matters),
      url: matched ? matched.url : nonEmptyStr(f.url) ? cleanStr(f.url) : fallbackUrl,
      source_title: matched ? matched.title : fallbackTitle,
      urgent: Boolean(f.urgent),
      signal_key: key,
    });
  }
  return out.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Urgent scan — a fast pass for time-sensitive signals (runs every 30 minutes)
// ---------------------------------------------------------------------------

const URGENT_SYSTEM = `You are Sage, EchoAI's Industry Intelligence Agent. Do a QUICK live web search for any BREAKING or TIME-SENSITIVE developments in this business's industry in the last few days: a new regulation about to take effect, a major competitor move, a sudden market shift, or a closing window of opportunity.

Only report things that are genuinely urgent and actionable right now. If nothing urgent is happening, return an empty list — do not manufacture urgency.

Ground every item in a real source you searched. Output ONE JSON object and nothing else:
{ "urgent": [ { "source_type": "trend|competitor|regulation|opportunity|threat|market", "summary": "the development", "why_it_matters": "why it needs attention now", "url": "source url" } ] }`;

/**
 * Fast urgent-signal scan. Returns { feed: [...] } of urgent items only (may be
 * empty — that's a valid, non-error outcome). Requires real citations only when
 * items are returned.
 */
async function urgentScan(brand, competitors) {
  const user = `Check for urgent, time-sensitive developments in this business's industry right now.\n\n${brandContext(
    brand,
    competitors,
  )}`;

  const resp = await createMessage(
    {
      model: MODEL,
      max_tokens: 1500,
      system: URGENT_SYSTEM,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [{ role: "user", content: user }],
    },
    { label: "Sage urgent scan", timeout: HEAVY_AI_TIMEOUT_MS, attempts: 2 },
  );

  const parsed = extractJson(textOf(resp));
  const items = asArray(parsed.urgent);
  if (items.length === 0) return { feed: [] };

  const sources = citationsOf(resp);
  if (sources.length === 0) {
    // Urgent claims with no real source are not trustworthy — drop them.
    return { feed: [] };
  }
  const feed = normalizeFeed(
    items.map((i) => ({ ...i, urgent: true })),
    sources,
  ).map((f) => ({ ...f, urgent: true }));
  return { feed };
}

// ---------------------------------------------------------------------------
// Competitor suggestion + refresh (live web search)
// ---------------------------------------------------------------------------

const SUGGEST_SYSTEM = `You are Sage, EchoAI's Industry Intelligence Agent. Using live web search, identify the REAL direct competitors of this business — companies actually operating in its space and (where possible) its geography. Only include competitors you can verify exist via search; never invent names.

Output ONE JSON object and nothing else:
{ "competitors": [ { "name": "...", "website": "https://...", "facebook_page": "https://facebook.com/...", "strategy_summary": "one line on how they market themselves" } ] }
Return 3-6 competitors. Omit website/facebook_page if you couldn't verify them.`;

async function suggestCompetitors(brand) {
  const resp = await createMessage(
    {
      model: MODEL,
      max_tokens: 1500,
      system: SUGGEST_SYSTEM,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      messages: [
        {
          role: "user",
          content: `Find the real direct competitors for this business.\n\n${brandContext(
            brand,
            [],
          )}`,
        },
      ],
    },
    { label: "Sage competitor suggest", timeout: HEAVY_AI_TIMEOUT_MS, attempts: 2 },
  );

  const sources = citationsOf(resp);
  if (sources.length === 0) {
    throw aiInvalid("Sage could not verify real competitors via web search");
  }
  const parsed = extractJson(textOf(resp));
  return asArray(parsed.competitors)
    .filter((c) => c && nonEmptyStr(c.name))
    .map((c) => ({
      name: cleanStr(c.name),
      website: cleanStr(c.website) || null,
      facebook_page: cleanStr(c.facebook_page) || null,
      strategy_summary: cleanStr(c.strategy_summary) || null,
    }))
    .slice(0, 6);
}

const REFRESH_SYSTEM = `You are Sage, EchoAI's Industry Intelligence Agent. Using live web search, get the CURRENT public marketing picture for this single competitor: approximate social following, how recently they posted, whether they appear to be running ads, and a one-line read of their marketing strategy. Only report what you can actually find via search; leave a field null if you can't verify it.

Output ONE JSON object and nothing else:
{ "follower_count": "e.g. 12.4K or null", "last_post": "recency/summary or null", "ad_activity": "what you see or null", "strategy_summary": "one line" }`;

async function refreshCompetitor(brand, competitor) {
  const resp = await createMessage(
    {
      model: MODEL,
      max_tokens: 1000,
      system: REFRESH_SYSTEM,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [
        {
          role: "user",
          content: `Get the current marketing picture for this competitor.\n\nCompetitor: ${
            competitor.name
          }${competitor.website ? ` (${competitor.website})` : ""}${
            competitor.facebook_page ? ` FB: ${competitor.facebook_page}` : ""
          }\n\nOf this business: ${brand.brand_name || ""}`,
        },
      ],
    },
    { label: "Sage competitor refresh", timeout: HEAVY_AI_TIMEOUT_MS, attempts: 2 },
  );

  const parsed = extractJson(textOf(resp));
  return {
    follower_count: cleanStr(parsed.follower_count) || null,
    last_post: cleanStr(parsed.last_post) || null,
    ad_activity: cleanStr(parsed.ad_activity) || null,
    strategy_summary: cleanStr(parsed.strategy_summary) || null,
  };
}

// ---------------------------------------------------------------------------
// Intelligence Input — analyze a submitted link / FB page / image / PDF
// ---------------------------------------------------------------------------

const SUBMIT_SYSTEM = `You are Sage, EchoAI's Industry Intelligence Agent. The business owner is handing you a piece of material (a competitor's page, an ad, an article, a screenshot, or a document). Analyze it and pull out what actually matters for THIS business's marketing strategy.

Output ONE JSON object and nothing else:
{ "title": "a short label for this submission", "summary": "what this material is and its key takeaway", "insights": [ { "insight": "a specific takeaway", "why": "why it matters to this business" } ] }
Provide 2-5 insights. Be concrete and honest — if the material isn't useful, say so.`;

/**
 * Analyze an owner-submitted piece of intelligence.
 * @param {object} brand
 * @param {object} submission
 *   - type: "link" | "facebook" | "image" | "pdf"
 *   - url: for link/facebook
 *   - dataBase64 + mediaType: for image/pdf
 *   - filename: original name (image/pdf)
 */
async function analyzeSubmission(brand, submission) {
  const type = submission.type;
  const content = [];
  const tools = [];

  if (type === "link" || type === "facebook") {
    if (!nonEmptyStr(submission.url)) throw aiInvalid("No URL provided to analyze");
    tools.push({ type: "web_fetch_20250910", name: "web_fetch", max_uses: 3 });
    content.push({
      type: "text",
      text: `Fetch and analyze this ${
        type === "facebook" ? "Facebook page" : "link"
      } for ${brand.brand_name || "this business"}: ${submission.url}`,
    });
  } else if (type === "image") {
    if (!nonEmptyStr(submission.dataBase64)) throw aiInvalid("No image data provided");
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: submission.mediaType || "image/png",
        data: submission.dataBase64,
      },
    });
    content.push({
      type: "text",
      text: `Analyze this image for ${brand.brand_name || "this business"}.`,
    });
  } else if (type === "pdf") {
    if (!nonEmptyStr(submission.dataBase64)) throw aiInvalid("No document data provided");
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: submission.dataBase64,
      },
    });
    content.push({
      type: "text",
      text: `Analyze this document for ${brand.brand_name || "this business"}.`,
    });
  } else {
    throw aiInvalid("Unsupported submission type");
  }

  const params = {
    model: MODEL,
    max_tokens: 1500,
    system: SUBMIT_SYSTEM,
    messages: [{ role: "user", content }],
  };
  if (tools.length) params.tools = tools;

  const resp = await createMessage(params, {
    label: "Sage submission analysis",
    timeout: HEAVY_AI_TIMEOUT_MS,
    attempts: 2,
  });

  const parsed = extractJson(textOf(resp));
  const insights = asArray(parsed.insights)
    .filter((i) => i && nonEmptyStr(i.insight))
    .map((i) => ({ insight: cleanStr(i.insight), why: cleanStr(i.why) }))
    .slice(0, 5);
  const summary = cleanStr(parsed.summary);
  if (!summary && insights.length === 0) {
    throw aiInvalid("Sage could not extract anything useful from the submission");
  }
  return {
    title: cleanStr(parsed.title) || cleanStr(submission.filename) || "Submission",
    summary,
    insights,
  };
}

module.exports = {
  deepResearch,
  urgentScan,
  suggestCompetitors,
  refreshCompetitor,
  analyzeSubmission,
  // exported for unit tests
  extractJson,
  citationsOf,
  textOf,
  signalKey,
  normalizeFeed,
  SECTION_SPEC,
};
