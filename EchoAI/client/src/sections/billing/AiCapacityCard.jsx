// AI Workforce Capacity meter — shows how much of the plan's included monthly
// AI work has been used, as a PERCENTAGE only (dollar costs stay internal).
// Notify-only: nothing is throttled or billed when the meter fills up.

import { useEffect, useState } from "react";
import { api } from "../../api.js";

const STATUS_STYLES = {
  healthy: { bar: "bg-emerald-500", text: "text-emerald-400", label: "Healthy" },
  moderate: { bar: "bg-amber-500", text: "text-amber-400", label: "Moderate" },
  high: { bar: "bg-orange-500", text: "text-orange-400", label: "Near capacity" },
  at_capacity: { bar: "bg-red-500", text: "text-red-400", label: "At capacity" },
};

export default function AiCapacityCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api
      .getAiCapacity()
      .then((d) => active && setData(d))
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, []);

  // Quietly hide rather than clutter billing with an error banner — the
  // capacity meter is informational, not critical.
  if (error) return null;
  if (!data) return null;

  const style = STATUS_STYLES[data.status] || STATUS_STYLES.healthy;
  const pct = Math.min(100, Math.max(0, Number(data.percentUsed) || 0));

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-300">
          AI Workforce Capacity
        </h3>
        <span className={`text-xs font-semibold ${style.text}`}>{style.label}</span>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        How much of your plan&apos;s included monthly AI work your team has used.
      </p>

      <div className="mb-2 flex items-end justify-between">
        <span className="text-2xl font-bold text-gray-100">{pct}%</span>
        <span className="text-xs text-gray-500">
          {data.daysLeftInCycle} day{data.daysLeftInCycle === 1 ? "" : "s"} left this
          month
        </span>
      </div>
      <div className="mb-4 h-2.5 w-full overflow-hidden rounded-full bg-gray-800">
        <div
          className={`h-full rounded-full transition-all ${style.bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mb-3 flex gap-6 text-sm">
        <div>
          <p className="text-gray-400">AI operations this month</p>
          <p className="font-semibold text-gray-200">
            {(data.operationsThisMonth || 0).toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-gray-400">Automated (background)</p>
          <p className="font-semibold text-gray-200">
            {(data.backgroundOperationsThisMonth || 0).toLocaleString()}
          </p>
        </div>
      </div>

      {data.note && <p className="text-xs text-gray-500">{data.note}</p>}
    </div>
  );
}
