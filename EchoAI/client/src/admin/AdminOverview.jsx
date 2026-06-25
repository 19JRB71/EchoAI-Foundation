import { useEffect, useState } from "react";
import { api } from "../api.js";
import MetricCard from "../components/MetricCard.jsx";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

function money(n) {
  return `$${Number(n || 0).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  })}`;
}

export default function AdminOverview() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await api.adminGetStats();
        if (active) setStats(data);
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

  if (loading) return <Spinner label="Loading platform stats…" />;
  if (error) return <ErrorBanner message={error} />;
  if (!stats) return null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <MetricCard label="Total customers" value={stats.totalCustomers} />
      <MetricCard
        label="Active subscriptions"
        value={stats.activeSubscriptions}
      />
      <MetricCard
        label="Revenue this month"
        value={money(stats.revenueThisMonth)}
        hint="Monthly recurring revenue"
      />
      <MetricCard label="Total leads generated" value={stats.totalLeads} />
      <MetricCard label="Campaigns running" value={stats.campaignsRunning} />
      <MetricCard
        label="Ad spend managed"
        value={money(stats.adSpendManaged)}
        hint="Total campaign budgets"
      />
    </div>
  );
}
