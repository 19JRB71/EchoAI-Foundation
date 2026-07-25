// AI Workforce Capacity meter — shows how much of the plan's included monthly
// AI work has been used, as a PERCENTAGE only (dollar costs stay internal).
// Notify-only: nothing is throttled or billed when the meter fills up.

import { useEffect, useState } from "react";
import { api } from "../../api.js";

const STATUS_STYLES = {
  healthy: { text: "text-emerald-400", label: "Healthy" },
  moderate: { text: "text-amber-400", label: "Moderate" },
  high: { text: "text-orange-400", label: "Near capacity" },
  at_capacity: { text: "text-red-400", label: "At capacity" },
};

// CEO-approved progress-bar color bands: green 0–70%, amber 70–90%, red 90–100%.
function barColor(pct) {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

const CAPACITY_TOOLTIP =
  "Conversations with Echo, voice calls, research, automations, and content creation all contribute to your monthly capacity.";

export default function AiCapacityCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [showTip, setShowTip] = useState(false);

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
  const breakdown = Array.isArray(data.usageBreakdown) ? data.usageBreakdown : [];

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-300">
          AI Workforce Capacity
          <span
            className="relative inline-flex"
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
          >
            <button
              type="button"
              aria-label="What counts toward capacity?"
              title={CAPACITY_TOOLTIP}
              onClick={() => setShowTip((v) => !v)}
              className="flex h-4 w-4 items-center justify-center rounded-full border border-gray-600 text-[10px] font-bold text-gray-400 hover:border-gray-400 hover:text-gray-200"
            >
              i
            </button>
            {showTip && (
              <span className="absolute left-1/2 top-6 z-10 w-64 -translate-x-1/2 rounded-lg border border-gray-700 bg-gray-950 p-3 text-xs font-normal normal-case text-gray-300 shadow-lg">
                {CAPACITY_TOOLTIP}
              </span>
            )}
          </span>
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
          className={`h-full rounded-full transition-all ${barColor(pct)}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mb-3 flex gap-6 text-sm">
        <div>
          <p className="text-gray-400">AI tasks completed</p>
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

      {breakdown.length > 0 && (
        <div className="mb-3">
          <h4 className="mb-1.5 text-xs font-semibold text-gray-400">
            What&apos;s using my AI Workforce?
          </h4>
          <ul className="space-y-1">
            {breakdown.map((b) => (
              <li
                key={b.key}
                className="flex items-center justify-between text-xs text-gray-400"
              >
                <span>{b.label}</span>
                <span className="font-medium text-gray-300">
                  {(b.tasks || 0).toLocaleString()} task{b.tasks === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.note && <p className="text-xs text-gray-500">{data.note}</p>}
    </div>
  );
}
