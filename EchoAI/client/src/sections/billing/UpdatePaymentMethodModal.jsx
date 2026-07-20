// Modal that collects a new card via Stripe Elements and saves it as the
// customer's default payment method.

import { useState } from "react";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { useStripePromise } from "../../lib/stripe.js";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";

const primaryBtn =
  "rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60";
const secondaryBtn =
  "rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-60";

export default function UpdatePaymentMethodModal({ onClose, onSaved }) {
  const { loading: stripeLoading, stripePromise } = useStripePromise();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-100">Update payment method</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200" aria-label="Close">
            ✕
          </button>
        </div>
        {stripeLoading ? (
          <p className="text-sm text-gray-400">Loading payment form…</p>
        ) : stripePromise ? (
          <Elements stripe={stripePromise}>
            <CardForm onClose={onClose} onSaved={onSaved} />
          </Elements>
        ) : (
          <div className="rounded-lg bg-amber-500/10 p-4 text-sm text-amber-300">
            Payments are not configured in this environment. Set <code className="rounded bg-amber-500/15 px-1">STRIPE_PUBLISHABLE_KEY</code> on the server to enable card updates.
          </div>
        )}
      </div>
    </div>
  );
}

function CardForm({ onClose, onSaved }) {
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
      const { error: pmError, paymentMethod } = await stripe.createPaymentMethod({
        type: "card",
        card,
      });
      if (pmError) {
        setError(pmError.message);
        return;
      }
      const result = await api.updatePaymentMethod(paymentMethod.id);
      if (onSaved) onSaved(result.card);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-300">Card details</label>
        <div className="rounded-lg border border-gray-700 px-3 py-3">
          <CardElement
            options={{
              hidePostalCode: false,
              style: { base: { color: "#e5e7eb", "::placeholder": { color: "#9ca3af" } } },
            }}
          />
        </div>
      </div>
      <ErrorBanner message={error} />
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} className={secondaryBtn}>
          Cancel
        </button>
        <button disabled={!stripe || submitting} className={primaryBtn}>
          {submitting ? "Saving…" : "Save card"}
        </button>
      </div>
    </form>
  );
}
