/**
 * Sage — Pattern Intelligence Engine prompts.
 *
 * PIE studies publicly available marketing to learn WHY campaigns work — never
 * to copy anyone. Two AI steps, both real and validated (aiInvalid → 502):
 *
 *  1. analyzeCampaigns — classifies REAL public ad text (from the Meta Ad
 *     Library) per the PIE spec: hook type, emotions targeted, copy traits.
 *     No web tools needed — the ad copy itself is the ground truth. Commercial
 *     Ad Library rows expose no engagement metrics and no media, so the
 *     analysis is text-only and never claims engagement or visual data.
 *
 *  2. buildPatternReport — turns the CODE-COMPUTED aggregates (real counts
 *     across all analyzed campaigns) plus live web research (Anthropic
 *     web_search, citations required) into an industry-wide intelligence
 *     report and a Creative Brief for Forge. Insights speak about patterns
 *     ("across N campaigns...") — never about a single competitor.
 */

const { createMessage, MODEL, HEAVY_AI_TIMEOUT_MS } = require("../config/anthropic");

/** Spec's hook taxonomy (classification targets, not content to invent). */
const HOOK_TYPES = [
  "Question",
  "Story",
  "Customer Problem",
  "Curiosity",
  "Bold Statement",
  "Statistic",
  "Demonstration",
  "Humor",
  "Emotional",
  "Before & After",
  "Testimonial",
  "Fear of Missing Out",
  "Urgency",
  "Local Connection",
  "Educational",
];

/** Spec's psychological targets. */
const EMOTIONS = [
  "Trust",
  "Curiosity",
  "Excitement",
  "Security",
  "Family",
  "Humor",
  "Pride",
  "Relief",
  "Urgency",
  "Luxury",
  "Confidence",
  "Community",
  "Belonging",
  "Achievement",
];

function aiInvalid(message) {
  const err = new Error(message || "AI produced no usable output");
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

/** Real web citations from the response (proof of live research). */
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
        if (c && (c.type === "web_search_result_location" || c.url)) add(c.url, c.title);
      }
    }
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) {
        if (r && r.type === "web_search_result") add(r.url, r.title);
      }
    }
  }
  return Array.from(byUrl.values());
}

