/**
 * Sage V2 Phase 4 — pure constraint-clamp helper (INERT by CEO directive).
 *
 * "Never recommend marketing the business cannot fulfill" becomes a code-level
 * guard in Phase 5, where its two enforcement points (Opportunity Synthesis
 * post-validation and Atlas directive budget clamps) will exist. Phase 4 ships
 * this helper fully tested but wired to NOTHING — it must not be connected to
 * live execution or alter current platform behavior until Phase 5.
 *
 * Pure functions only: no DB, no AI, no I/O, no flags.
 */

/**
 * Clamp a proposed budget (cents) to what remains of the brand's monthly
 * budget. Honest by construction:
 *   - No budget constraint set (null/undefined) => no clamp (unknown ≠ zero).
 *   - Invalid inputs => no clamp, flagged unclamped:'invalid_input'.
 *   - Remaining budget floor is 0 — never negative.
 *
 * @param {number} proposedCents   the amount a recommendation wants to spend
 * @param {number|null} monthlyBudgetCents  owner-stated cap (null = not provided)
 * @param {number} spentThisMonthCents      already committed this month
 * @returns {{ allowedCents:number, clamped:boolean, reason:string|null }}
 */
function clampBudget(proposedCents, monthlyBudgetCents, spentThisMonthCents = 0) {
  const proposed = Number(proposedCents);
  if (!Number.isFinite(proposed) || proposed < 0) {
    return { allowedCents: 0, clamped: true, reason: "invalid_proposed_amount" };
  }
  if (monthlyBudgetCents == null) {
    return { allowedCents: proposed, clamped: false, reason: null };
  }
  const budget = Number(monthlyBudgetCents);
  const spent = Number(spentThisMonthCents);
  if (!Number.isFinite(budget) || budget < 0 || !Number.isFinite(spent) || spent < 0) {
    return { allowedCents: proposed, clamped: false, reason: "invalid_constraint_input" };
  }
  const remaining = Math.max(0, budget - spent);
  if (proposed <= remaining) {
    return { allowedCents: proposed, clamped: false, reason: null };
  }
  return { allowedCents: remaining, clamped: true, reason: "monthly_budget_exceeded" };
}

/**
 * Check a projected weekly lead/job volume against the owner-stated weekly
 * capacity. Unknown capacity => fits (unknown ≠ zero; never fabricate limits).
 *
 * @returns {{ fits:boolean, overBy:number, reason:string|null }}
 */
function checkCapacity(projectedWeekly, weeklyCapacity) {
  const projected = Number(projectedWeekly);
  if (!Number.isFinite(projected) || projected < 0) {
    return { fits: true, overBy: 0, reason: "invalid_projection_input" };
  }
  if (weeklyCapacity == null) return { fits: true, overBy: 0, reason: null };
  const capacity = Number(weeklyCapacity);
  if (!Number.isFinite(capacity) || capacity < 0) {
    return { fits: true, overBy: 0, reason: "invalid_constraint_input" };
  }
  if (projected <= capacity) return { fits: true, overBy: 0, reason: null };
  return { fits: false, overBy: projected - capacity, reason: "weekly_capacity_exceeded" };
}

/**
 * True when the given date (YYYY-MM-DD string or Date) falls inside any
 * blackout window. Malformed entries are skipped (never block on garbage);
 * open-ended windows ({from} only / {to} only) are honored.
 */
function isBlackedOut(date, blackoutDates) {
  if (!Array.isArray(blackoutDates) || blackoutDates.length === 0) return false;
  const day = toDayString(date);
  if (!day) return false;
  for (const entry of blackoutDates) {
    if (!entry || typeof entry !== "object") continue;
    const from = toDayString(entry.from);
    const to = toDayString(entry.to);
    if (!from && !to) continue;
    if (from && day < from) continue;
    if (to && day > to) continue;
    return true;
  }
  return false;
}

function toDayString(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

module.exports = { clampBudget, checkCapacity, isBlackedOut, toDayString };
