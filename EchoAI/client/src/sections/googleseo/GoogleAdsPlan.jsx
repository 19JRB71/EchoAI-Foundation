import { useEffect, useState } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";

const VOLUME_STYLES = {
  high: "bg-green-500/15 text-green-400",
  medium: "bg-amber-500/15 text-amber-300",
  low: "bg-gray-700 text-gray-300",
};

export default function GoogleAdsPlan() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await api.getGoogleAdPlan();
        if (active) setPlan(data.plan || null);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-400 shadow-sm">
        Loading your Google Ads plan…
      </div>
    );
  }

  if (error) {
    return <ErrorBanner message={error} />;
  }

  if (!plan) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-400 shadow-sm">
        No Google Ads plan yet. When you opt in to Google ads during account setup,
        EchoAI builds a keyword targeting plan for you here.
      </div>
    );
  }

  const keywords = Array.isArray(plan.keywords) ? plan.keywords : [];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-100">Google Ads Campaign Plan</h3>
        <p className="mt-1 text-sm text-gray-400">
          A starter Google Search ads plan generated for {plan.brandName || "your brand"}.
        </p>
        <div className="mt-4 flex flex-wrap gap-6 text-sm">
          {plan.location && (
            <div>
              <span className="text-gray-500">Target area: </span>
              <span className="text-gray-200">{plan.location}</span>
            </div>
          )}
          {plan.monthlyBudget != null && (
            <div>
              <span className="text-gray-500">Monthly budget: </span>
              <span className="text-gray-200">${plan.monthlyBudget}/month</span>
            </div>
          )}
          <div>
            <span className="text-gray-500">Status: </span>
            <span className="capitalize text-gray-200">{plan.status}</span>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 shadow-sm">
        <h4 className="mb-3 text-sm font-semibold text-gray-200">
          Target keywords ({keywords.length})
        </h4>
        {keywords.length === 0 ? (
          <p className="text-sm text-gray-400">No keywords in this plan.</p>
        ) : (
          <ul className="divide-y divide-gray-800">
            {keywords.map((k, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-sm text-gray-200">{k.keyword}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {k.intent && <span className="text-xs text-gray-500">{k.intent}</span>}
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      VOLUME_STYLES[k.volume] || VOLUME_STYLES.low
                    }`}
                  >
                    {k.volume} volume
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
