// Client-side mirror of the gating-relevant parts of the backend tier config
// (`config/tiers.js` + `config/plans.js`). Keep the two in sync. The backend is
// always the source of truth for enforcement; this drives the UI (sidebar locks,
// upgrade prompts, seat math display).

export const ADDITIONAL_SEAT_PRICE = 50;

// Tier hierarchy. The retired `growth` tier maps to the Starter rank so any
// legacy account keeps at least Starter-level access.
export const TIER_RANK = {
  free: 0,
  starter: 1,
  growth: 1,
  pro: 2,
  enterprise: 3,
};

// Display metadata for the three sellable tiers.
export const PLAN_META = {
  starter: { tier: "starter", name: "Starter", monthlyPrice: 100, includedSeats: 1 },
  pro: { tier: "pro", name: "Professional", monthlyPrice: 350, includedSeats: 5 },
  enterprise: { tier: "enterprise", name: "Enterprise", monthlyPrice: 550, includedSeats: null },
};

// Sidebar sections that require a minimum tier. Sections not listed here are
// available on every paid plan (Starter and up).
export const SECTION_GATES = {
  // Professional
  video: "pro",
  sales: "pro",
  reputation: "pro",
  phone: "pro",
  zapier: "pro",
  adstudio: "pro",
  appointments: "pro",
  // Enterprise
  feedback: "enterprise",
  affiliate: "enterprise",
};

export function tierRank(tier) {
  return TIER_RANK[tier] != null ? TIER_RANK[tier] : 0;
}

// True when `userTier` is at or above `requiredTier`.
export function meetsTier(userTier, requiredTier) {
  return tierRank(userTier) >= tierRank(requiredTier);
}

export function tierName(tier) {
  return PLAN_META[tier] ? PLAN_META[tier].name : tier;
}

export function tierPrice(tier) {
  return PLAN_META[tier] ? PLAN_META[tier].monthlyPrice : null;
}

// Minimum tier required for a sidebar section, or null when ungated.
export function requiredTierForSection(sectionKey) {
  return SECTION_GATES[sectionKey] || null;
}

// Number of chargeable seats beyond a tier's included count.
export function additionalSeats(tier, teamSize) {
  const meta = PLAN_META[tier];
  if (!meta || meta.includedSeats == null) return 0;
  const size = Number.isFinite(teamSize) ? teamSize : 1;
  return Math.max(0, size - meta.includedSeats);
}

// Total monthly price for a tier at a given team size.
export function computeMonthlyTotal(tier, teamSize) {
  const meta = PLAN_META[tier];
  if (!meta) return 0;
  return meta.monthlyPrice + ADDITIONAL_SEAT_PRICE * additionalSeats(tier, teamSize);
}
