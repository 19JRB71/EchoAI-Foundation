import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { goalAlertMeta } from "../lib/goals.js";

// Settings card: the brand's full 30-day goal-alert history (including
// dismissed alerts, shown faded), with the same dismiss/mute controls as the
// Mission Control feed. Owner/admin-only — the parent gates rendering the same
// way Mission Control's alert data is owner-scoped.

function whenLabel(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function GoalAlertHistory({ brandId }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null); // alertId or goalId in flight
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.getGoalAlerts(brandId);
      setAlerts(Array.isArray(data && data.alerts) ? data.alerts : []);
    } catch (err) {
      setError(err.message || "Couldn't load the alert history.");
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  // Dismiss one alert. In the history the row STAYS visible (faded) so the
  // 30-day record remains browsable — unlike the Mission Control feed.
  async function dismissAlert(alert) {
    if (!alert.alertId || busy) return;
    setBusy(alert.alertId);
    setActionError("");
    try {
      await api.dismissGoalAlert(brandId, alert.alertId);
      setAlerts((prev) =>
        prev.map((a) =>
          a.alertId === alert.alertId ? { ...a, dismissed: true } : a
        )
      );
    } catch (err) {
      setActionError(err.message || "Couldn't dismiss that alert.");
    } finally {
      setBusy(null);
    }
  }

  // Mute/unmute future alerts for the alert's goal. All history rows for that
  // goal flip together (muted state lives on the goal, not the alert).
  async function toggleMute(alert) {
    if (busy) return;
    const next = !alert.muted;
    setBusy(alert.goalId);
    setActionError("");
    try {
      await api.muteGoalAlerts(brandId, alert.goalId, next);
      setAlerts((prev) =>
        prev.map((a) => (a.goalId === alert.goalId ? { ...a, muted: next } : a))
      );
    } catch (err) {
      setActionError(err.message || "Couldn't update alert muting.");
    } finally {
      setBusy(null);
    }
  }

  if (!brandId) return null;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold uppercase tracking-wide text-gray-200">
          Goal Alert History
        </h3>
        <span className="text-xs text-gray-500">Last 30 days</span>
      </div>
      <p className="mb-4 text-xs text-gray-400">
        Every alert the daily goal sweep logged for this business — including
        ones you've dismissed.
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      {actionError && (
        <p className="mb-3 text-xs text-red-400">{actionError}</p>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading alert history…</p>
      ) : alerts.length === 0 && !error ? (
        <p className="text-sm text-gray-500">
          No goal alerts in the last 30 days.
        </p>
      ) : (
        <div className="space-y-2">
          {alerts.map((g) => {
            const m = goalAlertMeta(g.kind);
            const rowBusy = busy === g.alertId || busy === g.goalId;
            return (
              <div
                key={g.alertId || `${g.goalId}-${g.kind}-${g.alertDate}`}
                className={[
                  "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2",
                  g.dismissed ? "opacity-50" : "",
                ].join(" ")}
              >
                <div className="min-w-0">
                  <div>
                    <span className="text-sm text-gray-100">{g.label}</span>
                    {g.muted && (
                      <span className="ml-2 rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-semibold text-gray-400">
                        Muted
                      </span>
                    )}
                    {g.dismissed && (
                      <span className="ml-2 rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-semibold text-gray-400">
                        Dismissed
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
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    style={{ color: m.color, backgroundColor: `${m.color}1f` }}
                  >
                    {m.label}
                  </span>
                  <button
                    onClick={() => toggleMute(g)}
                    disabled={rowBusy}
                    title={
                      g.muted
                        ? "Resume alerts for this goal"
                        : "Stop future alerts for this goal"
                    }
                    className="rounded-lg border border-gray-700 px-2 py-1 text-[11px] font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                  >
                    {g.muted ? "Unmute" : "Mute"}
                  </button>
                  {g.alertId && !g.dismissed && (
                    <button
                      onClick={() => dismissAlert(g)}
                      disabled={rowBusy}
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
      )}
    </div>
  );
}
