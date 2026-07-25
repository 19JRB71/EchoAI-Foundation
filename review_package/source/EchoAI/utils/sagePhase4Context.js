/**
 * Sage V2 Phase 4 — offers / constraints / executive-memory prompt context.
 *
 * phase4ContextForBrand(brandId, audience) returns the compact context block
 * appended to AI system prompts at the paid chokepoint (config/anthropic.js),
 * after the Company Truth digest. Each section is governed by its own flag
 * (SAGE_V2_OFFERS / SAGE_V2_CONSTRAINTS / SAGE_V2_EXEC_MEMORY, default OFF).
 *
 * ALLOWLIST RULE (CEO requirement): sensitive owner-private fields are
 * protected by an explicit allowlist, not by blocklist removal. The default
 * audience is "customer" (customer-facing surfaces: chatbot, autonomous
 * replies, ad/social/email copy) and receives ONLY the allowlisted public
 * offer fields — no constraints, no memories, never margin_note /
 * legal_notes / cash_flow_note. Owner-facing internal reasoning surfaces
 * must explicitly opt in with audience "internal" (opts.contextAudience).
 * Forgetting to opt in loses context; it can never leak.
 */

const db = require("../config/db");
const { getSwitch } = require("../config/aiControls");

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // `${brandId}:${audience}` -> { at, context }

// Sub-budgets so the combined tail stays bounded next to the 2400-char truth digest.
const MAX_OFFERS_CHARS = 700;
const MAX_CONSTRAINTS_CHARS = 500;
const MAX_MEMORY_CHARS = 700;

// Explicit allowlist of offer fields a CUSTOMER-FACING prompt may see.
const CUSTOMER_OFFER_FIELDS = ["name", "offer_type", "terms", "starts_at", "ends_at"];

function capText(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function fmtDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function offerLine(row, audience) {
  const parts = [`${row.name} (${row.offer_type})`];
  if (row.terms) parts.push(String(row.terms));
  const from = fmtDate(row.starts_at);
  const to = fmtDate(row.ends_at);
  if (from || to) parts.push(`runs ${from || "now"} to ${to || "open-ended"}`);
  // margin_note is NOT in CUSTOMER_OFFER_FIELDS: only the internal audience,
  // by explicit opt-in, ever sees it.
  if (audience === "internal" && row.margin_note) {
    parts.push(`[owner margin note: ${row.margin_note}]`);
  }
  return `- ${parts.join(" — ")}`;
}

async function offersSection(brandId, audience) {
  if (!(await getSwitch("SAGE_V2_OFFERS"))) return "";
  const { rows } = await db.query(
    `SELECT name, offer_type, terms, margin_note, starts_at, ends_at
       FROM sage_offers
      WHERE brand_id = $1 AND status = 'active'
        AND (starts_at IS NULL OR starts_at <= CURRENT_DATE)
        AND (ends_at IS NULL OR ends_at >= CURRENT_DATE)
      ORDER BY created_at DESC
      LIMIT 12`,
    [brandId],
  );
  if (!rows.length) return "";
  const body = capText(rows.map((r) => offerLine(r, audience)).join("\n"), MAX_OFFERS_CHARS);
  return [
    "CURRENT REAL OFFERS (owner-entered; only ever reference THESE offers — never invent a discount, guarantee, or promotion that is not listed here):",
    body,
  ].join("\n");
}

async function constraintsSection(brandId, audience) {
  if (audience !== "internal") return ""; // internal-only, allowlist by construction
  if (!(await getSwitch("SAGE_V2_CONSTRAINTS"))) return "";
  const { rows } = await db.query(
    `SELECT monthly_budget_cents, staff_count, weekly_capacity, blackout_dates,
            legal_notes, cash_flow_note
       FROM brand_constraints WHERE brand_id = $1`,
    [brandId],
  );
  const c = rows[0];
  if (!c) return "";
  const lines = [];
  if (c.monthly_budget_cents != null) {
    lines.push(`- Monthly marketing budget: $${(Number(c.monthly_budget_cents) / 100).toFixed(2)}`);
  }
  if (c.staff_count != null) lines.push(`- Staff count: ${c.staff_count}`);
  if (c.weekly_capacity != null) lines.push(`- Weekly job/lead capacity: ${c.weekly_capacity}`);
  if (Array.isArray(c.blackout_dates) && c.blackout_dates.length) {
    const spans = c.blackout_dates
      .filter((b) => b && (b.from || b.to))
      .map((b) => `${b.from || "…"}→${b.to || "…"}${b.label ? ` (${b.label})` : ""}`)
      .slice(0, 8);
    if (spans.length) lines.push(`- Blackout dates (cannot serve customers): ${spans.join(", ")}`);
  }
  if (c.legal_notes) lines.push(`- Legal/compliance notes: ${c.legal_notes}`);
  if (c.cash_flow_note) lines.push(`- Cash-flow note: ${c.cash_flow_note}`);
  if (!lines.length) return "";
  return [
    "BUSINESS CONSTRAINTS (owner-stated operating limits — recommendations must be feasible within them; missing values are simply unknown, never assume zero):",
    capText(lines.join("\n"), MAX_CONSTRAINTS_CHARS),
  ].join("\n");
}

async function memorySection(brandId, audience) {
  if (audience !== "internal") return ""; // internal-only, allowlist by construction
  if (!(await getSwitch("SAGE_V2_EXEC_MEMORY"))) return "";
  const { rows } = await db.query(
    `SELECT kind, content FROM sage_memory
      WHERE brand_id = $1 AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 10`,
    [brandId],
  );
  if (!rows.length) return "";
  const body = rows.map((r) => `- [${r.kind.replace(/_/g, " ")}] ${r.content}`).join("\n");
  return [
    "EXECUTIVE MEMORY (facts the owner explicitly told us to remember — treat as true):",
    capText(body, MAX_MEMORY_CHARS),
  ].join("\n");
}

/**
 * Combined Phase 4 context for a brand, or "" (flags off / no data / lookup
 * failure — a context outage must never take a department down).
 * audience: "customer" (default, allowlisted public offer fields only) or
 * "internal" (owner-facing reasoning surfaces, explicit opt-in).
 */
async function phase4ContextForBrand(brandId, audience = "customer") {
  if (!brandId) return "";
  const aud = audience === "internal" ? "internal" : "customer";
  const key = `${brandId}:${aud}`;
  try {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.context;
    const parts = await Promise.all([
      offersSection(brandId, aud),
      constraintsSection(brandId, aud),
      memorySection(brandId, aud),
    ]);
    const context = parts.filter(Boolean).join("\n\n");
    cache.set(key, { at: Date.now(), context });
    return context;
  } catch (err) {
    console.error("sagePhase4Context: lookup failed:", err.message);
    return "";
  }
}

function _resetCacheForTests() {
  cache.clear();
}

module.exports = {
  phase4ContextForBrand,
  CUSTOMER_OFFER_FIELDS,
  _resetCacheForTests,
};
