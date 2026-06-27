/**
 * Subscription plan catalog (single source of truth for tier metadata).
 *
 * Prices here are the *listed* monthly prices shown in the UI plan selector and
 * current-plan card. The amount a customer is actually charged on their next
 * billing date always comes from Stripe's upcoming invoice — these figures are
 * the display/fallback values.
 */

const PLANS = {
  starter: {
    tier: "starter",
    name: "Starter",
    monthlyPrice: 49,
    seatLabel: "1 user seat",
    seats: 1,
    features: [
      "1 user seat",
      "AI brand discovery & voice profile",
      "Automated Facebook ad campaigns",
      "Lead qualification & scoring",
      "Weekly performance analytics",
    ],
  },
  growth: {
    tier: "growth",
    name: "Growth",
    monthlyPrice: 99,
    seatLabel: "Up to 3 user seats",
    seats: 3,
    features: [
      "Up to 3 user seats",
      "Everything in Starter",
      "AI social media content & scheduling",
      "AI email marketing campaigns",
      "Image Studio (AI ad creatives)",
    ],
  },
  pro: {
    tier: "pro",
    name: "Professional",
    monthlyPrice: 199,
    seatLabel: "Up to 5 user seats",
    seats: 5,
    features: [
      "Up to 5 user seats",
      "Everything in Growth",
      "AI campaign optimization",
      "Competitor intelligence",
      "Priority support",
    ],
  },
  enterprise: {
    tier: "enterprise",
    name: "Enterprise",
    monthlyPrice: 499,
    seatLabel: "Unlimited user seats",
    seats: null,
    features: [
      "Unlimited user seats",
      "Everything in Professional",
      "Dedicated success manager",
      "Custom reporting",
      "Onboarding & strategy calls",
    ],
  },
};

// Display / upgrade-downgrade ordering (cheapest to most expensive).
const PLAN_ORDER = ["starter", "growth", "pro", "enterprise"];

function getPlan(tier) {
  return PLANS[tier] || null;
}

function listPlans() {
  return PLAN_ORDER.map((tier) => PLANS[tier]);
}

module.exports = { PLANS, PLAN_ORDER, getPlan, listPlans };
