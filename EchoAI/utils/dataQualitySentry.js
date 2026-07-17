/**
 * Data-quality sentry (Sage V2 Phase 2, §3.3). Nightly, DETERMINISTIC SQL
 * only — zero AI calls, so every flag is traceable to a rule id and nothing
 * can be invented. Output = rows in sage_data_quality_flags; existing nudge
 * surfaces read them (nothing here alerts directly).
 *
 * Behind SAGE_V2_DQ_SENTRY (default OFF => runNightlySentry no-ops).
 *
 * Dedup: one OPEN flag per (brand, rule, subject) via the partial unique
 * index uq_sage_dq_open — re-detection while a flag is open is a no-op
 * (ON CONFLICT DO NOTHING), and a resolved/dismissed flag can be re-raised.
 *
 * Rules:
 *   conflicting_items      — two ACTIVE intel items in the same signal_key
 *                            family disagree on urgency; both surfaced,
 *                            conflict_of set on the newer one.
 *   stale_company_truth    — approved Company Truth older than N days while
 *                            material business inputs changed after approval.
 *   coverage_gap_analytics — brand has active campaigns but no analytics
 *                            rows recorded this week.
 */

const db = require("../config/db");
const { getSwitch } = require("../config/aiControls");

const STALE_TRUTH_DAYS = 45;

/** signal_key family: the key minus its trailing date/bucket segment, so
 *  "trend:pricing:2026-07-16" and "trend:pricing:2026-07-17" are family. */
const FAMILY_EXPR = `regexp_replace(signal_key, ':[0-9]{4}-[0-9]{2}-[0-9]{2}.*$', '')`;

async function raiseFlag(brandId, ruleId, dedupKey, severity, message, details) {
  await db.query(
    `INSERT INTO sage_data_quality_flags (brand_id, rule_id, dedup_key, severity, message, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (brand_id, rule_id, dedup_key) WHERE status = 'open' DO NOTHING`,
    [brandId, ruleId, dedupKey, severity, message, JSON.stringify(details || {})],
  );
}

/** Rule 1: contradictory active items (same family, conflicting urgency). */
async function sweepConflictingItems() {
  const { rows } = await db.query(
    `SELECT a.brand_id,
            a.item_id AS older_id, a.summary AS older_summary, a.urgent AS older_urgent,
            b.item_id AS newer_id, b.summary AS newer_summary, b.urgent AS newer_urgent,
            ${FAMILY_EXPR.replace(/signal_key/g, "a.signal_key")} AS family
       FROM sage_intel_items a
       JOIN sage_intel_items b
         ON b.brand_id = a.brand_id
        AND b.item_id <> a.item_id
        AND b.created_at > a.created_at
        AND ${FAMILY_EXPR.replace(/signal_key/g, "a.signal_key")} =
            ${FAMILY_EXPR.replace(/signal_key/g, "b.signal_key")}
        AND a.urgent <> b.urgent
      WHERE a.dismissed_at IS NULL AND b.dismissed_at IS NULL
        AND (a.expires_at IS NULL OR a.expires_at > NOW())
        AND (b.expires_at IS NULL OR b.expires_at > NOW())`,
  );
  let flagged = 0;
  for (const r of rows) {
    // Mark the newer item as conflicting with the older (idempotent).
    await db.query(
      `UPDATE sage_intel_items SET conflict_of = $2
        WHERE item_id = $1 AND conflict_of IS DISTINCT FROM $2`,
      [r.newer_id, r.older_id],
    );
    await raiseFlag(
      r.brand_id,
      "conflicting_items",
      `${r.family}`,
      "warning",
      `Two active intelligence items about "${r.family}" disagree on urgency — both are shown so nothing is hidden.`,
      { older_id: r.older_id, newer_id: r.newer_id, older_urgent: r.older_urgent, newer_urgent: r.newer_urgent },
    );
    flagged += 1;
  }
  return flagged;
}

