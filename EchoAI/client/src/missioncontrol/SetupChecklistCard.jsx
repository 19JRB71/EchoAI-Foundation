// Company Setup checklist — a self-contained right-rail card on Mission
// Control. Statuses come from the server's LIVE probes (/api/guided-setup/
// checklist — "unknown" when a probe fails, never guessed). Fail-silent: any
// load error (including 403 for team members — the endpoint is owner-only)
// hides the card entirely, and it disappears on its own once every probed
// item is connected.

import { useEffect, useState } from "react";
import { api } from "../api";

export default function SetupChecklistCard({ onNavigate, onStatus }) {
  const [checklist, setChecklist] = useState(null);

  useEffect(() => {
    let active = true;
    api
      .getSetupChecklist()
      .then((data) => {
        if (!active) return;
        setChecklist(data);
        if (onStatus) onStatus(data);
      })
      .catch(() => {
        /* owner-only + non-critical — hide on any failure */
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!checklist || checklist.allDone || !Array.isArray(checklist.items)) return null;

  const { items, completedCount, probedTotal } = checklist;
  const percent = probedTotal > 0 ? Math.round((completedCount / probedTotal) * 100) : 0;

  return (
    <div
      className="rounded-2xl border border-cyan-950/70 bg-[#050b1d]/90 p-4"
      data-testid="setup-checklist-card"
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">
          AI Company Activation
        </div>
        <div className="text-[11px] font-semibold text-gray-400">{percent}% Complete</div>
      </div>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-800"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="AI Company Activation progress"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-700"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-200">
        Your AI team is running with limited capabilities until setup is complete — each
        connection below unlocks more of what they can do for you.
      </div>

      <ul className="mt-3 space-y-1.5">
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              onClick={() => onNavigate && onNavigate(item.section)}
              className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-cyan-950/40"
            >
              <StatusDot status={item.status} />
              <span className="min-w-0 flex-1 truncate text-[12px] text-gray-300">
                {item.label}
                {item.note && (
                  <span className="ml-1 text-[10px] text-gray-500">— {item.note}</span>
                )}
              </span>
              <span className="shrink-0 text-[10px] font-semibold text-gray-500">
                {statusLabel(item.status)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function statusLabel(status) {
  if (status === "connected") return "Done";
  if (status === "not_connected") return "Set up";
  if (status === "link") return "Open";
  return "Can't check";
}

function StatusDot({ status }) {
  const color =
    status === "connected"
      ? "bg-emerald-400"
      : status === "not_connected"
        ? "bg-gray-600"
        : status === "link"
          ? "bg-cyan-500"
          : "bg-amber-400";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} aria-hidden="true" />;
}
