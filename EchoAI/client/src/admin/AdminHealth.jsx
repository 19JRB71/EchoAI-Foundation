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

const STATUS_COLOR = {
  critical: "#ef4444",
  warning: "#f59e0b",
  healthy: "#22c55e",
  unknown: "#6b7280",
};

function StatusDot({ status }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ backgroundColor: STATUS_COLOR[status] || STATUS_COLOR.unknown }}
    />
  );
}

function AccountsHealth() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.adminGetAccountsHealth();
        if (active) setData(res);
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

  if (loading) return <Spinner label="Loading account health…" />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;

  const s = data.summary || {};
  return (
    <div className="mt-4 rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
        Account health ({data.accounts.length} brands)
      </h3>
      <div className="mb-4 flex flex-wrap gap-4 text-sm">
        <span className="flex items-center gap-1.5">
          <StatusDot status="critical" /> {s.critical || 0} critical
        </span>
        <span className="flex items-center gap-1.5">
          <StatusDot status="warning" /> {s.warning || 0} warning
        </span>
        <span className="flex items-center gap-1.5">
          <StatusDot status="healthy" /> {s.healthy || 0} healthy
        </span>
        <span className="flex items-center gap-1.5">
          <StatusDot status="unknown" /> {s.unknown || 0} not checked
        </span>
      </div>
      {data.accounts.length === 0 ? (
        <p className="text-sm text-gray-400">No brands yet.</p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-2">Brand</th>
                <th className="py-2">Owner</th>
                <th className="py-2">Status</th>
                <th className="py-2">Issues</th>
                <th className="py-2">Last check</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.brandId} className="border-t border-gray-800">
                  <td className="py-2 pr-2 font-medium text-gray-100">{a.brandName}</td>
                  <td className="py-2 pr-2 text-gray-400">{a.email}</td>
                  <td className="py-2 pr-2">
                    <span className="flex items-center gap-1.5">
                      <StatusDot status={a.overallStatus} />
                      <span className="capitalize text-gray-300">{a.overallStatus}</span>
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-gray-300">{a.issueCount}</td>
                  <td className="py-2 text-gray-500">{formatDateTime(a.lastCheck)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
    <>
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
    <AccountsHealth />
    </>
  );
}
