/**
 * Sage V2 Phase 6 — self-evaluation scorecard (§11–12).
 *
 * Deterministic aggregation ONLY (no AI): Sage grades its own past
 * recommendations from real rows — sage_decisions (approved/declined),
 * sage_opportunities terminal statuses (succeeded/failed/inconclusive),
 * Phase 3 outcome coverage, and the AI-cost ledger (cost per approved
 * recommendation).
 *
 * Honesty rules:
 *  - Denominators always stated: "measured N of M approved" — win rate is
 *    never computed over only the measurable subset without saying so.
 *  - Inconclusive is its own first-class bucket, never counted as a win.
 *  - Missing/unmeasurable data reports as insufficient, never as zero wins.
 *
 * Cached per (brand, period) in sage_self_eval; recomputable at any time.
 * The nightly sage-opportunity-maintenance job refreshes caches (flag-gated,
 * SQL only).
 */

const db = require("../config/db");
const { getSwitch } = require("../config/aiControls");

const PERIODS = { "90d": "90 days", all: null };

/** Pure classifier used by tests: build the aggregates object from raw counts. */
function buildAggregates({ proposed, approved, declined, expired, wins, misses, inconclusive, measured, aiCostUsd }) {
  const measurable = wins + misses + inconclusive;
  return {
    recommendations_proposed: proposed,
    approved,
    declined,
    expired,
    measured_of_approved: { measured: measurable, of: approved },
    wins,
    misses,
    inconclusive,
    not_yet_measurable: Math.max(0, approved - measurable),
    outcome_rows_used: measured,
    ai_cost_cents: aiCostUsd == null ? null : Math.round(aiCostUsd * 100),
    cost_per_approved_cents:
      aiCostUsd == null || approved === 0 ? null : Math.round((aiCostUsd * 100) / approved),
    cost_per_approved_reason:
      approved === 0 ? "no_approved_recommendations_yet" : aiCostUsd == null ? "no_cost_ledger_rows" : null,
  };
}

async function computeForBrand(brandId, period = "90d") {
  const interval = PERIODS[period] === undefined ? PERIODS["90d"] : PERIODS[period];
  const windowClause = interval ? `AND created_at > NOW() - INTERVAL '${interval}'` : "";

  const [opps, decisions, cost] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS proposed,
              COUNT(*) FILTER (WHERE status = 'succeeded')::int AS wins,
              COUNT(*) FILTER (WHERE status = 'failed')::int AS misses,
              COUNT(*) FILTER (WHERE status = 'inconclusive')::int AS inconclusive,
              COUNT(*) FILTER (WHERE status = 'expired')::int AS expired,
              COUNT(*) FILTER (WHERE measured_result IS NOT NULL)::int AS measured
         FROM sage_opportunities
        WHERE brand_id = $1 ${windowClause}`,
      [brandId],
    ),
    db.query(
      `SELECT COUNT(*) FILTER (WHERE decided = 'approved')::int AS approved,
              COUNT(*) FILTER (WHERE decided = 'declined')::int AS declined
         FROM sage_decisions
        WHERE brand_id = $1 AND subject_type = 'opportunity' ${windowClause}`,
      [brandId],
    ),
    db
      .query(
        `SELECT SUM(estimated_cost_usd)::float AS usd, COUNT(*)::int AS n
           FROM ai_usage_log
          WHERE brand_id = $1 AND feature LIKE 'sage%' ${interval ? `AND at > NOW() - INTERVAL '${interval}'` : ""}`,
        [brandId],
      )
      .catch(() => ({ rows: [{ usd: null, n: 0 }] })),
  ]);

  const o = opps.rows[0];
  const d = decisions.rows[0];
  const c = cost.rows[0];
  return buildAggregates({
    proposed: o.proposed,
    approved: d.approved,
    declined: d.declined,
    expired: o.expired,
    wins: o.wins,
    misses: o.misses,
    inconclusive: o.inconclusive,
    measured: o.measured,
    aiCostUsd: c.n > 0 && c.usd != null ? Number(c.usd) : null,
  });
}

/** Compute + cache. Returns { enabled:false } when dark. */
async function getSelfEval(brandId, period = "90d") {
  if (!(await getSwitch("SAGE_V2_SELF_EVAL"))) return { enabled: false };
  const key = PERIODS[period] === undefined ? "90d" : period;
  const aggregates = await computeForBrand(brandId, key);
  await db.query(
    `INSERT INTO sage_self_eval (brand_id, period, aggregates, computed_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (brand_id, period)
     DO UPDATE SET aggregates = EXCLUDED.aggregates, computed_at = NOW()`,
    [brandId, key, JSON.stringify(aggregates)],
  );
  return { enabled: true, period: key, aggregates };
}

/**
 * Nightly cache refresh for real (non-demo) brands with any Sage decision
 * history. Deterministic SQL only — zero AI. No-op when dark.
 */
async function refreshSelfEvalCaches() {
  if (!(await getSwitch("SAGE_V2_SELF_EVAL"))) return { refreshed: 0 };
  const { rows } = await db.query(
    `SELECT DISTINCT d.brand_id
       FROM sage_decisions d
       JOIN brands b ON b.brand_id = d.brand_id
      WHERE COALESCE(b.is_demo, false) = false`,
  );
  let refreshed = 0;
  for (const row of rows) {
    try {
      const aggregates = await computeForBrand(row.brand_id, "90d");
      await db.query(
        `INSERT INTO sage_self_eval (brand_id, period, aggregates, computed_at)
         VALUES ($1, '90d', $2::jsonb, NOW())
         ON CONFLICT (brand_id, period)
         DO UPDATE SET aggregates = EXCLUDED.aggregates, computed_at = NOW()`,
        [row.brand_id, JSON.stringify(aggregates)],
      );
      refreshed += 1;
    } catch (err) {
      console.error(`Self-eval refresh failed for brand ${row.brand_id}:`, err.message);
    }
  }
  return { refreshed };
}

module.exports = { getSelfEval, refreshSelfEvalCaches, computeForBrand, buildAggregates };
