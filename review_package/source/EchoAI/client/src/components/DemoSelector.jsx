import { useEffect, useState } from "react";
import { api } from "../api.js";

// Tier presentation metadata: price, tagline, and the headline capabilities to
// call out on each card. Mirrors config/plans.js pricing (Starter/Pro/Enterprise).
const TIER_CARDS = [
  {
    tier: "starter",
    name: "Starter",
    price: "$197",
    tagline: "Everything a solo business needs to capture and close leads.",
    accent: "border-blue-500/40 hover:border-blue-400 bg-blue-500/5",
    dot: "bg-blue-400",
    highlights: [
      "Lead-qualifying chatbot & hot-lead alerts",
      "Facebook ad campaigns & weekly analytics",
      "Social posting (2 platforms)",
      "ROI dashboard",
    ],
  },
  {
    tier: "pro",
    name: "Professional",
    price: "$497",
    tagline: "The full growth engine — automation across every channel.",
    accent: "border-purple-500/40 hover:border-purple-400 bg-purple-500/5",
    dot: "bg-purple-400",
    highlights: [
      "Everything in Starter, plus:",
      "Ad Creative Studio & content calendar",
      "Automated follow-up sequences",
      "Reputation, sales scripts, video & email",
    ],
  },
  {
    tier: "enterprise",
    name: "Enterprise",
    price: "$997",
    tagline: "Full autonomy — competitive intelligence and strategy.",
    accent: "border-amber-500/40 hover:border-amber-400 bg-amber-500/5",
    dot: "bg-amber-400",
    highlights: [
      "Everything in Professional, plus:",
      "Competitor Ad Spy & intelligence",
      "Customer intelligence & feedback surveys",
      "White label, affiliate & mobile app",
    ],
  },
];

// Full-screen tier chooser shown (admin-only) when Presentation Mode is live but
// no plan has been picked yet. Selecting a plan points the demo at that tier's
// seeded brand so the dashboard shows exactly what that plan unlocks.
export default function DemoSelector({ onSelectTier, onCancel }) {
  const [seededTiers, setSeededTiers] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  // Learn which tiers are actually seeded so we can flag any missing ones.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const status = await api.demoGetStatus();
        if (alive) {
          setSeededTiers((status.demoBrands || []).map((b) => b.tier));
        }
      } catch {
        if (alive) setSeededTiers([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function pick(tier) {
    setBusy(tier);
    setError("");
    try {
      await onSelectTier(tier);
    } catch (err) {
      setError(err.message || "Couldn't start that demo. Please try again.");
      setBusy("");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-gray-950/95 p-6 backdrop-blur">
      <div className="w-full max-w-5xl">
        <div className="mb-6 text-center">
          <span className="rounded-full bg-teal-500/20 px-3 py-1 text-xs font-semibold text-teal-300">
            PRESENTATION MODE
          </span>
          <h2 className="mt-3 text-2xl font-bold text-gray-100">
            Which plan would you like to present?
          </h2>
          <p className="mt-1 text-sm text-gray-400">
            Each plan opens the same demo dealership, showing only the features
            that plan unlocks. Higher tiers appear as locked upgrade teasers.
          </p>
        </div>

        {error && (
          <div className="mx-auto mb-4 max-w-md rounded-lg bg-red-500/10 p-3 text-center text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          {TIER_CARDS.map((card) => {
            const missing = seededTiers && !seededTiers.includes(card.tier);
            return (
              <button
                key={card.tier}
                onClick={() => !missing && !busy && pick(card.tier)}
                disabled={missing || !!busy}
                className={`flex flex-col rounded-2xl border p-5 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${card.accent}`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="flex items-center gap-2 text-lg font-semibold text-gray-100">
                    <span className={`h-2.5 w-2.5 rounded-full ${card.dot}`} />
                    {card.name}
                  </span>
                  <span className="text-sm font-bold text-gray-300">
                    {card.price}
                    <span className="text-xs font-normal text-gray-500">/mo</span>
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-400">{card.tagline}</p>
                <ul className="mt-4 flex-1 space-y-1.5 text-sm text-gray-300">
                  {card.highlights.map((h, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-teal-400">›</span>
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
                <span
                  className={`mt-5 rounded-lg px-4 py-2 text-center text-sm font-semibold ${
                    missing
                      ? "bg-gray-800 text-gray-500"
                      : "bg-teal-500 text-black"
                  }`}
                >
                  {busy === card.tier
                    ? "Starting…"
                    : missing
                      ? "Not seeded"
                      : `Present ${card.name}`}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={onCancel}
            disabled={!!busy}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:bg-gray-800 disabled:opacity-50"
          >
            Cancel — exit Presentation Mode
          </button>
        </div>
      </div>
    </div>
  );
}
