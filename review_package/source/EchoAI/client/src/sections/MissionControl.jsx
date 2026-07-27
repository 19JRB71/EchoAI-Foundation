import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import Spinner from "../components/Spinner.jsx";
import { ScoreRing, GoalRow } from "../components/GoalsPanel.jsx";
import { brandTypeLabel, goalAlertMeta } from "../lib/goals.js";

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

export default function MissionControl({ brandId, onNavigate, onOpenDepartment }) {
  const [data, setData] = useState(null);
  const [goals, setGoals] = useState(null);
  const [goalAlerts, setGoalAlerts] = useState([]);
  const [failedPosts, setFailedPosts] = useState([]);
  const [alertBusy, setAlertBusy] = useState(null); // alertId or goalId in flight
  const [alertError, setAlertError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [mc, goalsOverview] = await Promise.all([
        api.getMissionControl(brandId),
        api.getGoalsOverview(brandId).catch(() => null),
      ]);
      setData(mc);
      setGoals(goalsOverview);
      setGoalAlerts(Array.isArray(mc && mc.goalAlerts) ? mc.goalAlerts : []);
      setFailedPosts(Array.isArray(mc && mc.failedPosts) ? mc.failedPosts : []);
      setAlertError("");
    } catch (err) {
      setError(err.message || "Couldn't load Mission Control.");
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  // Dismiss a single logged alert (removes it from the feed on success).
  async function dismissAlert(alert) {
    if (!alert.alertId || alertBusy) return;
    setAlertBusy(alert.alertId);
    setAlertError("");
    try {
      await api.dismissGoalAlert(alert.brandId, alert.alertId);
      setGoalAlerts((prev) => prev.filter((a) => a.alertId !== alert.alertId));
    } catch (err) {
      setAlertError(err.message || "Couldn't dismiss that alert.");
    } finally {
      setAlertBusy(null);
    }
  }

  // Mute/unmute future alerts for the alert's goal (feed rows stay visible so
  // the owner can unmute from the same place).
  async function toggleMute(alert) {
    if (alertBusy) return;
    const next = !alert.muted;
    setAlertBusy(alert.goalId);
    setAlertError("");
    try {
      await api.muteGoalAlerts(alert.brandId, alert.goalId, next);
      setGoalAlerts((prev) =>
        prev.map((a) => (a.goalId === alert.goalId ? { ...a, muted: next } : a))
      );
    } catch (err) {
      setAlertError(err.message || "Couldn't update alert muting.");
    } finally {
      setAlertBusy(null);
    }
  }

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
              onClick={() =>
                onNavigate && onNavigate("settings", { focus: "goals" })
              }
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-gray-800"
            >
              Manage Goals
            </button>
          </div>

          {/* Every goal for every real business, grouped by business */}
          {Array.isArray(goals.perBrand) && goals.perBrand.length > 0 && (
            <div className="mt-4 space-y-4">
              {goals.perBrand.map((b) => (
                <div
                  key={b.brandId}
                  className="rounded-xl border border-gray-800 bg-gray-950/50 p-3"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-gray-800 pb-2">
                    {/* Clicking a business's header opens Settings with THAT
                        business selected, landed on its goals + alert history
                        cards — same deep link the alert feed rows use. */}
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate &&
                        onNavigate("settings", {
                          brandId: b.brandId,
                          focus: "goals",
                        })
                      }
                      title={`Open ${b.brandName}'s goals & alert history`}
                      aria-label={`Open ${b.brandName}'s goals & alert history`}
                      className="group min-w-0 rounded-md text-left hover:opacity-80"
                    >
                      <span className="truncate text-sm font-semibold text-gray-100">
                        {b.brandName}
                      </span>
                      <span className="ml-2 text-[11px] text-gray-500">
                        {brandTypeLabel(b.brandType)}
                      </span>
                      <span className="ml-2 text-[11px] font-semibold text-teal-400 opacity-70 group-hover:opacity-100">
                        Manage →
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-2 text-[11px] text-gray-400">
                      <span>
                        {b.goalCount} goal{b.goalCount === 1 ? "" : "s"}
                        {b.atRisk > 0 ? ` · ${b.atRisk} at risk` : ""}
                      </span>
                      <span className="rounded-full bg-gray-800 px-2 py-0.5 font-bold text-gray-200">
                        {b.score == null ? "—" : `${b.score}`}
                      </span>
                    </div>
                  </div>
                  {Array.isArray(b.goals) && b.goals.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      {b.goals.map((g) => (
                        <GoalRow key={g.goalId} goal={g} />
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-gray-500">
                      No active goals for this business.
                    </p>
                  )}
                </div>
              ))}
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

      {/* Geographic coverage */}
      {data.geoCoverage && (
        <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-200">Marketing coverage</div>
              <div className="mt-1 text-sm text-gray-400">
                {data.geoCoverage.configured
                  ? data.geoCoverage.summary
                  : "No service area set — marketing runs nationwide. Set one in Settings under Where You Do Business."}
              </div>
            </div>
            {data.geoCoverage.exclusionCount > 0 && (
              <span className="shrink-0 rounded-full border border-red-700/60 bg-red-950/40 px-3 py-1 text-xs font-semibold text-red-300">
                {data.geoCoverage.exclusionCount} excluded area
                {data.geoCoverage.exclusionCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
      )}

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

      {/* Failed scheduled posts (push is also sent the moment one fails; this
          feed catches owners without the PWA/notifications at next login).
          Rows come straight from posts in 'failed' status, so an entry
          disappears on its own once the post is rescheduled or deleted. */}
      {failedPosts.length > 0 && (
        <div className="mb-6 rounded-2xl border border-red-900/50 bg-red-950/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-red-200">
              {failedPosts.length} post{failedPosts.length === 1 ? "" : "s"} failed to publish
            </div>
            <button
              onClick={() => onNavigate && onNavigate("social")}
              className="text-xs font-semibold text-red-300 hover:text-red-200"
            >
              Open calendar →
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {failedPosts.map((p) => (
              <button
                key={p.postId}
                onClick={() => onNavigate && onNavigate("social")}
                title="Open the Social Media calendar to reschedule"
                className="block w-full rounded-lg border border-red-900/40 bg-gray-950/40 px-3 py-2 text-left hover:border-red-700/60"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-red-900/40 px-2 py-0.5 text-[11px] font-semibold capitalize text-red-200">
                    {p.platform}
                  </span>
                  <span className="text-sm text-gray-100">{p.brandName}</span>
                  <span className="text-[11px] text-gray-500">
                    {whenLabel(p.failedAt || p.scheduledTime)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-gray-400">{p.reason}</div>
                <div className="mt-0.5 text-[11px] font-semibold text-red-300">
                  Reschedule in calendar →
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Goal alerts logged by the daily sweep (voice/push are also sent). */}
      {goalAlerts.length > 0 && (
        <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-gray-200">
              Recent goal alerts
            </div>
            <button
              onClick={() =>
                onNavigate && onNavigate("settings", { focus: "goals" })
              }
              className="text-xs font-semibold text-teal-400 hover:text-teal-300"
            >
              Manage Goals →
            </button>
          </div>
          {alertError && (
            <p className="mt-2 text-xs text-red-400">{alertError}</p>
          )}
          <div className="mt-3 space-y-2">
            {goalAlerts.map((g) => {
              const m = goalAlertMeta(g.kind);
              const busy = alertBusy === g.alertId || alertBusy === g.goalId;
              return (
                <div
                  key={g.alertId || `${g.goalId}-${g.kind}-${g.alertDate}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2"
                >
                  {/* Clicking the alert opens Settings with THAT alert's
                      business selected, landed on the goals + alert history
                      cards — the feed spans every business the owner has. */}
                  <button
                    onClick={() =>
                      onNavigate &&
                      onNavigate("settings", {
                        brandId: g.brandId,
                        focus: "goals",
                      })
                    }
                    title={`Open ${g.brandName}'s goals & alert history`}
                    className="min-w-0 rounded-md text-left hover:opacity-80"
                  >
                    <div>
                      <span className="text-sm text-gray-100">{g.label}</span>
                      <span className="ml-2 text-xs text-gray-500">{g.brandName}</span>
                      {g.muted && (
                        <span className="ml-2 rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-semibold text-gray-400">
                          Muted
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-gray-500">
                      {g.percentToGoal != null && (
                        <span className="mr-2 font-semibold text-gray-400">
                          {Math.round(g.percentToGoal)}% to goal
                        </span>
                      )}
                      {whenLabel(g.createdAt || g.alertDate)}
                      <span className="ml-2 font-semibold text-teal-500">
                        View history →
                      </span>
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ color: m.color, backgroundColor: `${m.color}1f` }}
                    >
                      {m.label}
                    </span>
                    <button
                      onClick={() => toggleMute(g)}
                      disabled={busy}
                      title={
                        g.muted
                          ? "Resume alerts for this goal"
                          : "Stop future alerts for this goal"
                      }
                      className="rounded-lg border border-gray-700 px-2 py-1 text-[11px] font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                    >
                      {g.muted ? "Unmute" : "Mute"}
                    </button>
                    {g.alertId && (
                      <button
                        onClick={() => dismissAlert(g)}
                        disabled={busy}
                        title="Dismiss this alert"
                        className="rounded-lg border border-gray-700 px-2 py-1 text-[11px] font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
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
