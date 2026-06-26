import { useEffect, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

function formatDateTime(value) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function Row({ label, value, accent }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-800 py-3 last:border-0">
      <span className="text-sm text-gray-400">{label}</span>
      <span className={`text-sm font-medium ${accent || "text-gray-100"}`}>
        {value}
      </span>
    </div>
  );
}

export default function AdminHealth() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await api.adminGetHealth();
        if (active) setHealth(data);
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

  if (loading) return <Spinner label="Loading platform health…" />;
  if (error) return <ErrorBanner message={error} />;
  if (!health) return null;

  const running = health.scheduler?.status === "running";

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Scheduler
        </h3>
        <Row
          label="Status"
          value={running ? "Running" : "Stopped"}
          accent={running ? "text-green-600" : "text-red-600"}
        />
        <Row label="Schedule" value={health.scheduler?.description || "—"} />
        <Row
          label="Last weekly analytics run"
          value={formatDateTime(health.lastWeeklyAnalyticsRun)}
        />
        <Row
          label="Last optimization run"
          value={formatDateTime(health.lastOptimizationRun)}
        />
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
          System errors
        </h3>
        {health.systemErrors && health.systemErrors.length > 0 ? (
          <ul className="space-y-2 text-sm text-red-700">
            {health.systemErrors.map((e, i) => (
              <li key={i} className="rounded-lg bg-red-50 p-2">
                {typeof e === "string" ? e : JSON.stringify(e)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-400">No system errors logged.</p>
        )}
      </div>
    </div>
  );
}
