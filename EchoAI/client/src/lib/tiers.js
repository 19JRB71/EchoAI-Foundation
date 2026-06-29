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
  image: "pro",
  appointments: "pro",
  followups: "pro",
  contentcalendar: "pro",
  sms: "pro",
  email: "pro",
  // Enterprise
  feedback: "enterprise",
  affiliate: "enterprise",
  agency: "enterprise",
  intelligence: "enterprise",
};

// Accent color per tier. Drives nav highlights, lock badges, group headers and
// upgrade prompt cards. Ungated/"core" items fall back to the brand teal accent.
export const TIER_COLORS = {
  starter: "#3B82F6", // blue
  pro: "#8B5CF6", // purple
  enterprise: "#F59E0B", // gold
};

export const DEFAULT_ACCENT = "#14B8A6"; // teal — core features with no tier

// Resolve a hex accent for a tier key (starter/pro/enterprise) or null → teal.
export function accentColor(tier) {
  return TIER_COLORS[tier] || DEFAULT_ACCENT;
}

// Short uppercase badge shown on locked nav items.
export function tierBadgeShort(tier) {
  if (tier === "enterprise") return "ENT";
  if (tier === "pro") return "PRO";
  if (tier === "starter") return "STR";
  return "";
}

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

// The tier each section BELONGS to — mirrors the backend feature catalog
// (config/tiers.js FEATURES). Drives the color coding + tier pill on every nav
// item. Baseline features (campaigns, leads, social, email, image, SEO, ROI,
// chatbot, dashboard, settings) ship with Starter; the rest match their gate.
// Keep in sync with the backend FEATURES map.
export const SECTION_TIERS = {
  // Starter (baseline)
  overview: "starter",
  leads: "starter",
  campaigns: "starter",
  social: "starter",
  googleseo: "starter",
  roi: "starter",
  chatbot: "starter",
  settings: "starter",
  // Professional
  adstudio: "pro",
  image: "pro",
  contentcalendar: "pro",
  video: "pro",
  followups: "pro",
  phone: "pro",
  appointments: "pro",
  reputation: "pro",
  zapier: "pro",
  sales: "pro",
  sms: "pro",
  email: "pro",
  // Enterprise
  feedback: "enterprise",
  affiliate: "enterprise",
  agency: "enterprise",
  intelligence: "enterprise",
};

// The tier a section belongs to (for color coding), or null for sections that are
// not tiered nav items (e.g. admin) so they keep the neutral/core accent.
export function tierForSection(sectionKey) {
  return SECTION_TIERS[sectionKey] || null;
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
