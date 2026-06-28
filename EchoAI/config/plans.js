/**
 * Subscription plan catalog (single source of truth for tier metadata).
 *
 * Three sellable tiers — Starter, Professional, Enterprise — each with a flat
 * monthly base price that includes a set number of user seats. Additional seats
 * beyond the included count are billed at ADDITIONAL_SEAT_PRICE / seat / month
 * (Enterprise includes unlimited seats, so it never accrues per-seat charges).
 *
 * Prices here are the *listed* monthly prices shown in the UI plan selector and
 * current-plan card. The amount a customer is actually charged on their next
 * billing date always comes from Stripe's upcoming invoice — these figures are
 * the display/fallback values.
 */

// Per-seat add-on price (USD / seat / month) for seats beyond a plan's included
// count. Applies to Starter and Professional; Enterprise is unlimited.
const ADDITIONAL_SEAT_PRICE = 50;

const PLANS = {
  starter: {
    tier: "starter",
    name: "Starter",
    monthlyPrice: 100,
    // First seat is included in the base price; extra seats are $50/seat/mo.
    includedSeats: 1,
    seats: 1,
    seatLabel: "1 user included",
    features: [
      "1 user included",
      "Automated Facebook ad campaigns",
      "Lead qualification chatbot (text)",
      "Embeddable website chatbot widget",
      "Basic CRM & lead scoring",
      "Weekly performance reports",
      "Email notifications",
      "Social posting on 2 platforms",
    ],
  },
  // Retired tier — kept for defensive lookups on any legacy account still on
  // "growth". Not offered in PLAN_ORDER / listPlans (not sellable).
  growth: {
    tier: "growth",
    name: "Growth (legacy)",
    monthlyPrice: 99,
    includedSeats: 3,
    seats: 3,
    seatLabel: "Up to 3 users",
    hidden: true,
    features: ["Legacy plan"],
  },
  pro: {
    tier: "pro",
    name: "Professional",
    monthlyPrice: 350,
    includedSeats: 5,
    seats: 5,
    seatLabel: "Up to 5 users included",
    features: [
      "Up to 5 users included",
      "Everything in Starter",
      "Voice chatbot",
      "AI phone agent (Twilio)",
      "Reputation management",
      "Sales script generator",
      "Content calendar",
      "All 6 social platforms",
      "Zapier integration",
      "Video script generator",
      "AI ad creative studio",
    ],
  },
  enterprise: {
    tier: "enterprise",
    name: "Enterprise",
    monthlyPrice: 550,
    // Unlimited seats — never accrues per-seat add-on charges.
    includedSeats: null,
    seats: null,
    seatLabel: "Unlimited users",
    features: [
      "Unlimited users",
      "Everything in Professional",
      "White-label agency system",
      "Affiliate program",
      "Mobile app API access",
      "Advanced analytics",
      "API marketplace access",
      "Customer feedback & surveys",
      "Priority support",
    ],
  },
};

// Display / upgrade-downgrade ordering (cheapest to most expensive). `growth`
// is intentionally excluded — it is retired and not sellable.
const PLAN_ORDER = ["starter", "pro", "enterprise"];

function getPlan(tier) {
  return PLANS[tier] || null;
}

function listPlans() {
  return PLAN_ORDER.map((tier) => PLANS[tier]);
}

/**
 * Number of chargeable seats beyond what a plan's base price includes.
 * Unlimited plans (includedSeats === null) never have additional seats.
 */
function additionalSeats(tier, teamSize) {
  const plan = getPlan(tier);
  if (!plan) return 0;
  if (plan.includedSeats == null) return 0; // unlimited
  const size = Number.isFinite(teamSize) ? teamSize : 1;
  return Math.max(0, size - plan.includedSeats);
}

/**
 * Total monthly price for a tier at a given team size:
 *   base + ADDITIONAL_SEAT_PRICE * (seats beyond included).
 */
function computeMonthlyTotal(tier, teamSize) {
  const plan = getPlan(tier);
  if (!plan) return 0;
  return plan.monthlyPrice + ADDITIONAL_SEAT_PRICE * additionalSeats(tier, teamSize);
}

/**
 * Seat limit for a tier: the number of included seats, or null when unlimited.
 * (Seats beyond this are allowed but billed at the per-seat add-on price.)
 */
function seatLimitFor(tier) {
  const plan = getPlan(tier);
  return plan ? plan.includedSeats : null;
}

module.exports = {
  PLANS,
  PLAN_ORDER,
  ADDITIONAL_SEAT_PRICE,
  getPlan,
  listPlans,
  additionalSeats,
  computeMonthlyTotal,
  seatLimitFor,
};
