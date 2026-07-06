import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import Spinner from "../components/Spinner.jsx";
import { ScoreRing } from "../components/GoalsPanel.jsx";
import { statusMeta, formatPercent, brandTypeLabel } from "../lib/goals.js";

// Mission Control — the command center that opens the dashboard. It rolls up the
// live status of the whole AI Marketing Department (from /api/agents/
// mission-control), Echo's morning briefing, this week's real numbers, and what's
// coming up. Every number is real activity pulled from the underlying subsystems.

const STATUS = {
  active: { label: "Active", color: "#22c55e" },
  working: { label: "Working", color: "#f59e0b" },
  attention: { label: "Needs you", color: "#ef4444" },
};

function StatusDot({ status }) {
  const s = STATUS[status] || STATUS.working;
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: s.color, boxShadow: `0 0 8px ${s.color}` }}
      title={s.label}
    />
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
      <div className="text-2xl font-extrabold" style={{ color: accent || "#e5e7eb" }}>
        {value}
      </div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wide text-gray-400">{label}</div>
    </div>
  );
}

function whenLabel(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function MissionControl({ onNavigate, onOpenDepartment }) {
  const [data, setData] = useState(null);
  const [goals, setGoals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [mc, goalsOverview] = await Promise.all([
        api.getMissionControl(),
        api.getGoalsOverview().catch(() => null),
      ]);
      setData(mc);
      setGoals(goalsOverview);
    } catch (err) {
      setError(err.message || "Couldn't load Mission Control.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner label="Assembling your team…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-6 text-sm text-red-300">
        {error}
        <button onClick={load} className="ml-3 font-semibold text-red-200 underline">
          Retry
        </button>
      </div>
    );
  }

  const stats = (data && data.stats) || {};
  const agents = (data && data.agents) || [];
  const upcoming = (data && data.upcoming) || [];
  const attention = agents.filter((a) => a.status === "attention");

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Mission Control</h2>
          <p className="mt-1 text-sm text-gray-400">
            {data && data.brandName ? `${data.brandName} · ` : ""}Your AI marketing department at a glance
          </p>
        </div>
        <button
          onClick={load}
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800"
        >
          Refresh
        </button>
      </div>

      {/* Echo's morning briefing */}
      <div className="mb-6 overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-950/60 to-gray-900/60 p-5">
        <div className="flex items-center gap-2">
          <span className="h-6 w-6 rounded-full" style={{ background: "radial-gradient(circle at 30% 30%, #2dd4bf, #0f766e)", boxShadow: "0 0 12px #14b8a688" }} />
          <span className="text-xs font-bold uppercase tracking-wider text-teal-300">Echo · Morning briefing</span>
        </div>
        <p className="mt-3 text-[15px] leading-relaxed text-gray-100">{data && data.briefing}</p>
      </div>

      {/* Goals Overview — cross-brand achievement score + attention */}
      {goals && goals.brandsWithGoals > 0 && (
        <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <ScoreRing score={goals.overallScore} label="Goal score" size={72} />
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wide text-gray-200">
                  Goals Overview
                </h3>
                <p className="mt-1 text-xs text-gray-400">
                  {goals.brandsWithGoals} business
                  {goals.brandsWithGoals === 1 ? "" : "es"} with active goals ·
                  overall achievement across all your goals this month
                </p>
              </div>
            </div>
            <button
              onClick={() => onNavigate && onNavigate("settings")}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-gray-800"
            >
              Manage Goals
            </button>
          </div>

          {/* Per-brand score chips */}
          {Array.isArray(goals.perBrand) && goals.perBrand.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {goals.perBrand.map((b) => (
                <div
                  key={b.brandId}
                  className="rounded-xl border border-gray-800 bg-gray-950/50 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-gray-100">
                      {b.brandName}
                    </span>
                    <span className="text-sm font-bold text-gray-200">
                      {b.score == null ? "—" : `${b.score}`}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                    <span>{brandTypeLabel(b.brandType)}</span>
                    <span>
                      {b.goalCount} goal{b.goalCount === 1 ? "" : "s"}
                      {b.atRisk > 0 ? ` · ${b.atRisk} at risk` : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* At-risk / milestone attention */}
          {Array.isArray(goals.attention) && goals.attention.length > 0 && (
            <div className="mt-4 space-y-2">
              {goals.attention.slice(0, 6).map((g) => {
                const m = statusMeta(g.status);
                return (
                  <div
                    key={`${g.brandId}-${g.goalId}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <span className="text-sm text-gray-100">{g.label}</span>
                      <span className="ml-2 text-xs text-gray-500">
                        {g.brandName}
                      </span>
                    </div>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ color: m.color, backgroundColor: m.bg }}
                    >
                      {m.label} · {formatPercent(g.percentToGoal)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* This week's numbers */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="New leads (7d)" value={stats.leadsThisWeek ?? 0} accent="#22c55e" />
        <StatCard label="Live campaigns" value={stats.activeCampaigns ?? 0} accent="#8b5cf6" />
        <StatCard label="Tasks running" value={stats.tasksRunning ?? 0} accent="#38bdf8" />
        <StatCard label="Done today" value={stats.completedToday ?? 0} accent="#14b8a6" />
        <StatCard label="Auto-fixed (7d)" value={stats.sentinelFixes ?? 0} accent="#f59e0b" />
      </div>

      {/* Attention banner */}
      {attention.length > 0 && (
        <div className="mb-6 rounded-2xl border border-amber-700/40 bg-amber-950/20 p-4">
          <div className="text-sm font-semibold text-amber-200">
            {attention.length} team member{attention.length === 1 ? "" : "s"} need your attention
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {attention.map((a) => (
              <button
                key={a.id}
                onClick={() => onOpenDepartment && onOpenDepartment(a.id)}
                className="rounded-full border px-3 py-1 text-xs font-medium"
                style={{ borderColor: `${a.color}66`, color: a.color, backgroundColor: `${a.color}14` }}
              >
                {a.name}: {a.currentTask}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Team status grid */}
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wide text-gray-300">Team status</h3>
            <button
              onClick={() => onNavigate && onNavigate("aiteam")}
              className="text-xs font-semibold text-teal-400 hover:text-teal-300"
            >
              Manage team →
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => onOpenDepartment && onOpenDepartment(a.id)}
                className="flex items-start gap-3 rounded-2xl border border-gray-800 bg-gray-900/60 p-4 text-left transition hover:border-gray-600"
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-black"
                  style={{ backgroundColor: a.color }}
                >
                  {a.name[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-gray-100">{a.name}</span>
                    <StatusDot status={a.status} />
                  </div>
                  <div className="truncate text-xs text-gray-400">{a.title}</div>
                  <div className="mt-1 truncate text-xs text-gray-300">{a.currentTask}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Upcoming actions */}
        <div>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-300">Coming up</h3>
          <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
            {upcoming.length === 0 ? (
              <p className="text-sm text-gray-500">Nothing scheduled yet. Your team will plan work as you activate features.</p>
            ) : (
              <ul className="space-y-3">
                {upcoming.map((u, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-teal-500" />
                    <div className="min-w-0">
                      <div className="truncate text-sm text-gray-200">{u.label}</div>
                      <div className="text-xs text-gray-500">{whenLabel(u.when)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
