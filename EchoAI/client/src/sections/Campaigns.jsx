import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [optimizing, setOptimizing] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getCampaigns();
      setCampaigns(data.campaigns || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleOptimize() {
    setOptimizing(true);
    setNotice("");
    setError("");
    try {
      const data = await api.optimizeCampaigns();
      setNotice(
        `Optimization complete — ${data.optimized || 0} campaign(s) adjusted.`
      );
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setOptimizing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-900">Campaigns</h2>
        <button
          onClick={handleOptimize}
          disabled={optimizing}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {optimizing ? "Optimizing…" : "Optimize campaigns"}
        </button>
      </div>

      {notice && (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
          {notice}
        </div>
      )}
      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="Loading campaigns…" />
      ) : campaigns.length === 0 ? (
        <p className="text-sm text-gray-500">No active campaigns.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Budget</th>
                <th className="px-4 py-3">Cost / lead</th>
                <th className="px-4 py-3">Conversion rate</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {campaigns.map((c) => (
                <tr key={c.campaignId}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {c.name || "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {formatMoney(c.budget)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {c.costPerLead != null ? formatMoney(c.costPerLead) : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {c.conversionRate != null ? `${c.conversionRate}%` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }) {
  const ok = status === "active";
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        ok ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
      }`}
    >
      {status || "unknown"}
    </span>
  );
}

function formatMoney(value) {
  if (value == null) return "—";
  const n = Number(value);
  return Number.isNaN(n) ? String(value) : `$${n.toFixed(2)}`;
}
