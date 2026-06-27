// Shared Stripe.js loader. Centralizes the publishable key + loadStripe promise
// so every Elements form (onboarding checkout, billing card update) reuses the
// same singleton instead of re-initializing Stripe per component.

import { loadStripe } from "@stripe/stripe-js";

const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

export const stripePromise = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : null;
export const stripeConfigured = Boolean(PUBLISHABLE_KEY);
