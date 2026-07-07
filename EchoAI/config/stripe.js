require("dotenv").config();

const Stripe = require("stripe");

// When STRIPE_SECRET_KEY is unset, the Stripe SDK throws at construction time
// ("Neither apiKey nor config.authenticator provided"). Because this module is
// required at boot, that would crash the ENTIRE server even though billing is an
// optional feature. Instead, degrade gracefully: build the real client only when
// the key exists, otherwise export a stub that throws a clear, descriptive error
// ONLY if some billing code path is actually invoked. The server boots fine and
// every non-billing feature keeps working.
function makeUnconfiguredStripe() {
  const notConfigured = () => {
    throw new Error(
      "Stripe is not configured: set STRIPE_SECRET_KEY to enable billing."
    );
  };
  const handler = {
    get() {
      return new Proxy(notConfigured, handler);
    },
    apply() {
      return notConfigured();
    },
  };
  return new Proxy(notConfigured, handler);
}

let stripe;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-12-18.acacia",
  });
} else {
  console.warn(
    "Warning: STRIPE_SECRET_KEY is not set. Billing is disabled; Stripe calls will fail until it is configured."
  );
  stripe = makeUnconfiguredStripe();
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
