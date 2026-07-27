/**
 * Sage V2 Phase 1 — Company Truth consumption (SAGE_V2_CONTEXT flag).
 *
 * companyContextForBrand(brandId) returns a compact (~600 token) digest of the
 * brand's APPROVED Company Truth for injection into any department's AI system
 * prompt. Rules (per the approved architecture):
 *   - Only the approved report is ever used — never drafts, never pending.
 *   - Flag off → empty string (dark; zero behavior change).
 *   - No approved Truth → empty string + the per-brand "flying blind" counter
 *     is incremented (best-effort, never blocks the caller).
 *   - Result cached in-memory 15 minutes per brand (hit AND miss).
 *
 * withCompanyContext(systemPrompt, brandId) is the one-line wrapper controllers
 * use: appends the digest section to a built system prompt when available.
 */

// NOTE: this module is required by config/anthropic.js (the paid chokepoint),
// so it must NOT import controllers/companyTruthController (which imports the
// chokepoint back — circular require). It reads the approved report directly;
// the status='approved' filter matches getApprovedCompanyTruth exactly.
const db = require("../config/db");
const { getSwitch } = require("../config/aiControls");

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_DIGEST_CHARS = 2400; // ~600 tokens
const cache = new Map(); // brandId -> { at, context }

// Report sections worth injecting, in priority order (identity first so
// truncation always keeps the most important facts).
const SECTION_ORDER = [
  ["identity", "Identity"],
  ["products", "Products & services"],
  ["pricing", "Pricing"],
  ["serviceArea", "Service area"],
  ["targetCustomers", "Target customers"],
  ["businessModel", "Business model"],
  ["values", "Values & voice"],
  ["strengths", "Strengths"],
  ["competitors", "Competitors"],
  ["terminology", "Terminology"],
  ["excludedCategories", "Never offer / excluded"],
  ["currentMarketing", "Current marketing"],
];

function sectionToText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map((v) => sectionToText(v)).filter(Boolean).join("; ");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([k, v]) => {
        const text = sectionToText(v);
        return text ? `${k}: ${text}` : "";
      })
      .filter(Boolean)
      .join("; ");
  }
  return String(value);
}

/** Build the compact digest from an approved report's JSONB body. */
function buildDigest(report) {
  const body = report && report.report;
  if (!body || typeof body !== "object") return "";
  const lines = [];
  for (const [key, label] of SECTION_ORDER) {
    const text = sectionToText(body[key]);
    if (text) lines.push(`${label}: ${text}`);
  }
  if (!lines.length) return "";
  let digest = lines.join("\n");
  if (digest.length > MAX_DIGEST_CHARS) {
    digest = `${digest.slice(0, MAX_DIGEST_CHARS - 1).trimEnd()}…`;
  }
  return [
    "COMPANY TRUTH (owner-approved facts about this business — authoritative; never contradict them; prefer them over guesses):",
    digest,
  ].join("\n");
}

/** Best-effort flying-blind increment; never throws, never blocks. */
async function recordFlyingBlind(brandId) {
  try {
    await db.query(
      `INSERT INTO sage_context_stats (brand_id, flying_blind_count, last_flying_blind_at)
       VALUES ($1, 1, NOW())
       ON CONFLICT (brand_id) DO UPDATE SET
         flying_blind_count = sage_context_stats.flying_blind_count + 1,
         last_flying_blind_at = NOW()`,
      [brandId],
    );
  } catch (err) {
    console.error("companyContext: flying-blind record failed:", err.message);
  }
}

/**
 * The Company Truth digest for a brand, or "" (flag off / no approved truth /
 * lookup failure — a truth outage must never take a department down).
 */
async function companyContextForBrand(brandId) {
  if (!brandId) return "";
  try {
    if (!(await getSwitch("SAGE_V2_CONTEXT"))) return "";
    const cached = cache.get(brandId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.context;
    const { rows } = await db.query(
      `SELECT report FROM company_truth_reports
        WHERE brand_id = $1 AND status = 'approved'`,
      [brandId],
    );
    const context = rows.length ? buildDigest(rows[0]) : "";
    cache.set(brandId, { at: Date.now(), context });
    if (!context) recordFlyingBlind(brandId); // fire-and-forget, once per cache window
    return context;
  } catch (err) {
    console.error("companyContext: lookup failed:", err.message);
    return "";
  }
}

/** Append the Company Truth digest to a built system prompt (no-op when dark). */
async function withCompanyContext(systemPrompt, brandId) {
  const context = await companyContextForBrand(brandId);
  if (!context) return systemPrompt;
  return `${systemPrompt}\n\n${context}`;
}

/** Flying-blind stats for the Sage page / Echo nudge (null when never counted). */
async function getFlyingBlindStats(brandId) {
  const { rows } = await db.query(
    `SELECT flying_blind_count, last_flying_blind_at
       FROM sage_context_stats WHERE brand_id = $1`,
    [brandId],
  );
  if (!rows.length) return null;
  return {
    flyingBlindCount: rows[0].flying_blind_count,
    lastFlyingBlindAt: rows[0].last_flying_blind_at,
  };
}

function _resetCacheForTests() {
  cache.clear();
}

module.exports = {
  companyContextForBrand,
  withCompanyContext,
  getFlyingBlindStats,
  buildDigest,
  _resetCacheForTests,
};
