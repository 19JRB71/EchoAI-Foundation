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

  function launchSetupAgent() {
    window.dispatchEvent(new Event("echoai:open-setup-agent"));
  }

  const setupCard = (
    <div className="flex flex-col gap-4 rounded-xl border border-teal-500/40 bg-teal-500/10 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-sm font-semibold text-teal-200">
          Set up a new brand with AI
        </h3>
        <p className="mt-1 text-xs text-teal-100/70">
          Let the AI Setup Agent interview you and configure a whole brand
          workspace in minutes.
        </p>
      </div>
      <button
        onClick={launchSetupAgent}
        className="shrink-0 rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-teal-400"
      >
        Set up a new brand with AI
      </button>
    </div>
  );

  if (!brandId)
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-gray-100">Dashboard</h2>
        {setupCard}
        <p className="text-sm text-gray-400">
          Select or create a brand to see your dashboard.
        </p>
      </div>
    );
  if (loading) return <Spinner label="Loading dashboard…" />;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-100">Dashboard</h2>
      {setupCard}
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
