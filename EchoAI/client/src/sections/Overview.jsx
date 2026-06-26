import { useEffect, useState } from "react";
import { api } from "../api.js";
import MetricCard from "../components/MetricCard.jsx";
import LeadsBarChart from "../components/LeadsBarChart.jsx";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

export default function Overview({ brandId }) {
  const [summary, setSummary] = useState(null);
  const [weeks, setWeeks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!brandId) return;
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const [current, history] = await Promise.all([
          api.getCurrentWeek(brandId).catch(() => null),
          api.getAnalytics(brandId),
        ]);
        if (!active) return;
        setSummary(current && current.summary ? current.summary : null);
        const list = (history.analytics || []).slice(0, 4).reverse();
        setWeeks(list);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [brandId]);

  if (!brandId)
    return (
      <p className="text-sm text-gray-400">
        Select or create a brand to see your dashboard.
      </p>
    );
  if (loading) return <Spinner label="Loading dashboard…" />;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-100">Dashboard</h2>
      <ErrorBanner message={error} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Total spend this week"
          value={summary ? summary.totalSpend : "—"}
        />
        <MetricCard
          label="Total leads this week"
          value={summary ? summary.totalLeads : "—"}
        />
        <MetricCard
          label="Cost per lead this week"
          value={summary ? summary.costPerLead : "—"}
        />
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-gray-300">
          Leads over the last 4 weeks
        </h3>
        <LeadsBarChart data={weeks} />
      </div>
    </div>
  );
}
