import { useEffect, useState } from "react";
import { api } from "../api.js";

/**
 * Guided setup UI, driven by the server's real setup-status probes
 * (GET /api/setup/status/:brandId).
 *
 * Two modes:
 * - Per-section banner: when the active section has an associated guided
 *   setup that isn't finished, a collapsible step-by-step checklist appears
 *   at the top of the section.
 * - Overview card (section "overview"/"missioncontrol"): the full setup
 *   progress list with jump buttons to each unfinished feature.
 */

// Which guided setups belong to which dashboard section.
export const SECTION_FEATURES = {
  campaigns: ["brand"],
  settings: ["facebook", "push"],
  social: ["social"],
  contentcalendar: ["contentcalendar"],
  chatbot: ["chatbot"],
  appointments: ["appointments"],
  phone: ["phone"],
  sms: ["sms"],
  email: ["email"],
  googleseo: ["google"],
};

const OVERVIEW_SECTIONS = new Set(["overview", "missioncontrol"]);

function StepRow({ step }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          step.done ? "bg-emerald-500/20 text-emerald-400" : "border border-gray-600 text-transparent"
        }`}
        aria-hidden="true"
      >
        ✓
      </span>
      <span className={step.done ? "text-gray-500 line-through" : "text-gray-200"}>
        {step.label}
      </span>
    </li>
  );
}

export default function SetupGuide({ brandId, section, onNavigate }) {
  const [status, setStatus] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  const isOverview = OVERVIEW_SECTIONS.has(section);
  const featureKeys = SECTION_FEATURES[section] || [];

  useEffect(() => {
    let alive = true;
    setStatus(null);
    if (!brandId || (!isOverview && featureKeys.length === 0)) return undefined;
    api
      .getSetupStatus(brandId)
      .then((data) => {
        if (alive) setStatus(data);
      })
      .catch(() => {
        // Setup guidance is a helper — a failed probe just hides it.
        if (alive) setStatus(null);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, section]);

  if (!status || !Array.isArray(status.features)) return null;

  if (isOverview) {
    const probed = status.features.filter((f) => f.status !== "unknown");
    if (probed.length === 0) return null;
    const remaining = probed.filter((f) => f.status === "incomplete");
    if (remaining.length === 0) return null;
    const pct = Math.round((status.doneCount / Math.max(status.totalCount, 1)) * 100);
    return (
      <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-gray-100">
            Setup progress — {status.doneCount} of {status.totalCount} done
          </h3>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="text-xs text-gray-400 hover:text-gray-200"
          >
            {collapsed ? "Show" : "Hide"}
          </button>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        {!collapsed && (
          <ul className="mt-4 space-y-2">
            {remaining.map((f) => {
              const next = f.steps.find((s) => !s.done);
              return (
                <li
                  key={f.key}
                  className="flex items-center justify-between gap-3 rounded-lg bg-gray-800/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-200">{f.label}</div>
                    {next && (
                      <div className="truncate text-xs text-gray-400">Next: {next.label}</div>
                    )}
                  </div>
                  {onNavigate && (
                    <button
                      onClick={() => onNavigate(f.section)}
                      className="shrink-0 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/10"
                    >
                      Set up →
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  const relevant = status.features.filter(
    (f) => featureKeys.includes(f.key) && f.status === "incomplete"
  );
  if (relevant.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-amber-300">
          Finish setting this up
        </h3>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-xs text-gray-400 hover:text-gray-200"
        >
          {collapsed ? "Show steps" : "Hide"}
        </button>
      </div>
      {!collapsed && (
        <div className="mt-3 space-y-4">
          {relevant.map((f) => (
            <div key={f.key}>
              {relevant.length > 1 && (
                <div className="mb-1 text-xs font-medium text-gray-300">{f.label}</div>
              )}
              <ul className="space-y-1.5">
                {f.steps.map((s) => (
                  <StepRow key={s.label} step={s} />
                ))}
              </ul>
            </div>
          ))}
          <p className="text-xs text-gray-400">
            Work through the unchecked steps on this page — this guide updates
            automatically as you finish them.
          </p>
        </div>
      )}
    </div>
  );
}
