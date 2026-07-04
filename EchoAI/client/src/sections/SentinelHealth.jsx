import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import Spinner from "../components/Spinner.jsx";

// Sentinel · Health — the owner-facing oversight department. A read-only view over
// the existing health-monitor endpoints (status / history / on-demand check). No
// new backend: it presents what Sentinel already tracks in four tabs.

const OVERALL = {
  healthy: { label: "All systems healthy", color: "#22c55e" },
  warning: { label: "Minor issues detected", color: "#f59e0b" },
  critical: { label: "Action needed", color: "#ef4444" },
  unknown: { label: "Not checked yet", color: "#6b7280" },
};

const SEV_COLOR = { critical: "#ef4444", warning: "#f59e0b", info: "#38bdf8" };

const TABS = [
  { key: "monitor", label: "Health Monitor" },
  { key: "autofix", label: "Auto-Fix Log" },
  { key: "errors", label: "Error History" },
  { key: "platform", label: "Platform Status" },
];

function when(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function issueText(issue) {
  if (!issue) return "";
  if (typeof issue === "string") return issue;
  return issue.message || issue.detail || issue.type || "Issue";
}

function IssueRow({ issue }) {
  const sev = (issue && issue.severity) || "warning";
  return (
    <li className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-gray-200">{issueText(issue)}</span>
        {issue && issue.severity && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
            style={{ color: SEV_COLOR[sev] || "#94a3b8", backgroundColor: `${SEV_COLOR[sev] || "#94a3b8"}18` }}
          >
            {sev}
          </span>
        )}
      </div>
      {issue && issue.system && (
        <div className="mt-0.5 text-xs text-gray-500">{issue.system}</div>
      )}
    </li>
  );
}

export default function SentinelHealth({ brandId, initialTab = "monitor" }) {
  const [tab, setTab] = useState(initialTab);
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const load = useCallback(async () => {
    if (!brandId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [s, h] = await Promise.all([
        api.healthGetStatus(brandId),
        api.healthGetHistory(brandId).catch(() => ({ checks: [] })),
      ]);
      setStatus(s);
      setHistory(asArray(h.checks));
    } catch (err) {
      setError(err.message || "Couldn't load Sentinel's health data.");
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  async function runCheck() {
    if (!brandId || running) return;
    setRunning(true);
    setError("");
    try {
      await api.healthRunCheck(brandId);
      await load();
    } catch (err) {
      setError(err.message || "Health check failed.");
    } finally {
      setRunning(false);
    }
  }

  if (!brandId) {
    return (
      <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 text-sm text-gray-400">
        Add a brand to let Sentinel monitor your account.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner label="Loading Sentinel…" />
      </div>
    );
  }

  const overall = (status && status.overallStatus) || "unknown";
  const o = OVERALL[overall] || OVERALL.unknown;
  const attention = asArray(status && status.issuesRequiringAttention);

  // Auto-fixed issues, newest first, flattened from history.
  const autoFixed = history.flatMap((c) =>
    asArray(c.issues_auto_fixed).map((issue) => ({ issue, ts: c.check_time })),
  );

  // Platform status: mark any system referenced by an outstanding issue degraded.
  const degraded = new Set(
    attention.map((i) => (i && i.system) || "").filter(Boolean),
  );
  const SYSTEMS = ["Facebook", "Twilio", "Stripe", "Email", "Scheduler", "Tokens", "Follow-ups", "SMS", "Webhooks"];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: o.color }} />
          <div>
            <div className="text-lg font-bold text-gray-100">{o.label}</div>
            <div className="text-xs text-gray-500">
              {status && status.lastCheck ? `Last checked ${when(status.lastCheck)}` : "No sweep run yet"}
            </div>
          </div>
        </div>
        <button
          onClick={runCheck}
          disabled={running}
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"
        >
          {running ? "Running…" : "Run check now"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
              tab === t.key
                ? "bg-red-500/15 text-red-300"
                : "border border-gray-800 text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "monitor" && (
        <div className="space-y-4">
          {status && status.aiAnalysis && (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sentinel's analysis</div>
              <p className="mt-2 text-sm leading-relaxed text-gray-200">{status.aiAnalysis}</p>
            </div>
          )}
          <div>
            <div className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-300">Issues needing attention</div>
            {attention.length === 0 ? (
              <p className="text-sm text-gray-500">Nothing needs your attention right now.</p>
            ) : (
              <ul className="space-y-2">
                {attention.map((issue, i) => (
                  <IssueRow key={i} issue={issue} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === "autofix" && (
        <div>
          <div className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-300">Automatically resolved</div>
          {autoFixed.length === 0 ? (
            <p className="text-sm text-gray-500">Sentinel hasn't needed to auto-fix anything yet.</p>
          ) : (
            <ul className="space-y-2">
              {autoFixed.map((row, i) => (
                <li key={i} className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-gray-200">{issueText(row.issue)}</span>
                    <span className="shrink-0 text-[11px] text-gray-500">{when(row.ts)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "errors" && (
        <div>
          <div className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-300">Recent health sweeps</div>
          {history.length === 0 ? (
            <p className="text-sm text-gray-500">No sweeps recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((c) => {
                const co = OVERALL[c.overall_status] || OVERALL.unknown;
                return (
                  <li key={c.check_id} className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-medium text-gray-200">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: co.color }} />
                        {co.label}
                      </span>
                      <span className="shrink-0 text-[11px] text-gray-500">{when(c.check_time)}</span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {asArray(c.issues_found).length} found · {asArray(c.issues_auto_fixed).length} auto-fixed
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === "platform" && (
        <div>
          <div className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-300">Connected systems</div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {SYSTEMS.map((sys) => {
              const bad = degraded.has(sys);
              const color = bad ? "#f59e0b" : "#22c55e";
              return (
                <div key={sys} className="flex items-center gap-3 rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-gray-100">{sys}</div>
                    <div className="text-xs" style={{ color }}>{bad ? "Needs attention" : "Operational"}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-gray-500">
            A system shows as needing attention when Sentinel's latest sweep flagged an issue for it.
          </p>
        </div>
      )}
    </div>
  );
}
