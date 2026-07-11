// Step 5 — Confirmation & launch.
// Summarizes what was set up, runs a short countdown, then launches the
// customer into the dashboard with a congratulations message.

import { useEffect, useRef, useState } from "react";
import { api } from "../../api.js";

const TIER_LABELS = {
  starter: "Starter",
  pro: "Professional",
  enterprise: "Enterprise",
};

const primaryBtn =
  "rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60";

export default function StepConfirmation({
  facebookConnected,
  selectedTier,
  onLaunch,
}) {
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [brandComplete, setBrandComplete] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [launching, setLaunching] = useState(false);
  const launchedRef = useRef(false);

  // Pull real status for the summary.
  useEffect(() => {
    (async () => {
      try {
        const status = await api.getSubscriptionStatus();
        setSubscriptionActive(
          Boolean(status) &&
            status.paymentStatus === "active" &&
            status.subscriptionTier !== "free"
        );
      } catch {
        /* leave as not-active */
      }
      try {
        const data = await api.getBrands();
        setBrandComplete(Boolean(data.brands && data.brands.length > 0));
      } catch {
        /* leave as incomplete */
      }
    })();
  }, []);

  async function launch() {
    if (launchedRef.current) return;
    launchedRef.current = true;
    setLaunching(true);
    try {
      await onLaunch();
    } finally {
      setLaunching(false);
    }
  }

  // Countdown to launch.
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Auto-launch the dashboard once the countdown reaches zero.
  useEffect(() => {
    if (countdown === 0) launch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  const tierLabel = selectedTier ? TIER_LABELS[selectedTier] : null;

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6 text-center shadow-sm sm:p-10">
      <div className="text-4xl">🎉</div>
      <h1 className="mt-3 text-2xl font-bold text-gray-100">You're all set!</h1>
      <p className="mt-2 text-sm leading-relaxed text-gray-400">
        Congratulations — Zorecho is ready to go to work for your business.
      </p>

      <ul className="mx-auto mt-6 max-w-sm space-y-2 text-left">
        <SummaryItem ok={facebookConnected}>
          {facebookConnected
            ? "Facebook ad account connected"
            : "Facebook connection — finish later in Settings"}
        </SummaryItem>
        <SummaryItem ok={subscriptionActive}>
          {subscriptionActive
            ? `Subscription active${tierLabel ? ` — ${tierLabel}` : ""}`
            : "Subscription pending"}
        </SummaryItem>
        <SummaryItem ok={brandComplete}>
          {brandComplete
            ? "Brand profile complete"
            : "Brand profile — finish later in Settings"}
        </SummaryItem>
      </ul>

      <div className="mt-8 rounded-lg bg-amber-500/10 p-4 text-sm text-amber-300">
        Your first campaign will be built and launched within the next{" "}
        <span className="font-semibold">24 hours</span>.
      </div>

      {selectedTier === "enterprise" && (
        <div className="mt-4 rounded-lg bg-indigo-500/10 p-4 text-left text-sm text-indigo-200">
          <p className="font-semibold text-indigo-100">
            Your Customer Intelligence Engine is warming up
          </p>
          <p className="mt-1 leading-relaxed text-indigo-200/90">
            As an Enterprise customer, our AI strategist will study every channel —
            ads, leads, calls, SMS, email, social, reviews and more — and build a
            growing weekly intelligence profile with ranked, data-grounded
            recommendations. Your first strategic brief lands after about a week of
            data; it gets sharper every week as it learns your business.
          </p>
        </div>
      )}

      <button onClick={launch} disabled={launching} className={`${primaryBtn} mt-8`}>
        {launching
          ? "Launching…"
          : countdown > 0
          ? `Launching dashboard in ${countdown}…`
          : "Go to dashboard"}
      </button>
    </div>
  );
}

function SummaryItem({ ok, children }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span
        className={[
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          ok ? "bg-green-100 text-green-700" : "bg-gray-800 text-gray-400",
        ].join(" ")}
      >
        {ok ? "✓" : "•"}
      </span>
      <span className={ok ? "text-gray-200" : "text-gray-400"}>{children}</span>
    </li>
  );
}
