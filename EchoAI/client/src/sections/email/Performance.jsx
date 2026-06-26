import { useEffect, useState, useCallback } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";

function pct(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

export default function Performance({ brandId, refreshKey }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getEmailCampaignPerformance(brandId);
      setRows(data.performance || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />

      {loading ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-400 shadow-sm">
          Loading performance…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400">
          No campaigns to report on yet. Performance appears once a campaign has
          been sent.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900 shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-800 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Sent</th>
                <th className="px-4 py-3 font-medium">Open rate</th>
                <th className="px-4 py-3 font-medium">Click rate</th>
                <th className="px-4 py-3 font-medium">Unsub rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {rows.map((r) => (
                <tr key={r.campaignId}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-100">{r.campaignName}</p>
                    <p className="text-xs capitalize text-gray-500">{r.status}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{r.sent}</td>
                  <td className="px-4 py-3 text-gray-300">{pct(r.openRate)}</td>
                  <td className="px-4 py-3 text-gray-300">{pct(r.clickRate)}</td>
                  <td className="px-4 py-3 text-gray-300">
                    {pct(r.unsubscribeRate)}
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