/** Rule 2: approved Company Truth is old AND material inputs changed since. */
async function sweepStaleCompanyTruth() {
  const { rows } = await db.query(
    `SELECT t.brand_id, t.version, t.updated_at
       FROM company_truth_reports t
       JOIN brands b ON b.brand_id = t.brand_id
      WHERE t.status = 'approved'
        AND t.updated_at < NOW() - INTERVAL '${STALE_TRUTH_DAYS} days'
        AND b.updated_at > t.updated_at`,
  );
  for (const r of rows) {
    await raiseFlag(
      r.brand_id,
      "stale_company_truth",
      `v${r.version}`,
      "warning",
      `The approved Company Truth (v${r.version}) is over ${STALE_TRUTH_DAYS} days old and the business profile has changed since — worth regenerating and re-approving.`,
      { version: r.version, approved_updated_at: r.updated_at },
    );
  }
  return rows.length;
}

/** Rule 3: active campaigns but no analytics rows this week. */
async function sweepAnalyticsCoverageGaps() {
  const { rows } = await db.query(
    `SELECT DISTINCT c.brand_id
       FROM campaigns c
       JOIN brands b ON b.brand_id = c.brand_id AND b.is_demo = false
      WHERE c.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM analytics a
           WHERE a.brand_id = c.brand_id
             AND a.created_at > NOW() - INTERVAL '7 days'
        )`,
  );
  const weekKey = new Date().toISOString().slice(0, 10);
  for (const r of rows) {
    await raiseFlag(
      r.brand_id,
      "coverage_gap_analytics",
      `week:${weekKey}`,
      "info",
      "This brand has active campaigns but no analytics were recorded in the past 7 days — reporting may be flying blind.",
      { detected_on: weekKey },
    );
  }
  return rows.length;
}

/** Resolve open flags whose condition no longer holds (self-healing, still
 *  deterministic): analytics gaps close once fresh rows appear; conflict
 *  flags close once one side is dismissed/expired. */
async function resolveHealedFlags() {
  await db.query(
    `UPDATE sage_data_quality_flags f
        SET status = 'resolved', resolved_at = NOW()
      WHERE f.status = 'open' AND f.rule_id = 'coverage_gap_analytics'
        AND EXISTS (SELECT 1 FROM analytics a
                     WHERE a.brand_id = f.brand_id
                       AND a.created_at > NOW() - INTERVAL '7 days')`,
  );
  await db.query(
    `UPDATE sage_data_quality_flags f
        SET status = 'resolved', resolved_at = NOW()
      WHERE f.status = 'open' AND f.rule_id = 'conflicting_items'
        AND (
          (f.details->>'older_id') IS NOT NULL AND (f.details->>'newer_id') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM sage_intel_items a, sage_intel_items b
             WHERE a.item_id = (f.details->>'older_id')::uuid
               AND b.item_id = (f.details->>'newer_id')::uuid
               AND a.dismissed_at IS NULL AND b.dismissed_at IS NULL
               AND (a.expires_at IS NULL OR a.expires_at > NOW())
               AND (b.expires_at IS NULL OR b.expires_at > NOW())
          )
        )`,
  );
}

/** Nightly entry point (scheduler). No-ops with the flag off. Each rule is
 *  guarded so one failure never stops the rest (house sweep-guard seam). */
async function runNightlySentry() {
  if (!(await getSwitch("SAGE_V2_DQ_SENTRY").catch(() => false))) return;
  const results = {};
  for (const [name, fn] of [
    ["conflicting_items", module.exports.sweepConflictingItems],
    ["stale_company_truth", module.exports.sweepStaleCompanyTruth],
    ["coverage_gap_analytics", module.exports.sweepAnalyticsCoverageGaps],
    ["resolve_healed", module.exports.resolveHealedFlags],
  ]) {
    try {
      results[name] = await fn();
    } catch (err) {
      console.error(`Data-quality sentry rule ${name} failed:`, err.message);
    }
  }
  console.log(
    `Data-quality sentry complete: ${results.conflicting_items || 0} conflict(s), ` +
      `${results.stale_company_truth || 0} stale truth(s), ${results.coverage_gap_analytics || 0} coverage gap(s).`,
  );
}

module.exports = {
  runNightlySentry,
  sweepConflictingItems,
  sweepStaleCompanyTruth,
  sweepAnalyticsCoverageGaps,
  resolveHealedFlags,
  STALE_TRUTH_DAYS,
};
