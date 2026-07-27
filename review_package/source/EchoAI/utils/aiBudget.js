const db = require("../config/db");
const { getNumber } = require("../config/aiControls");
const { ENVIRONMENT, isProduction } = require("../config/environment");
const { getGlobalSpend, getBrandSpend } = require("./aiUsage");

/**
 * Hard budget enforcement, checked BEFORE any paid request is sent.
 *
 * Policy (per launch-sprint spec):
 *   - 50% of a budget: informational alert recorded once.
 *   - 75%: administrator warning recorded once.
 *   - 90%: optional BACKGROUND AI is blocked; user-requested AI continues.
 *   - 100%: all paid calls in that scope are blocked with an honest message.
 * Alerts are deduped in ai_budget_alerts (one per scope + UTC period + level).
 */

function utcDayKey() {
  return new Date().toISOString().slice(0, 10);
}
function utcMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

async function recordAlertOnce(scope, periodKey, level, spent, limit) {
  try {
    const r = await db.query(
      `INSERT INTO ai_budget_alerts (scope, period_key, level, spent_usd, limit_usd)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (scope, period_key, level) DO NOTHING
       RETURNING alert_id`,
      [scope, periodKey, level, Math.round(spent * 100) / 100, limit],
    );
    if (r.rows.length > 0) {
      const msg = `AI budget alert: ${scope} is at ${level}% ($${spent.toFixed(2)} of $${limit.toFixed(2)}) for ${periodKey}.`;
      if (level >= 75) console.error(msg);
      else console.log(msg);
    }
  } catch (err) {
    if (!/relation "ai_budget_alerts" does not exist/i.test(err.message || "")) {
      console.error("aiBudget: failed to record alert:", err.message);
    }
  }
}

/** Evaluate one scope; fires threshold alerts as side effects. */
async function evaluateScope({ scope, periodKey, spent, limit, triggeredBy }) {
  if (!limit || limit <= 0) return null; // 0 = unlimited/disabled check
  const pct = (spent / limit) * 100;
  for (const level of [50, 75, 90, 100]) {
    if (pct >= level) await recordAlertOnce(scope, periodKey, level, spent, limit);
  }
  if (pct >= 100) {
    return `the ${scope} AI budget is used up ($${spent.toFixed(2)} of $${limit.toFixed(2)}). Paid AI calls are paused until the budget resets or the administrator raises it.`;
  }
  if (pct >= 90 && triggeredBy === "background") {
    return `the ${scope} AI budget is over 90% ($${spent.toFixed(2)} of $${limit.toFixed(2)}), so optional background AI is paused. User-requested AI continues.`;
  }
  return null;
}

/**
 * The budget gate. Returns { allowed: true } or { allowed: false, reason }.
 * Fails OPEN on unexpected errors reading spend (a metering outage must not
 * take customer features down) but logs loudly.
 */
async function checkBudget({ triggeredBy = "user", brandId = null } = {}) {
  try {
    const [globalDaily, globalMonthly, devDaily, backgroundDaily, brandDaily, brandMonthly] =
      await Promise.all([
        getNumber("AI_BUDGET_GLOBAL_DAILY_USD"),
        getNumber("AI_BUDGET_GLOBAL_MONTHLY_USD"),
        getNumber("AI_BUDGET_DEV_DAILY_USD"),
        getNumber("AI_BUDGET_BACKGROUND_DAILY_USD"),
        getNumber("AI_BUDGET_BRAND_DAILY_USD"),
        getNumber("AI_BUDGET_BRAND_MONTHLY_USD"),
      ]);
    const spend = await getGlobalSpend();
    const day = utcDayKey();
    const month = utcMonthKey();

    const checks = [
      { scope: "global daily", periodKey: day, spent: spend.today, limit: globalDaily },
      { scope: "global monthly", periodKey: month, spent: spend.month, limit: globalMonthly },
    ];
    if (triggeredBy === "background") {
      checks.push({
        scope: "background daily",
        periodKey: day,
        spent: spend.backgroundToday,
        limit: backgroundDaily,
      });
    }
    if (!isProduction()) {
      checks.push({ scope: "development daily", periodKey: day, spent: spend.devToday, limit: devDaily });
    }
    if (brandId) {
      const brand = await getBrandSpend(brandId);
      checks.push(
        { scope: `brand ${brandId} daily`, periodKey: day, spent: brand.today, limit: brandDaily },
        { scope: `brand ${brandId} monthly`, periodKey: month, spent: brand.month, limit: brandMonthly },
      );
    }

    for (const check of checks) {
      const blockReason = await evaluateScope({ ...check, triggeredBy });
      if (blockReason) return { allowed: false, reason: blockReason };
    }
    return { allowed: true };
  } catch (err) {
    console.error(`aiBudget: budget check failed (${ENVIRONMENT}); allowing call:`, err.message);
    return { allowed: true, degraded: true };
  }
}

// --- Per-minute call rate limit (in-memory; one server process per env) ------
let minuteWindow = { startedAt: 0, count: 0 };

async function checkRateLimit() {
  const max = await getNumber("AI_MAX_CALLS_PER_MINUTE");
  if (!max || max <= 0) return { allowed: true };
  const now = Date.now();
  if (now - minuteWindow.startedAt >= 60000) minuteWindow = { startedAt: now, count: 0 };
  if (minuteWindow.count >= max) {
    return {
      allowed: false,
      reason: `the AI call rate limit (${max} calls/minute) was reached. Please try again in a moment.`,
    };
  }
  minuteWindow.count += 1;
  return { allowed: true };
}

function _resetRateLimitForTests() {
  minuteWindow = { startedAt: 0, count: 0 };
}

module.exports = { checkBudget, checkRateLimit, _resetRateLimitForTests };
