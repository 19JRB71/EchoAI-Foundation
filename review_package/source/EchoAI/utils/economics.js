const db = require("../config/db");
const { computeMonthlyTotal } = require("../config/plans");

/**
 * Private owner AI-economics engine (admin-only, never customer-visible).
 *
 * Revenue comes from active paid subscriptions priced by config/plans.js
 * (base tier + per-seat add-on — the same math the billing UI shows). Cost
 * comes from the central ai_usage_log ledger, which records every paid
 * operation: LLM calls, voice synthesis, telephony minutes, SMS segments and
 * email sends. All figures are month-to-date UTC and ESTIMATES — provider
 * reconciliation is a later approved phase.
 *
 * Demo brands and the platform admin's own usage are broken out (not hidden)
 * so margin math can be read both ways.
 */

const MONTH = "at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'";

async function computeEconomics() {
  const [subs, totals, perUser, perBrand, byAgent, byFeature, byProvider, orchestrator] =
    await Promise.all([
      db.query(
        `SELECT s.user_id, s.subscription_tier, u.email, u.team_size,
                COALESCE(u.role, 'user') AS role, COALESCE(u.is_beta, false) AS is_beta
           FROM subscriptions s
           JOIN users u ON u.user_id = s.user_id
          WHERE s.payment_status = 'active'
            AND s.subscription_tier IS NOT NULL
            AND s.subscription_tier::text NOT IN ('free')`,
      ),
      db.query(
        `SELECT
           COALESCE(SUM(estimated_cost_usd) FILTER (WHERE ${MONTH}), 0) AS month_cost,
           COALESCE(SUM(estimated_cost_usd) FILTER (WHERE ${MONTH} AND triggered_by = 'background'), 0) AS background_cost,
           COALESCE(SUM(estimated_cost_usd) FILTER (WHERE ${MONTH} AND environment <> 'production'), 0) AS dev_cost,
           COUNT(*) FILTER (WHERE ${MONTH}) AS month_calls
         FROM ai_usage_log`,
      ),
      db.query(
        `SELECT l.user_id, u.email, COALESCE(SUM(l.estimated_cost_usd), 0) AS cost, COUNT(*) AS calls
           FROM ai_usage_log l
           LEFT JOIN users u ON u.user_id::text = l.user_id::text
          WHERE ${MONTH.replace(/at >=/, "l.at >=")} AND l.user_id IS NOT NULL
          GROUP BY l.user_id, u.email ORDER BY cost DESC LIMIT 50`,
      ),
      db.query(
        `SELECT l.brand_id, b.brand_name, COALESCE(b.is_demo, false) AS is_demo,
                COALESCE(SUM(l.estimated_cost_usd), 0) AS cost, COUNT(*) AS calls
           FROM ai_usage_log l
           LEFT JOIN brands b ON b.brand_id::text = l.brand_id::text
          WHERE ${MONTH.replace(/at >=/, "l.at >=")} AND l.brand_id IS NOT NULL
          GROUP BY l.brand_id, b.brand_name, b.is_demo ORDER BY cost DESC LIMIT 50`,
      ),
      db.query(
        `SELECT COALESCE(agent, 'unattributed') AS agent,
                COALESCE(SUM(estimated_cost_usd), 0) AS cost, COUNT(*) AS calls
           FROM ai_usage_log WHERE ${MONTH}
          GROUP BY agent ORDER BY cost DESC LIMIT 20`,
      ),
      db.query(
        `SELECT feature, COALESCE(SUM(estimated_cost_usd), 0) AS cost, COUNT(*) AS calls
           FROM ai_usage_log WHERE ${MONTH}
          GROUP BY feature ORDER BY cost DESC LIMIT 25`,
      ),
      db.query(
        `SELECT provider, COALESCE(unit_type, 'tokens') AS unit_type,
                COALESCE(SUM(estimated_cost_usd), 0) AS cost,
                COALESCE(SUM(unit_quantity), 0) AS units, COUNT(*) AS calls
           FROM ai_usage_log WHERE ${MONTH}
          GROUP BY provider, unit_type ORDER BY cost DESC`,
      ),
      // Echo Orchestrator = the Hermes decision brain + everything labeled echo.
      db.query(
        `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS cost, COUNT(*) AS calls
           FROM ai_usage_log
          WHERE ${MONTH} AND (provider = 'hermes' OR agent = 'echo')`,
      ),
    ]);

  // ---- Revenue (monthly run-rate from active paid subscriptions) ----------
  const customers = subs.rows.filter((r) => r.role !== "admin");
  const revenue = customers.reduce(
    (sum, r) => sum + computeMonthlyTotal(r.subscription_tier, Number(r.team_size) || 1),
    0,
  );
  const revenueByUser = new Map(
    customers.map((r) => [
      String(r.user_id),
      computeMonthlyTotal(r.subscription_tier, Number(r.team_size) || 1),
    ]),
  );

  // ---- Cost ---------------------------------------------------------------
  const t = totals.rows[0] || {};
  const totalCost = Number(t.month_cost) || 0;
  const backgroundCost = Number(t.background_cost) || 0;
  const orch = orchestrator.rows[0] || {};

  const users = perUser.rows.map((r) => ({
    userId: r.user_id,
    email: r.email || null,
    cost: Number(r.cost) || 0,
    calls: Number(r.calls) || 0,
    monthlyRevenue: revenueByUser.get(String(r.user_id)) ?? 0,
    monthlyProfit:
      (revenueByUser.get(String(r.user_id)) ?? 0) - (Number(r.cost) || 0),
  }));
  const payingWithCost = users.filter((u) => u.monthlyRevenue > 0);
  const mostExpensiveCustomer = payingWithCost[0] || users[0] || null;
  const mostProfitableCustomer =
    payingWithCost.slice().sort((a, b) => b.monthlyProfit - a.monthlyProfit)[0] || null;

  // ---- Projection: month-to-date run-rate ---------------------------------
  const now = new Date();
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const projectedCost = dayOfMonth > 0 ? (totalCost / dayOfMonth) * daysInMonth : 0;

  const round2 = (n) => Math.round(n * 100) / 100;
  const grossProfit = revenue - totalCost;
  const projectedProfit = revenue - projectedCost;

  return {
    asOf: now.toISOString(),
    basis: "Month-to-date, UTC. All AI costs are internal ESTIMATES (reconciliation is a later phase).",
    revenue: {
      totalMonthly: round2(revenue),
      payingCustomers: customers.length,
      byTier: customers.reduce((acc, r) => {
        acc[r.subscription_tier] = (acc[r.subscription_tier] || 0) + 1;
        return acc;
      }, {}),
    },
    cost: {
      totalMonthToDate: round2(totalCost),
      backgroundAutomation: round2(backgroundCost),
      echoOrchestrator: round2(Number(orch.cost) || 0),
      nonProduction: round2(Number(t.dev_cost) || 0),
      callsMonthToDate: Number(t.month_calls) || 0,
    },
    margin: {
      grossProfit: round2(grossProfit),
      grossMarginPct: revenue > 0 ? round2((grossProfit / revenue) * 100) : null,
      aiCostPerCustomer: customers.length > 0 ? round2(totalCost / customers.length) : null,
      aiCostPerBusiness:
        perBrand.rows.length > 0 ? round2(totalCost / perBrand.rows.length) : null,
    },
    projection: {
      projectedMonthlyAiBill: round2(projectedCost),
      projectedGrossProfit: round2(projectedProfit),
      projectedGrossMarginPct: revenue > 0 ? round2((projectedProfit / revenue) * 100) : null,
    },
    mostExpensiveCustomer,
    mostProfitableCustomer,
    topCustomers: users.slice(0, 10),
    topBusinesses: perBrand.rows.slice(0, 10).map((r) => ({
      brandId: r.brand_id,
      brandName: r.brand_name || null,
      isDemo: r.is_demo === true,
      cost: round2(Number(r.cost) || 0),
      calls: Number(r.calls) || 0,
    })),
    byAgent: byAgent.rows.map((r) => ({ agent: r.agent, cost: round2(Number(r.cost) || 0), calls: Number(r.calls) || 0 })),
    byFeature: byFeature.rows.map((r) => ({ feature: r.feature, cost: round2(Number(r.cost) || 0), calls: Number(r.calls) || 0 })),
    byProviderUnit: byProvider.rows.map((r) => ({
      provider: r.provider,
      unitType: r.unit_type,
      cost: round2(Number(r.cost) || 0),
      units: Number(r.units) || 0,
      calls: Number(r.calls) || 0,
    })),
  };
}

/**
 * Every ledger row in one workflow chain, cheapest-first drill-down for
 * "why did this request cost that much?".
 */
async function getWorkflowDetail(workflowId) {
  const r = await db.query(
    `SELECT at, provider, model, agent, feature, job_name, triggered_by,
            input_tokens, output_tokens, unit_type, unit_quantity,
            estimated_cost_usd, duration_ms, success, error_category, request_id,
            parent_request_id
       FROM ai_usage_log
      WHERE workflow_id = $1
      ORDER BY at ASC
      LIMIT 500`,
    [workflowId],
  );
  const totalCost = r.rows.reduce((s, row) => s + (Number(row.estimated_cost_usd) || 0), 0);
  return { workflowId, calls: r.rows.length, totalCostUsd: Math.round(totalCost * 1e6) / 1e6, steps: r.rows };
}

module.exports = { computeEconomics, getWorkflowDetail };
