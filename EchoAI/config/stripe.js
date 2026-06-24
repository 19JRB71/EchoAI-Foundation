require("dotenv").config();

const Stripe = require("stripe");

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("Warning: STRIPE_SECRET_KEY is not set. Stripe calls will fail until it is configured.");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-12-18.acacia",
});

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

module.exports = { stripe, getPriceIdForTier };
