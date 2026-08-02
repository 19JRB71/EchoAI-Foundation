import { useEffect, useState, useCallback } from "react";
import { api } from "../../api.js";
import Spinner from "../../components/Spinner.jsx";
import ErrorBanner from "../../components/ErrorBanner.jsx";

// Read-only Approvals & Activity (Prompt 009). Derives ONLY from the task
// spine (agent_tasks / agent_task_events) — never from social_posts — so what
// the owner sees is exactly what the audit trail can prove.

const STATUS_STYLES = {
  COMPLETED: "bg-emerald-900/60 text-emerald-300",
  REPORTED: "bg-emerald-900/60 text-emerald-300",
  EXTERNALLY_VERIFIED: "bg-emerald-900/60 text-emerald-300",
  PROVIDER_ACCEPTED: "bg-sky-900/60 text-sky-300",
  EXECUTING: "bg-sky-900/60 text-sky-300",
  QUEUED: "bg-gray-800 text-gray-300",
  APPROVED: "bg-gray-800 text-gray-300",
  RETRY_SCHEDULED: "bg-amber-900/60 text-amber-300",
  MANUAL_REVIEW: "bg-amber-900/60 text-amber-300",
  CANCELLED: "bg-gray-800 text-gray-500",
};

const FAILURE = new Set([
  "AUTH_REQUIRED",
  "PERMISSION_DENIED",
  "RATE_LIMITED",
  "VALIDATION_FAILED",
  "EXTERNAL_FAILURE",
]);

// Owner-readable labels — technical lifecycle names stay in the trail view.
const STATUS_LABELS = {
  APPROVED: "Approved",
  QUEUED: "Waiting to publish",
  EXECUTING: "Publishing…",
  PROVIDER_ACCEPTED: "Accepted by platform",
  EXTERNALLY_VERIFIED: "Verified live",
  REPORTED: "Reported",
  COMPLETED: "Completed",
  RETRY_SCHEDULED: "Retry scheduled",
  AUTH_REQUIRED: "Reconnect needed",
  PERMISSION_DENIED: "Permission denied",
  RATE_LIMITED: "Rate limited",
  VALIDATION_FAILED: "Rejected by platform",
  EXTERNAL_FAILURE: "Failed",
  MANUAL_REVIEW: "Needs your attention",
  CANCELLED: "Cancelled",
};

// Prompt 018: ad-launch tasks share the same lifecycle but read differently —
// a verified launch is a PAUSED chain at Facebook (nothing spends), not a
// live post.
const AD_LAUNCH_LABELS = {
  QUEUED: "Waiting to launch",
  EXECUTING: "Launching…",
  PROVIDER_ACCEPTED: "Created at Facebook (paused)",
  EXTERNALLY_VERIFIED: "Verified at Facebook (paused)",
};

function statusLabel(task) {
  if (task.task_type === "ad_launch" && AD_LAUNCH_LABELS[task.status]) {
    return AD_LAUNCH_LABELS[task.status];
  }
  return STATUS_LABELS[task.status] || task.status;
}

function badgeClass(status) {
  if (FAILURE.has(status)) return "bg-red-900/60 text-red-300";
  return STATUS_STYLES[status] || "bg-gray-800 text-gray-300";
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function Trail({ taskId }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .getTaskEvents(taskId)
      .then((data) => alive && setEvents(data.events || []))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [taskId]);

  if (error) return <p className="px-4 pb-3 text-xs text-red-400">{error}</p>;
  if (!events) return <div className="px-4 pb-3"><Spinner /></div>;
  return (
    <ol className="space-y-1 px-4 pb-3">
      {events.map((ev) => (
        <li key={ev.event_id} className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
          <span className="text-gray-500">{formatDate(ev.created_at)}</span>
          <span className="font-mono">
            {ev.from_status ? `${ev.from_status} → ${ev.to_status}` : `created at ${ev.to_status}`}
          </span>
          <span className="text-gray-600">by {ev.actor}</span>
        </li>
      ))}
    </ol>
  );
}

export default function ActivityPanel({ brandId }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openTask, setOpenTask] = useState(null);

  const load = useCallback(async () => {
    if (!brandId) return;
    setError("");
    try {
      const data = await api.getTaskActivity(brandId);
      setTasks(data.tasks || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-100">Approvals &amp; Activity</h3>
          <p className="text-sm text-gray-400">
            Every step of every publish and ad launch, exactly as it happened — from approval to verification.
          </p>
        </div>
        <button
          onClick={load}
          className="rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
        >
          Refresh
        </button>
      </div>
      {error && <ErrorBanner message={error} />}
      {tasks.length === 0 && !error ? (
        <p className="text-sm text-gray-400">
          No activity yet. When a post is scheduled or published, its full trail shows up here.
        </p>
      ) : (
        <ul className="divide-y divide-gray-800 rounded-lg border border-gray-800">
          {tasks.map((t) => (
            <li key={t.task_id}>
              <button
                className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left hover:bg-gray-800/50"
                onClick={() => setOpenTask(openTask === t.task_id ? null : t.task_id)}
              >
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${badgeClass(t.status)}`}>
                  {statusLabel(t)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-gray-200">{t.title}</span>
                <span className="text-xs text-gray-500">{formatDate(t.updated_at)}</span>
              </button>
              {t.last_error && (
                <p className="px-4 pb-2 text-xs text-red-400">{t.last_error}</p>
              )}
              {openTask === t.task_id && <Trail taskId={t.task_id} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
