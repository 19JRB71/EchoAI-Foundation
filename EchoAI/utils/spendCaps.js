// Prompt 015: no-cap-no-unpause enforcement (deny-by-default).
//
// One choke point decides whether a campaign may be unpaused. Called at the
// TOP of the unpause endpoint, before any Graph call — every denial makes
// zero Facebook requests.
//
// Money units (documented end-to-end, owner term 8):
//   * campaigns.budget            — DOLLARS/day, NUMERIC(12,2) (pg returns a
//                                   string — always coerce with Number()).
//   * ad_spend_caps.daily_cap_cents / ad_spend_audit *_cents — CENTS (integer).
//   * Facebook Graph daily_budget — CENTS.
//   This module works entirely in CENTS; dollars are converted on entry via
//   dollarsToCents() and only the UI converts back for display.
//
// Committed-spend rule (owner terms 1, 2, 6):
//   committed = SUM of daily budgets over campaigns that are
//     (a) status = 'live', OR
//     (b) status = 'created_paused' AND activation_requested_at IS NOT NULL
//         — Facebook ACCEPTED activation but the read-back has not verified
//         it live yet. Money-wise these must count (they may start spending
//         the moment Facebook finishes processing), even though the display
//         layer (spendLimits.getBrandSpend, admin stats) honestly reports
//         only verified-live spend.
//   Brand check:    brand committed + candidate ≤ brand daily cap.
//   Platform check: platform-wide committed (real brands only, is_demo
//                   excluded) + candidate ≤ platform cap (the seeded
//                   brand_id IS NULL row — configurable data, never code).

const db = require("../config/db");

/** DOLLARS (number|string) → integer CENTS. Throws on non-finite input. */
function dollarsToCents(dollars) {
  const n = Number(dollars);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid dollar amount: ${dollars}`);
  }
  return Math.round(n * 100);
}

function centsToDollars(cents) {
  return Number(cents) / 100;
}

function formatCents(cents) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

/** The brand's cap row (cents) or null when unset. */
async function getBrandCapCents(brandId) {
  const { rows } = await db.query(
    `SELECT daily_cap_cents FROM ad_spend_caps WHERE brand_id = $1`,
    [brandId]
  );
  return rows.length ? Number(rows[0].daily_cap_cents) : null;
}

/** The single platform cap row (cents) or null when missing. */
async function getPlatformCapCents() {
  const { rows } = await db.query(
    `SELECT daily_cap_cents FROM ad_spend_caps WHERE brand_id IS NULL`
  );
  return rows.length ? Number(rows[0].daily_cap_cents) : null;
}

/**
 * Committed daily spend in CENTS for one brand: live campaigns plus
 * accepted-but-unverified activations (term 6).
 */
async function getBrandCommittedCents(brandId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(budget), 0) AS total
       FROM campaigns
      WHERE brand_id = $1
        AND (status = 'live'
             OR (status = 'created_paused' AND activation_requested_at IS NOT NULL))`,
    [brandId]
  );
  return dollarsToCents(rows[0].total);
}

/** Platform-wide committed daily spend in CENTS (demo brands excluded). */
async function getPlatformCommittedCents() {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(c.budget), 0) AS total
       FROM campaigns c
       JOIN brands b ON b.brand_id = c.brand_id
      WHERE b.is_demo = false
        AND (c.status = 'live'
             OR (c.status = 'created_paused' AND c.activation_requested_at IS NOT NULL))`
  );
  return dollarsToCents(rows[0].total);
}

/**
 * Decide whether unpausing `campaignBudgetCents` for `brandId` is allowed.
 *
 * Never throws on a denial — returns a full snapshot either way so the
 * caller can write the audit row (cap-at-time values) and, when denied,
 * surface the owner-facing reason verbatim.
 *
 * @returns {Promise<{
 *   allowed: boolean, reason: string|null,
 *   brandCapCents: number|null, platformCapCents: number|null,
 *   brandCommittedCents: number, platformCommittedCents: number
 * }>}
 */
async function evaluateUnpause({ brandId, campaignBudgetCents }) {
  const [brandCapCents, platformCapCents, brandCommittedCents, platformCommittedCents] =
    await Promise.all([
      getBrandCapCents(brandId),
      getPlatformCapCents(),
      getBrandCommittedCents(brandId),
      getPlatformCommittedCents(),
    ]);

  const snapshot = { brandCapCents, platformCapCents, brandCommittedCents, platformCommittedCents };
  const budget = Number(campaignBudgetCents);

  if (!Number.isFinite(budget) || budget <= 0) {
    return {
      ...snapshot,
      allowed: false,
      reason: "This campaign has no daily budget set, so it cannot be unpaused.",
    };
  }
  // Deny-by-default, in owner-priority order (addendum E):
  if (brandCapCents == null) {
    return {
      ...snapshot,
      allowed: false,
      reason:
        "No daily spending cap is set for this business. Set a cap first — unpausing is impossible without one.",
    };
  }
  if (platformCapCents == null) {
    return {
      ...snapshot,
      allowed: false,
      reason:
        "The platform-level spending cap is missing. This is a configuration fault — contact the administrator; nothing can be unpaused until it exists.",
    };
  }
  if (brandCommittedCents + budget > brandCapCents) {
    return {
      ...snapshot,
      allowed: false,
      reason:
        `Unpausing would commit ${formatCents(brandCommittedCents + budget)}/day for this business — ` +
        `over its ${formatCents(brandCapCents)}/day cap (already committed: ${formatCents(brandCommittedCents)}). ` +
        `Raise the cap or pause something else first.`,
    };
  }
  if (platformCommittedCents + budget > platformCapCents) {
    return {
      ...snapshot,
      allowed: false,
      reason:
        `Unpausing would put platform-wide committed ad spend at ${formatCents(platformCommittedCents + budget)}/day — ` +
        `over the ${formatCents(platformCapCents)}/day platform cap (already committed: ${formatCents(platformCommittedCents)}).`,
    };
  }
  return { ...snapshot, allowed: true, reason: null };
}

module.exports = {
  dollarsToCents,
  centsToDollars,
  formatCents,
  getBrandCapCents,
  getPlatformCapCents,
  getBrandCommittedCents,
  getPlatformCommittedCents,
  evaluateUnpause,
};
