// Shared Stripe.js loader.
//
// The publishable key is resolved at RUNTIME from the server
// (GET /api/subscriptions/config) rather than baked in at build time via
// import.meta.env. The SPA bundle is prebuilt and committed (Railway serves it
// as-is), so a build-time key could never differ between environments —
// runtime resolution lets the same bundle use the test key on staging and the
// live key in production. A build-time VITE_STRIPE_PUBLISHABLE_KEY, if
// present, still wins (useful for local dev without a server restart).
//
// The resolved loadStripe(...) promise is cached as a singleton so every
// Elements form (onboarding checkout, billing card update) reuses it instead
// of re-initializing Stripe per component.

import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";

const BUILD_TIME_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

let cachedStripePromise = null;

async function resolvePublishableKey() {
  if (BUILD_TIME_KEY) return { key: BUILD_TIME_KEY, transient: false };
  try {
    const res = await fetch("/api/subscriptions/config");
    if (!res.ok) return { key: null, transient: true };
    const data = await res.json();
    // A successful answer with no key means payments genuinely aren't
    // configured in this environment — cache that (not transient).
    return { key: data.publishableKey || null, transient: false };
  } catch {
    // Network hiccup — don't cache, so a later attempt can retry.
    return { key: null, transient: true };
  }
}

/**
 * Returns a cached promise resolving to a Stripe instance, or null when
 * payments are not configured in this environment.
 */
export function getStripePromise() {
  if (!cachedStripePromise) {
    const attempt = resolvePublishableKey().then(({ key, transient }) => {
      if (!key && transient && cachedStripePromise === attempt) {
        // Failed lookup (network/server hiccup): clear the cache so the next
        // caller retries instead of being stuck on null until a full reload.
        cachedStripePromise = null;
      }
      return key ? loadStripe(key) : null;
    });
    cachedStripePromise = attempt;
  }
  return cachedStripePromise;
}

/**
 * React hook wrapping getStripePromise().
 * Returns { loading, stripePromise }:
 *  - loading: true until the key lookup finishes
 *  - stripePromise: a promise suitable for <Elements stripe={...}>, or null
 *    when payments are not configured.
 */
export function useStripePromise() {
  const [state, setState] = useState({ loading: true, stripePromise: null });

  useEffect(() => {
    let active = true;
    const promise = getStripePromise();
    promise.then(
      (stripe) => {
        if (active) {
          setState({ loading: false, stripePromise: stripe ? promise : null });
        }
      },
      () => {
        if (active) setState({ loading: false, stripePromise: null });
      }
    );
    return () => {
      active = false;
    };
  }, []);

  return state;
}
