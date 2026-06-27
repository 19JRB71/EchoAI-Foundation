// Modal that shows all four subscription tiers and lets the customer switch to a
// different one (upgrade or downgrade).

import { useState } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";

const primaryBtn =
  "rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60";
const secondaryBtn =
  "rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-60";

export default function PlanSelectorModal({ plans, currentTier, onClose, onChanged }) {
  const [selected, setSelected] = useState(currentTier || (plans[0] && plans[0].tier));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    if (!selected || selected === currentTier) return;
    setSubmitting(true);
    setError("");
    try {
      await api.changeSubscription(selected);
      if (onChanged) onChanged(selected);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4">
      <div className="my-8 w-full max-w-3xl rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-100">Choose a plan</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => {
            const isCurrent = plan.tier === currentTier;
            const isSelected = plan.tier === selected;
            return (
              <button
                key={plan.tier}
                type="button"
                onClick={() => setSelected(plan.tier)}
                className={[
                  "flex flex-col rounded-xl border p-4 text-left transition",
                  isSelected
                    ? "border-amber-500 ring-2 ring-amber-500/40"
                    : "border-gray-800 hover:border-gray-700",
                ].join(" ")}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-gray-100">{plan.name}</span>
                  {isCurrent && (
                    <span className="rounded-full bg-gray-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-200">
                      Current
                    </span>
                  )}
                </div>
                <span className="mt-2 text-lg font-extrabold text-gray-100">
                  ${plan.monthlyPrice}
                  <span className="text-xs font-medium text-gray-400"> / mo</span>
                </span>
                <span className="text-xs text-gray-400">{plan.seatLabel}</span>
                <ul className="mt-3 space-y-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-1.5 text-xs text-gray-400">
                      <span className="text-amber-300">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        <ErrorBanner message={error} />

        <div className="mt-6 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryBtn}>
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={submitting || !selected || selected === currentTier}
            className={primaryBtn}
          >
            {submitting
              ? "Updating…"
              : selected === currentTier
                ? "Current plan"
                : "Confirm change"}
          </button>
        </div>
      </div>
    </div>
  );
}
