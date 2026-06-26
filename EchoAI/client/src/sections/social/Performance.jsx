import { useEffect, useState, useCallback } from "react";
import { api } from "../../api.js";
import Spinner from "../../components/Spinner.jsx";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import { PlatformBadge, platformMeta } from "./platformMeta.jsx";

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function metricValue(v) {
  return v == null ? "—" : v;
}

export default function Performance({ brandId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.getSocialPerformance(brandId);
      const sorted = [...(data.performance || [])].sort((a, b) => {
        const ta = a.publishedTime ? new Date(a.publishedTime).getTime() : 0;
        const tb = b.publishedTime ? new Date(b.publishedTime).getTime() : 0;
        return tb - ta;
      });
      setRows(sorted);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          Engagement for published posts, most recent first.
        </p>
        <button
          onClick={load}
          className="rounded-lg border border-gray-800 px-3 py-1.5 text-sm font-medium text-gray-400 hover:bg-gray-800"
        >
          Refresh
        </button>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="Loading performance…" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400">No published posts yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900 shadow-sm">
          <table className="min-w-full divide-y divide-gray-800 text-sm">
            <thead className="bg-gray-800 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-3">Platform</th>
                <th className="px-4 py-3">Post date</th>
                <th className="px-4 py-3">Likes</th>
                <th className="px-4 py-3">Shares</th>
                <th className="px-4 py-3">Reach</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {rows.map((row) => {
                const m = row.metrics || {};
                return (
                  <tr key={row.postId}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <PlatformBadge platform={row.platform} size={22} />
                        <span className="text-gray-300">
                          {platformMeta(row.platform).label}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {formatDate(row.publishedTime)}
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {metricValue(m.likes)}
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {metricValue(m.shares)}
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {m.error ? (
                        <span className="text-xs text-red-500">unavailable</span>
                      ) : (
                        metricValue(m.reach)
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
