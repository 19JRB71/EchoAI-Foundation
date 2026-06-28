import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { pct } from "./emailShared.js";

export default function Analytics({ brandId, refreshKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!brandId) return;
    let active = true;
    setLoading(true);
    setError("");
    api
      .getEmailAnalytics(brandId)
      .then((d) => active && setData(d))
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [brandId, refreshKey]);

  if (loading) return <p className="text-sm text-gray-400">Loading analytics…</p>;
  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data) return null;

  const maxSent = Math.max(1, ...data.activity.map((d) => d.sent));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Campaigns" value={data.totalCampaigns} />
        <Card label="Sent this month" value={data.sentThisMonth} />
        <Card label="Avg open rate" value={pct(data.avgOpenRate)} />
        <Card label="Avg click rate" value={pct(data.avgClickRate)} />
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <h4 className="mb-4 text-sm font-semibold text-gray-200">
          Emails sent (last 30 days)
        </h4>
        <div className="flex h-40 items-end gap-1">
          {data.activity.map((d) => (
            <div key={d.day} className="group flex flex-1 flex-col items-center justify-end">
              <div
                className="w-full rounded-t bg-amber-500/70 transition group-hover:bg-amber-400"
                style={{ height: `${(d.sent / maxSent) * 100}%` }}
                title={`${d.day}: ${d.sent} sent, ${d.opened} opened`}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-xs text-gray-500">
          <span>{data.activity[0] && data.activity[0].day}</span>
          <span>{data.activity[data.activity.length - 1] && data.activity[data.activity.length - 1].day}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card label="Total sent" value={data.totalSent} />
        <Card label="Total opens" value={data.totalOpens} />
        <Card label="Total clicks" value={data.totalClicks} />
      </div>
    </div>
  );
}

function Card({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
      <div className="text-2xl font-bold text-gray-100">{value}</div>
      <div className="mt-1 text-xs text-gray-500">{label}</div>
    </div>
  );
}
