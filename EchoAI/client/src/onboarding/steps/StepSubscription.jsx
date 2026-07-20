// Step 3 — Subscription selection.
// Shows the three pricing tiers (flat monthly base price + included seats) and
// collects payment details via Stripe Elements, then creates the subscription.

import { useEffect, useState } from "react";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import { useStripePromise } from "../../lib/stripe.js";

const ADDITIONAL_SEAT_PRICE = 50;

const TIERS = [
  {
    value: "starter",
    name: "Starter",
    price: 197,
    seats: "1 user included",
    features: [
      "1 user included",
      "AI brand discovery & voice profile",
      "Automated Facebook ad campaigns",
      "Lead qualification & scoring",
      "Weekly performance analytics",
    ],
  },
  {
    value: "pro",
    name: "Professional",
    price: 497,
    seats: "1 user included",
    highlighted: true,
    features: [
      "1 user included",
      "Everything in Starter",
      "AI phone agent & voice chatbot",
      "Reputation, content calendar & ad studio",
      "Zapier integration & priority support",
    ],
  },
  {
    value: "enterprise",
    name: "Enterprise",
    price: 997,
    seats: "1 user included",
    features: [
      "1 user included",
      "Everything in Professional",
      "White-label agency & affiliate program",
      "Customer feedback & surveys",
      "Mobile API & dedicated support",
    ],
  },
];

const primaryBtn =
  "rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60";
const backBtn =
  "rounded-lg border border-gray-700 px-5 py-2.5 text-sm font-semibold text-gray-300 hover:bg-gray-800";

export default function StepSubscription({ onNext, onBack, onSelectTier }) {
  const [tier, setTier] = useState("pro");
  const [freeTestMode, setFreeTestMode] = useState(false);
  const [modeChecked, setModeChecked] = useState(false);

  // Free test mode: the server grants full access at signup, so the payment
  // step is skipped entirely and replaced with a friendly notice.
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([api.getSignupMode(), api.getSubscriptionStatus()])
      .then(([mode, status]) => {
        if (cancelled) return;
        const flagOn =
          mode.status === "fulfilled" && Boolean(mode.value?.freeTestMode);
        // If the account already holds a paid tier (e.g. granted during a
        // testing period), never ask for payment again — even if the test-mode
        // flag has since been turned off.
        const tier =
          status.status === "fulfilled"
            ? status.value?.subscriptionTier || status.value?.tier
            : null;
        const alreadyPaid = Boolean(tier) && tier !== "free";
        setFreeTestMode(flagOn || alreadyPaid);
      })
      .finally(() => {
        if (!cancelled) setModeChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { loading: stripeLoading, stripePromise } = useStripePromise();

  function select(value) {
    setTier(value);
    if (onSelectTier) onSelectTier(value);
  }

  if (!modeChecked) {
    return (
      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-sm sm:p-8">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  if (freeTestMode) {
    return (
      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold text-gray-100">
          Free testing access
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-400">
          You're part of our testing program — your account has{" "}
          <span className="font-semibold text-amber-300">
            full access to every feature
          </span>{" "}
          at no charge. No payment details are needed. Explore everything and
          tell us what you think!
        </p>
        <div className="mt-8 flex items-center justify-between">
          <button type="button" onClick={onBack} className={backBtn}>
            Back
          </button>
          <button
            type="button"
            onClick={() => {
              if (onSelectTier) onSelectTier("enterprise");
              onNext();
            }}
            className={primaryBtn}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-bold text-gray-100">Choose your plan</h1>
      <p className="mt-3 text-sm leading-relaxed text-gray-400">
        Pick the plan that fits your business — you can change it any time. Every
        plan includes 1 user. Need more seats? Add extra users on any tier for{" "}
        <span className="font-semibold text-gray-200">
          ${ADDITIONAL_SEAT_PRICE} / seat / month
        </span>
        .
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {TIERS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => select(t.value)}
            className={[
              "flex flex-col rounded-xl border p-4 text-left transition",
              tier === t.value
                ? "border-amber-500 ring-2 ring-amber-500/40"
                : "border-gray-800 hover:border-gray-700",
            ].join(" ")}
          >
            {t.highlighted && (
              <span className="mb-1 inline-block w-fit rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
                Most popular
              </span>
            )}
            <span className="text-sm font-bold text-gray-100">{t.name}</span>
            <span className="text-xs text-gray-400">{t.seats}</span>
            <span className="mt-2 text-lg font-extrabold text-gray-100">
              ${t.price}
              <span className="text-xs font-medium text-gray-400"> / mo</span>
            </span>
            <ul className="mt-3 space-y-1">
              {t.features.map((f) => (
                <li key={f} className="flex gap-1.5 text-xs text-gray-400">
                  <span className="text-amber-300">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>

      <div className="mt-8">
        {stripeLoading ? (
          <p className="text-sm text-gray-400">Loading payment form…</p>
        ) : stripePromise ? (
          <Elements stripe={stripePromise}>
            <PaymentForm tier={tier} onNext={onNext} onBack={onBack} />
          </Elements>
        ) : (
          <div className="rounded-lg bg-amber-500/10 p-4 text-sm text-amber-300">
            Payments are not configured in this environment. Set{" "}
            <code className="rounded bg-amber-500/15 px-1">
              STRIPE_PUBLISHABLE_KEY
            </code>{" "}
            on the server to enable checkout.
          </div>
        )}
      </div>
    </div>
  );
}

function PaymentForm({ tier, onNext, onBack }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError("");
    try {
      const card = elements.getElement(CardElement);
      const { error: pmError, paymentMethod } =
        await stripe.createPaymentMethod({ type: "card", card });
      if (pmError) {
        setError(pmError.message);
        return;
      }
      await api.createSubscription(paymentMethod.id, tier);
      onNext();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-300">
          Card details
        </label>
        <div className="rounded-lg border border-gray-700 px-3 py-3">
          <CardElement options={{ hidePostalCode: false }} />
        </div>
      </div>
      <ErrorBanner message={error} />
      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} className={backBtn}>
          Back
        </button>
        <button disabled={!stripe || submitting} className={primaryBtn}>
          {submitting ? "Processing…" : "Start subscription"}
        </button>
      </div>
    </form>
  );
}
