/**
 * Goal Setup Agent prompt (Prompt 67 — Target Goals & KPI Tracking).
 *
 * After the Setup Agent finishes for a new brand, Echo asks the owner about
 * their goals conversationally. This prompt turns whatever the owner says in
 * plain English ("I want about 40 leads a month and to keep cost per lead
 * under $15") into structured, measurable targets — but ONLY using metrics from
 * the brand's own catalog. Anything outside the catalog is ignored, never
 * invented.
 */

/**
 * Build the system prompt for parsing an owner's free-text goal description into
 * measurable targets drawn from the supplied catalog.
 *
 * @param {string} brandType - the brand's business type label/key (for context).
 * @param {Array<{metricKey:string,label:string,unit:string,direction:string,description:string}>} catalog
 * @returns {string}
 */
function buildGoalSetupPrompt(brandType, catalog) {
  const list = (Array.isArray(catalog) ? catalog : [])
    .map((c) => {
      const dir = c.direction === "decrease" ? "lower is better" : "higher is better";
      return `- ${c.metricKey} — ${c.label} (${c.unit}, ${dir}): ${c.description}`;
    })
    .join("\n");

  return [
    "You are Echo, an AI marketing director helping a business owner set their",
    "monthly targets. The owner will describe, in their own words, what they",
    "want to achieve. Your job is to translate that into concrete, measurable",
    "monthly targets.",
    "",
    `The business type is: ${brandType || "standard"}.`,
    "",
    "You may ONLY use these metrics (identified by metricKey). Never invent a",
    "metric that is not in this list, and never change a metric's meaning:",
    list || "(no metrics available)",
    "",
    "Rules:",
    "- Return targets only for metrics the owner actually referenced or clearly",
    "  implied. Do not pad the list with unrelated metrics.",
    "- targetValue must be a plain positive number (no units, no commas, no $).",
    "- For currency metrics use whole dollars; for ratio metrics use the multiple",
    "  (e.g. 3 means 3x); for count metrics use the count.",
    "- If the owner gives a range, use a single reasonable number from it.",
    "- If you cannot map anything to a catalog metric, return an empty array.",
    "",
    'Respond with ONLY a JSON object of the exact shape:',
    '{ "goals": [ { "metricKey": "<one of the keys above>", "targetValue": <number> } ] }',
    "No prose, no markdown fences — just the JSON object.",
  ].join("\n");
}

/**
 * Parse the model's raw text reply into a validated list of goal suggestions.
 * Pure + AI-independent so it can be unit-tested directly. Silently drops any
 * item whose metric is not in the catalog or whose target is not a valid
 * non-negative number — the wizard never fabricates goals.
 *
 * @param {string} rawText - the model's reply.
 * @param {Array<{metricKey:string}>} catalog - allowed metrics for this brand.
 * @returns {Array<{metricKey:string,targetValue:number}>}
 */
function parseGoalSuggestions(rawText, catalog) {
  if (typeof rawText !== "string" || !rawText.trim()) return [];
  const allowed = new Set(
    (Array.isArray(catalog) ? catalog : []).map((c) => c.metricKey)
  );

  const cleaned = rawText
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Best-effort: pull the first JSON object out of surrounding prose.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }

  const items = Array.isArray(parsed)
    ? parsed
    : parsed && Array.isArray(parsed.goals)
      ? parsed.goals
      : [];

  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const metricKey = item.metricKey;
    const targetValue = Number(item.targetValue);
    if (!allowed.has(metricKey)) continue;
    if (!Number.isFinite(targetValue) || targetValue < 0) continue;
    if (seen.has(metricKey)) continue;
    seen.add(metricKey);
    out.push({ metricKey, targetValue });
  }
  return out;
}

module.exports = { buildGoalSetupPrompt, parseGoalSuggestions };