function extractJson(text, opener = "{", closer = "}") {
  if (!text) throw aiInvalid("AI returned an empty response");
  const start = text.indexOf(opener);
  const end = text.lastIndexOf(closer);
  if (start === -1 || end === -1 || end <= start) {
    throw aiInvalid("AI response contained no JSON");
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (_e) {
    throw aiInvalid("AI response was not valid JSON");
  }
}

function cleanStr(v) {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

/**
 * Validate one campaign analysis object from the model. Returns a normalized
 * analysis or null (null = skip this campaign, don't fail the batch).
 */
function normalizeAnalysis(raw) {
  if (!raw || typeof raw !== "object") return null;
  const hook = cleanStr(raw.hook_type);
  if (!HOOK_TYPES.includes(hook)) return null;
  const emotions = (Array.isArray(raw.emotions) ? raw.emotions : [])
    .map(cleanStr)
    .filter((e) => EMOTIONS.includes(e))
    .slice(0, 4);
  const out = {
    hook_type: hook,
    hook_why: cleanStr(raw.hook_why).slice(0, 300),
    emotions,
    value_speed: ["immediate", "delayed", "unclear"].includes(raw.value_speed)
      ? raw.value_speed
      : "unclear",
    copy: {
      storytelling: Boolean(raw.copy && raw.copy.storytelling),
      educational: Boolean(raw.copy && raw.copy.educational),
      humor: Boolean(raw.copy && raw.copy.humor),
      scarcity: Boolean(raw.copy && raw.copy.scarcity),
      trust_signals: Boolean(raw.copy && raw.copy.trust_signals),
      customer_focused: Boolean(raw.copy && raw.copy.customer_focused),
      reading_level: ["simple", "moderate", "complex"].includes(
        raw.copy && raw.copy.reading_level
      )
        ? raw.copy.reading_level
        : "moderate",
    },
    cta_style: cleanStr(raw.cta_style).slice(0, 80) || null,
  };
  if (!out.hook_why) return null;
  return out;
}

const ANALYZE_SYSTEM = [
  "You are Sage, Zorecho's AI Marketing Intelligence Analyst. You are studying",
  "publicly available ads from the Meta Ad Library to understand WHY marketing",
  "works — never to copy it. You are given the REAL text of each ad (headline,",
  "body, call to action). Classify each ad's craft honestly:",
  `- hook_type: exactly one of: ${HOOK_TYPES.join(" | ")}`,
  "- hook_why: one sentence — why would someone stop scrolling for this?",
  `- emotions: up to 4 of: ${EMOTIONS.join(" | ")}`,
  "- value_speed: immediate | delayed | unclear — how fast value is communicated",
  "- copy: booleans {storytelling, educational, humor, scarcity, trust_signals,",
  "  customer_focused} and reading_level: simple | moderate | complex",
  "- cta_style: short label for the call-to-action approach, or null when the ad has none",
  "Base EVERY classification only on the ad text provided — never invent",
  "engagement numbers, visuals, or anything not present in the text.",
  'Return ONLY a JSON array, one object per ad IN ORDER, each: {"index": N, ...fields above}.',
].join("\n");

/**
 * Classify a batch of public ads (id + headline/body/cta text). Returns a map
 * of index → normalized analysis (unparseable individual entries are skipped).
 * Throws aiInvalid when the model returns nothing usable at all.
 */
async function analyzeCampaigns(brand, ads) {
  if (!Array.isArray(ads) || ads.length === 0) return new Map();
  const list = ads
    .map((ad, i) =>
      [
        `Ad ${i}:`,
        ad.headline ? `Headline: ${ad.headline}` : null,
        ad.body ? `Body: ${String(ad.body).slice(0, 900)}` : null,
        ad.cta ? `CTA: ${ad.cta}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
  const user = `Industry: ${brand.industry || "small business"}.\n\nPublic ads to classify:\n\n${list}`;
  const resp = await createMessage(
    {
      model: MODEL,
      max_tokens: Math.min(16000, 700 * ads.length + 1000),
      system: ANALYZE_SYSTEM,
      messages: [{ role: "user", content: user }],
    },
    { label: "Sage pattern analysis", timeout: HEAVY_AI_TIMEOUT_MS, attempts: 2 }
  );
  const arr = extractJson(textOf(resp), "[", "]");
  if (!Array.isArray(arr) || arr.length === 0) {
    throw aiInvalid("Pattern analysis returned no classifications");
  }
  const byIndex = new Map();
  for (const item of arr) {
    if (!item || !Number.isInteger(item.index)) continue;
    if (item.index < 0 || item.index >= ads.length) continue;
    const norm = normalizeAnalysis(item);
    if (norm) byIndex.set(item.index, norm);
  }
  if (byIndex.size === 0) throw aiInvalid("Pattern analysis produced no valid entries");
  return byIndex;
}

const REPORT_SYSTEM = [
  "You are Sage, Zorecho's AI Marketing Intelligence Analyst — NOT a competitor",
  "monitoring tool. Your job: explain what patterns consistently make people in",
  "this industry stop, engage, and convert — grounded ONLY in (a) the REAL",
  "aggregate statistics provided (computed from publicly available Meta Ad",
  "Library campaigns) and (b) your live web research of public marketing in",
  "this industry (public business pages, websites, reviews, press).",
  "",
  "Rules of honesty:",
  "- Speak in industry-wide patterns ('Across the analyzed campaigns...'),",
  "  never about one named competitor.",
  "- The Ad Library data has NO engagement metrics and NO images. Prevalence",
  "  among currently-running ads is a revealed preference — advertisers keep",
  "  paying for what works — describe it as prevalence, never as engagement.",
  "- Any claim beyond the provided statistics must come from your live web",
  "  research; never rely on training-data memory for current trends.",
  "- Never recommend imitating another company's branding, copy, imagery, or",
  "  distinctive creative assets. All guidance must drive ORIGINAL work.",
  "",
  "Return ONLY one JSON object:",
  '{"insights": [{"pattern": "one-sentence pattern", "evidence": "the real numbers/sources behind it", "why_it_works": "the psychology"}],',
  ' "forge_brief": {"objective": "...", "tone": "...", "visual_style": "...", "camera": "...", "copy_style": "...",',
  '   "recommended_hook": "...", "recommended_cta": "...", "recommended_story": "...", "color_palette": "..."}}',
  "insights: 4-8 items. forge_brief fields objective/tone/visual_style/camera/",
  "copy_style MUST be chosen from the allowed values given in the user message.",
].join("\n");

/**
 * Build the industry-wide pattern report + Forge Creative Brief.
 *
 * @param {object} brand
 * @param {object} aggregates - code-computed real stats (see patternIntelligence.aggregateAnalyses)
 * @param {object} pools - forgeDirector pools the brief must pick from
 * @returns {Promise<{insights, forge_brief, sources}>}
 */
async function buildPatternReport(brand, aggregates, pools) {
  const user = [
    `Industry: ${brand.industry || "small business"}.`,
    `Business: ${brand.brand_name || "(unknown)"} (do NOT research this business itself — research its industry).`,
    "",
    `REAL aggregate statistics from ${aggregates.sampleSize} publicly available campaigns analyzed so far:`,
    JSON.stringify(aggregates, null, 2),
    "",
    "Allowed forge_brief values (pick exactly one of each):",
    `objective: ${pools.objectives.join(" | ")}`,
    `tone: ${pools.tones.join(" | ")}`,
    `visual_style: ${pools.visualStyles.join(" | ")}`,
    `camera: ${pools.cameras.join(" | ")}`,
    `copy_style: ${pools.copyStyles.join(" | ")}`,
    "",
    "Research current public marketing patterns in this industry on the live web",
    "(seasonal trends, visual trends, offer styles), then produce the report.",
  ].join("\n");

  const resp = await createMessage(
    {
      model: MODEL,
      max_tokens: 4096,
      system: REPORT_SYSTEM,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      messages: [{ role: "user", content: user }],
    },
    { label: "Sage pattern report", timeout: HEAVY_AI_TIMEOUT_MS, attempts: 2 }
  );

  const sources = citationsOf(resp);
  const json = extractJson(textOf(resp));
  const insights = (Array.isArray(json.insights) ? json.insights : [])
    .map((i) => ({
      pattern: cleanStr(i && i.pattern),
      evidence: cleanStr(i && i.evidence),
      why_it_works: cleanStr(i && i.why_it_works),
    }))
    .filter((i) => i.pattern && i.why_it_works)
    .slice(0, 10);
  if (insights.length === 0) throw aiInvalid("Pattern report contained no insights");
  // Grounding gate: with zero analyzed campaigns the ONLY honest basis is live
  // web research — refuse an uncited report in that case.
  if (aggregates.sampleSize === 0 && sources.length === 0) {
    throw aiInvalid("Pattern report had no analyzed campaigns and no web citations");
  }

  const fb = json.forge_brief && typeof json.forge_brief === "object" ? json.forge_brief : {};
  const pick = (v, pool) => (pool.includes(cleanStr(v)) ? cleanStr(v) : null);
  const forgeBrief = {
    objective: pick(fb.objective, pools.objectives),
    tone: pick(fb.tone, pools.tones),
    visual_style: pick(fb.visual_style, pools.visualStyles),
    camera: pick(fb.camera, pools.cameras),
    copy_style: pick(fb.copy_style, pools.copyStyles),
    recommended_hook: cleanStr(fb.recommended_hook).slice(0, 200) || null,
    recommended_cta: cleanStr(fb.recommended_cta).slice(0, 200) || null,
    recommended_story: cleanStr(fb.recommended_story).slice(0, 300) || null,
    color_palette: cleanStr(fb.color_palette).slice(0, 120) || null,
  };
  const hasAnyRec = Object.values(forgeBrief).some((v) => v);

  return { insights, forge_brief: hasAnyRec ? forgeBrief : null, sources };
}

module.exports = {
  HOOK_TYPES,
  EMOTIONS,
  normalizeAnalysis,
  analyzeCampaigns,
  buildPatternReport,
};
