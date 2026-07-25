import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-100">{value}</p>
    </div>
  );
}

export default function AnalyticsDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // notConnected = the user hasn't linked Google / Analytics yet (a 400),
  // which we present as a call-to-action rather than a hard error.
  const [notConnected, setNotConnected] = useState(false);
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotConnected(false);
    try {
      const result = await api.getGoogleAnalytics();
      setData(result);
    } catch (err) {
      if (err.status === 400) {
        setNotConnected(true);
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <p className="text-sm text-gray-400">Loading Google Analytics…</p>;
  }

  if (notConnected) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-400 shadow-sm">
        Connect your Google account in the{" "}
        <span className="font-medium text-amber-300">Google Connect</span> tab to
        see your Analytics traffic here.
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <ErrorBanner message={error} />
        <button
          onClick={load}
          className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data?.property) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-400 shadow-sm">
        No Google Analytics property was found on the connected account.
      </div>
    );
  }

  const m = data.metrics || {};
  const bounce = m.bounceRate != null ? `${(m.bounceRate * 100).toFixed(1)}%` : "—";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Sessions (30d)" value={(m.sessions ?? 0).toLocaleString()} />
        <StatCard label="Pageviews (30d)" value={(m.pageviews ?? 0).toLocaleString()} />
        <StatCard label="Bounce rate" value={bounce} />
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
        <h3 className="mb-3 text-base font-semibold text-gray-100">
          Top traffic sources
        </h3>
        {data.topSources?.length ? (
          <ul className="divide-y divide-gray-800">
            {data.topSources.map((s, i) => (
              <li key={i} className="flex items-center justify-between py-2 text-sm">
                <span className="text-gray-300">{s.source}</span>
                <span className="font-medium text-gray-100">
                  {s.sessions.toLocaleString()} sessions
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-400">No traffic source data available.</p>
        )}
      </div>
    </div>
  );
}
