// ---------------------------------------------------------------------------
// Competitor Ad Spy BRAIN, powered by Hermes 4 (config/hermes.js).
//
// When Scout sees a brand-new competitor ad (one it has never recorded before),
// it asks Hermes — in ONE small, fast call — to read the ad against the owner's
// business and decide how threatening it is:
//
//   threatLevel:  none | watch | aggressive
//   angle:        the ad's core messaging angle (short label)
//   reason:       one honest sentence explaining the read
//
// Architecture split (see replit.md): Hermes does the thinking/deciding here;
// Claude writes the weekly report + counter-campaign copy (prompts/). Like the
// autonomous conversation brain, this is advisory + non-breaking: if Hermes is
// unconfigured, slow, or errors, classifyNewAds() returns null and the scan
// simply records the ads unclassified (no false "aggressive" alerts). NEVER
// throws into the scan.
// ---------------------------------------------------------------------------

const { createCompletion, hermesConfigured } = require("../config/hermes");

const VALID_LEVELS = new Set(["none", "watch", "aggressive"]);

function buildSystemPrompt() {
  return [
    "You are the reasoning core of Scout, Zorecho's competitive-intelligence agent.",
    "You are given ONE small business and a batch of BRAND-NEW competitor ads Scout just found running in the Facebook Ad Library.",
    "For EACH ad, decide — honestly, from the ad's actual words — how much of a competitive threat it is to THIS business right now.",
    "Never invent urgency that is not there. Most ads are routine ('none' or 'watch'). Reserve 'aggressive' for ads that directly attack this business's position: an aggressive offer that undercuts it (deep discount, 'zero down', 'beat any price'), a direct competitive claim, a land-grab on this business's core audience or service, or a limited-time push clearly aimed at pulling away its customers.",
    "",
    "threatLevel meanings:",
    "- none: generic branding/awareness ad, unrelated angle, or nothing that pressures this business.",
    "- watch: relevant/competing but routine — worth knowing, not urgent.",
    "- aggressive: a direct, potentially customer-pulling threat that the owner should hear about now.",
    "",
    "Return ONLY a JSON object (no prose, no markdown fences) with exactly this shape:",
    '{"ads": [ {"adArchiveId": "<the id given>", "threatLevel": "none|watch|aggressive", "angle": "<short label of the ad\'s core angle>", "reason": "<one honest sentence>"} ] }',
    "Include exactly one entry per ad given, echoing its adArchiveId. Output valid JSON only.",
  ].join("\n");
}

function buildUserPrompt(brand, ads) {
  const name = (brand && brand.brand_name) || "the business";
  const lines = [
    `BUSINESS: ${name}.`,
    brand && brand.brand_personality
      ? `Business personality: ${String(brand.brand_personality).slice(0, 300)}`
      : "",
    brand && brand.industry ? `Industry: ${String(brand.industry).slice(0, 120)}` : "",
    "",
    "BRAND-NEW competitor ads to triage:",
  ];
  ads.forEach((ad, i) => {
    const parts = [
      `${i + 1}. adArchiveId=${ad.adArchiveId} | competitor: ${ad.competitorName || "unknown"}`,
    ];
    if (ad.headline) parts.push(`headline: "${String(ad.headline).slice(0, 160)}"`);
    if (ad.body) parts.push(`copy: "${String(ad.body).replace(/\s+/g, " ").slice(0, 400)}"`);
    if (ad.cta) parts.push(`link caption: "${String(ad.cta).slice(0, 120)}"`);
    if (Array.isArray(ad.platforms) && ad.platforms.length)
      parts.push(`platforms: ${ad.platforms.join("/")}`);
    if (ad.deliveryStart) parts.push(`running since: ${ad.deliveryStart}`);
    lines.push(parts.join(" | "));
  });
  lines.push("", "Triage every ad and return the JSON object now.");
  return lines.filter((l) => l !== null && l !== undefined).join("\n");
}

/** Parse Hermes's reply into a { adArchiveId -> classification } map, or null. */
function parseClassification(raw) {
  if (!raw || typeof raw !== "string") return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const arr = obj && Array.isArray(obj.ads) ? obj.ads : null;
  if (!arr) return null;
  const map = {};
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    const id = entry.adArchiveId != null ? String(entry.adArchiveId).trim() : "";
    if (!id) continue;
    const level = String(entry.threatLevel || "").toLowerCase().trim();
    map[id] = {
      threatLevel: VALID_LEVELS.has(level) ? level : "none",
      angle: typeof entry.angle === "string" ? entry.angle.trim().slice(0, 80) : "",
      reason: typeof entry.reason === "string" ? entry.reason.trim().slice(0, 300) : "",
    };
  }
  return map;
}

/**
 * Classify a batch of brand-new competitor ads. Returns a map keyed by
 * adArchiveId, or null when the brain is unavailable (scan records them
 * unclassified). NEVER throws.
 *
 * @param {object} brand
 * @param {Array}  ads   normalized ads from competitorAdLibrary
 */
async function classifyNewAds(brand, ads) {
  if (!hermesConfigured()) return null;
  if (!Array.isArray(ads) || ads.length === 0) return {};
  const batch = ads.slice(0, 20);
  try {
    const raw = await createCompletion(
      {
        system: buildSystemPrompt(),
        messages: [{ role: "user", content: buildUserPrompt(brand, batch) }],
        max_tokens: 900,
        temperature: 0.2,
      },
      {
        label: "Competitor ad brain",
        timeout: Number(process.env.HERMES_ORCHESTRATOR_TIMEOUT_MS) || 8000,
        attempts: 1,
      },
    );
    return parseClassification(raw);
  } catch (err) {
    console.error(
      "Competitor ad brain (Hermes) unavailable — recording ads unclassified:",
      err.message,
    );
    return null;
  }
}

module.exports = {
  classifyNewAds,
  parseClassification,
  buildSystemPrompt,
  VALID_LEVELS,
};
