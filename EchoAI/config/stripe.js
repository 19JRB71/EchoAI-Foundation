require("dotenv").config();

const Stripe = require("stripe");
const { makeUnconfiguredClient } = require("../utils/optionalClient");

// When STRIPE_SECRET_KEY is unset, the Stripe SDK throws at construction time
// ("Neither apiKey nor config.authenticator provided"). Because this module is
// required at boot, that would crash the ENTIRE server even though billing is an
// optional feature. Build the real client only when the key exists; otherwise use
// a stub that throws a clear error only if a billing path is actually invoked, so
// the server boots and every non-billing feature keeps working.
let stripe;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-12-18.acacia",
  });
} else {
  console.warn(
    "Warning: STRIPE_SECRET_KEY is not set. Billing is disabled; Stripe calls will fail until it is configured."
  );
  stripe = makeUnconfiguredClient("Stripe (billing)", "STRIPE_SECRET_KEY");
}

/**
 * Maps an EchoAI subscription tier to the corresponding Stripe Price ID.
 * Price IDs are created in the Stripe dashboard and provided via env vars.
 */
const tierPriceIds = {
  starter: process.env.STRIPE_PRICE_STARTER,
  growth: process.env.STRIPE_PRICE_GROWTH,
  pro: process.env.STRIPE_PRICE_PRO,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
};

function getPriceIdForTier(tier) {
  return tierPriceIds[tier];
}

/**
 * Stripe Price ID for the per-seat add-on (a recurring $50/seat/month price,
 * billed by quantity). When unset, seat billing degrades gracefully: team size
 * is still tracked locally and the computed total is shown, but no extra seat
 * line item is synced to Stripe.
 */
function getSeatPriceId() {
  return process.env.STRIPE_PRICE_SEAT;
}

module.exports = { stripe, getPriceIdForTier, getSeatPriceId };
