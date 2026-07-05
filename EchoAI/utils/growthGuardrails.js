// Guardrail decision layer for Autonomous Growth Mode (Part 3).
//
// Pure, side-effect-free helpers that decide whether an autonomous move is
// allowed to run on its own, must be presented to the owner for approval, or is
// blocked outright — and phrase the reason in plain English (no jargon) so the
// action log reads like a human explaining what it did and why.
//
// The guardrails come from growth_settings (per owner):
//   monthlyBudgetCap    — max total ad spend per month (dollars, or null = none)
//   approvalThreshold   — spend increases above this need the owner's OK (dollars)
//   brandVoiceRules     — tone/phrasing rules new content must follow
//   geoTargeting        — geographic areas Echo may target
//
// Everything here is unit-tested in test/growthGuardrails.test.js. Keep it pure.

/** Whole dollars, no cents, with a leading $ — e.g. 1500 -> "$1,500". */
function formatMoney(n) {
  const v = Math.round(Number(n) || 0);
  return "$" + v.toLocaleString("en-US");
}

/** Calendar days left in the month for `date` (inclusive of today). */
function daysRemainingInMonth(date = new Date()) {
  const d = new Date(date);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return Math.max(1, lastDay - d.getDate() + 1);
}

/**
 * Decide what to do with a proposed daily-budget change for one campaign.
 *
 * @param {object} p
 * @param {object} p.settings          serialized growth settings (monthlyBudgetCap, approvalThreshold)
 * @param {number} p.currentDailyBudget current daily budget (dollars)
 * @param {number} p.proposedDailyBudget proposed daily budget (dollars)
 * @param {number} p.monthToDateSpend   account-wide spend already committed this month (dollars)
 * @param {number} [p.daysRemaining]    days left in the month (defaults to today's)
 * @param {string} [p.campaignName]     for the plain-English reason
 * @returns {{decision:'auto'|'approval'|'blocked', appliedDailyBudget:number, incrementalMonthlySpend:number, reason:string}}
 */
function evaluateBudgetChange(p) {
  const {
    settings = {},
    currentDailyBudget = 0,
    proposedDailyBudget = 0,
    monthToDateSpend = 0,
    daysRemaining = daysRemainingInMonth(),
    campaignName = "this campaign",
  } = p || {};

  const current = Math.max(0, Number(currentDailyBudget) || 0);
  const proposed = Math.max(0, Number(proposedDailyBudget) || 0);
  const cap = settings.monthlyBudgetCap != null ? Number(settings.monthlyBudgetCap) : null;
  const threshold = settings.approvalThreshold != null ? Number(settings.approvalThreshold) : null;

  // Cutting spend never needs approval — saving money is always safe.
  if (proposed <= current) {
    return {
      decision: "auto",
      appliedDailyBudget: proposed,
      incrementalMonthlySpend: 0,
      reason:
        `Lowered the daily budget on ${campaignName} from ${formatMoney(current)} to ` +
        `${formatMoney(proposed)} a day because it wasn't earning its keep — that frees up money for what's working.`,
    };
  }

  const dailyIncrease = proposed - current;
  const incrementalMonthlySpend = dailyIncrease * daysRemaining;

  // Monthly cap: would this push total monthly spend past the owner's ceiling?
  if (cap != null) {
    const projected = monthToDateSpend + incrementalMonthlySpend;
    if (projected > cap) {
      const room = Math.max(0, cap - monthToDateSpend);
      if (room <= 0) {
        return {
          decision: "blocked",
          appliedDailyBudget: current,
          incrementalMonthlySpend,
          reason:
            `Wanted to raise the budget on ${campaignName}, but you've already reached your ` +
            `${formatMoney(cap)} monthly spending limit, so I left it alone.`,
        };
      }
      // There's some room but the full increase would breach the cap — present it.
      return {
        decision: "approval",
        appliedDailyBudget: proposed,
        incrementalMonthlySpend,
        reason:
          `${campaignName} is doing well and I'd like to raise its budget to ${formatMoney(proposed)} a day, ` +
          `but that would push this month's spend past your ${formatMoney(cap)} limit. ` +
          `Approve it and I'll go ahead — I expect more leads at a similar cost.`,
      };
    }
  }

  // Approval threshold: is the extra monthly spend bigger than the owner allows
  // Echo to commit on its own?
  if (threshold != null && incrementalMonthlySpend > threshold) {
    return {
      decision: "approval",
      appliedDailyBudget: proposed,
      incrementalMonthlySpend,
      reason:
        `${campaignName} is performing well, so I'd like to raise its daily budget to ${formatMoney(proposed)} ` +
        `(about ${formatMoney(incrementalMonthlySpend)} more this month). That's above your ` +
        `${formatMoney(threshold)} auto-approve limit, so I'm checking with you first. Expected result: more leads while the cost per lead stays low.`,
    };
  }

  // Within all guardrails — safe to run automatically.
  return {
    decision: "auto",
    appliedDailyBudget: proposed,
    incrementalMonthlySpend,
    reason:
      `Raised the daily budget on ${campaignName} from ${formatMoney(current)} to ${formatMoney(proposed)} ` +
      `because it's bringing in leads cheaply — this stays within your limits and should capture more of them.`,
  };
}

/**
 * Whether a proposed geographic target is inside the owner's configured geo
 * guardrail. No configured geo = no restriction. A proposed geo that isn't part
 * of the configured area needs approval (returns allowed:false).
 */
function geoAllowed(settings = {}, proposedGeo = "") {
  const configured = String(settings.geoTargeting || "").trim().toLowerCase();
  const proposed = String(proposedGeo || "").trim().toLowerCase();
  if (!configured) return { allowed: true, reason: "" };
  if (!proposed) return { allowed: true, reason: "" };
  if (configured.includes(proposed) || proposed.includes(configured)) {
    return { allowed: true, reason: "" };
  }
  return {
    allowed: false,
    reason:
      `The data points to "${proposedGeo}", which is outside your set target area (${settings.geoTargeting}). ` +
      `I've flagged it for your approval rather than changing where your ads show on my own.`,
  };
}

/**
 * Map a follow-up response rate (0..1) to a timing factor for future sequences.
 * When people reply a lot we can afford to space touchpoints out (avoid nagging);
 * when almost no one replies we tighten them up to stay top-of-mind. Clamped to a
 * sane range so one noisy week can't produce absurd schedules.
 */
function followupTimingFactor(responseRate) {
  const r = Number(responseRate);
  if (!Number.isFinite(r)) return 1.0;
  let factor = 1.0;
  if (r >= 0.4) factor = 1.25;
  else if (r >= 0.25) factor = 1.1;
  else if (r < 0.1) factor = 0.7;
  else if (r < 0.2) factor = 0.85;
  return Math.min(2.0, Math.max(0.5, factor));
}

/** Plain-English sentence describing the follow-up timing adjustment. */
function describeTimingChange(oldFactor, newFactor, responseRate) {
  const pct = Math.round((Number(responseRate) || 0) * 100);
  if (newFactor > oldFactor) {
    return `People are replying well (${pct}% response rate), so I spread your follow-up messages out a bit more to avoid over-messaging them.`;
  }
  if (newFactor < oldFactor) {
    return `Replies have been low (${pct}% response rate), so I'm sending your follow-ups a little sooner to stay on people's radar.`;
  }
  return `Your follow-up timing is already in a good spot for the current ${pct}% response rate, so I left it as is.`;
}

module.exports = {
  formatMoney,
  daysRemainingInMonth,
  evaluateBudgetChange,
  geoAllowed,
  followupTimingFactor,
  describeTimingChange,
};
