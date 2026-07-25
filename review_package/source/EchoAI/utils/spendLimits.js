// Hard ad-spend limit engine for Autopilot Mode.
//
// The owner sets daily / weekly / monthly spending ceilings (dollars) that
// Echo can NEVER cross on her own — every ad launch and budget commitment is
// checked here first. Pure decision logic (unit-tested); the one DB reader
// lives at the bottom so callers get real committed-spend numbers, never
// fabricated ones.
//
// We track daily budgets rather than a spend ledger, so weekly/monthly checks
// use deliberately conservative projections: committed daily total × days in
// the window. Overestimating protects the owner's wallet; underestimating
// would betray it.

const db = require("../config/db");
const { formatMoney, daysRemainingInMonth } = require("./growthGuardrails");

/**
 * Decide whether a proposed NEW daily ad budget fits inside every configured
 * spend limit.
 *
 * @param {object} p
 * @param {object} p.caps                {daily, weekly, monthly} dollars or null each
 * @param {number} p.committedDailySpend sum of active campaigns' daily budgets (dollars)
 * @param {number} p.monthToDateSpend    conservative month-to-date estimate (dollars)
 * @param {number} p.proposedDailyBudget the new spend being requested (dollars/day)
 * @param {number} [p.daysRemaining]     days left in this month (defaults to today's)
 * @param {string} [p.label]             what the money is for, for the plain-English reason
 * @returns {{allowed: boolean, reason: string}}
 */
function evaluateAdSpend(p) {
  const {
    caps = {},
    committedDailySpend = 0,
    monthToDateSpend = 0,
    proposedDailyBudget = 0,
    daysRemaining = daysRemainingInMonth(),
    label = "this ad",
  } = p || {};

  const committed = Math.max(0, Number(committedDailySpend) || 0);
  const proposed = Math.max(0, Number(proposedDailyBudget) || 0);
  const mtd = Math.max(0, Number(monthToDateSpend) || 0);
  const daily = caps.daily != null ? Number(caps.daily) : null;
  const weekly = caps.weekly != null ? Number(caps.weekly) : null;
  const monthly = caps.monthly != null ? Number(caps.monthly) : null;

  if (proposed <= 0) {
    return { allowed: false, reason: `${label} has no budget set, so there is nothing to launch.` };
  }

  if (daily != null && committed + proposed > daily) {
    const room = Math.max(0, daily - committed);
    return {
      allowed: false,
      reason:
        `Launching ${label} at ${formatMoney(proposed)} a day would put total daily ad spend at ` +
        `${formatMoney(committed + proposed)}, past your ${formatMoney(daily)} daily limit` +
        (room > 0 ? ` — there's only ${formatMoney(room)} a day of room left.` : " — the daily limit is already fully committed."),
    };
  }

  if (weekly != null && (committed + proposed) * 7 > weekly) {
    return {
      allowed: false,
      reason:
        `At ${formatMoney(proposed)} a day, ${label} would put the week's projected ad spend at ` +
        `${formatMoney((committed + proposed) * 7)}, past your ${formatMoney(weekly)} weekly limit.`,
    };
  }

  if (monthly != null && mtd + proposed * Math.max(1, daysRemaining) > monthly) {
    return {
      allowed: false,
      reason:
        `${label} would add about ${formatMoney(proposed * Math.max(1, daysRemaining))} for the rest of the ` +
        `month on top of roughly ${formatMoney(mtd)} already committed, past your ${formatMoney(monthly)} monthly limit.`,
    };
  }

  return {
    allowed: true,
    reason: `${label} at ${formatMoney(proposed)} a day fits inside every spending limit you set.`,
  };
}

/**
 * Suggest a daily budget for a new test ad that fits inside every configured
 * limit. With no limits set, the conservative default applies. Returns whole
 * dollars (0 when there is no room — the caller must surface that honestly).
 */
function suggestDailyBudget(p) {
  const {
    caps = {},
    committedDailySpend = 0,
    monthToDateSpend = 0,
    daysRemaining = daysRemainingInMonth(),
    fallback = 10,
  } = p || {};

  const committed = Math.max(0, Number(committedDailySpend) || 0);
  const mtd = Math.max(0, Number(monthToDateSpend) || 0);
  let room = Infinity;
  if (caps.daily != null) room = Math.min(room, Number(caps.daily) - committed);
  if (caps.weekly != null) room = Math.min(room, Number(caps.weekly) / 7 - committed);
  if (caps.monthly != null) {
    room = Math.min(room, (Number(caps.monthly) - mtd) / Math.max(1, daysRemaining));
  }
  if (room === Infinity) return fallback;
  return Math.max(0, Math.floor(Math.min(fallback, room)));
}

/**
 * Real committed-spend numbers for a brand (dollars). Conservative estimates
 * derived from active campaigns' daily budgets — never fabricated.
 */
async function getBrandSpend(brandId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(budget), 0) AS daily_total
       FROM campaigns WHERE brand_id = $1 AND status = 'active'`,
    [brandId]
  );
  const committedDailySpend = Number(rows[0] ? rows[0].daily_total : 0) || 0;
  return {
    committedDailySpend,
    monthToDateSpend: committedDailySpend * new Date().getDate(),
  };
}

module.exports = { evaluateAdSpend, suggestDailyBudget, getBrandSpend };
