/**
 * Echo · Planner (Echo department → Reminders & Tasks). Owner-only.
 *
 * The owner's personal reminder + task list, managed by voice ("remind me to
 * call Robert at 2pm tomorrow", "add a task", "mark off number two") or right
 * here. Reminders are delivered by Echo's voice at their time, with an SMS
 * fallback when the spoken alert isn't picked up. Tasks carry a priority:
 * high is flagged immediately (and SMS-alerted when overdue), medium appears
 * in the daily briefing, low is reviewed weekly.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";

const PRIORITY_META = {
  high: { label: "High", cls: "bg-red-500/15 text-red-400" },
  medium: { label: "Medium", cls: "bg-amber-500/15 text-amber-400" },
  low: { label: "Low", cls: "bg-gray-500/15 text-gray-400" },
};

const RECURRENCE_LABELS = {
  none: "One time",
  daily: "Every day",
  weekly: "Every week",
  monthly: "Every month",
};

function fmtDateTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function fmtDate(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

/** Local datetime string (YYYY-MM-DDTHH:mm) for <input type=datetime-local>. */
function toLocalInput(minutesAhead = 60) {
  const d = new Date(Date.now() + minutesAhead * 60000);
  d.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EchoPlanner() {
  const [tab, setTab] = useState("tasks");
  const [reminders, setReminders] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const [r, t] = await Promise.all([
        api.listAssistantReminders(),
        api.listAssistantTasks(),
      ]);
      setReminders(r.reminders || []);
      setTasks(t.tasks || []);
      setError("");
    } catch (e) {
      setError(e.message || "Couldn't load your planner.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Voice commands ("remind me to...") update the list live.
    const onUpdate = () => load(true);
    window.addEventListener("echoai:assistant-updated", onUpdate);
    return () => window.removeEventListener("echoai:assistant-updated", onUpdate);
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-1 text-xl font-semibold text-white">Reminders &amp; Tasks</div>
      <p className="mb-5 text-sm text-gray-400">
        Your personal planner, managed by voice or right here. Try saying: "Echo, remind me
        to call the bank at 2 PM tomorrow" or "add a task to review the ad budget."
      </p>

      <div className="mb-5 flex gap-1 rounded-lg bg-gray-900/60 p-1">
        {[
          { key: "tasks", label: `Tasks${tasks.filter((t) => t.status === "open").length ? ` (${tasks.filter((t) => t.status === "open").length})` : ""}` },
          { key: "reminders", label: `Reminders${reminders.filter((r) => ["scheduled", "notifying"].includes(r.status)).length ? ` (${reminders.filter((r) => ["scheduled", "notifying"].includes(r.status)).length})` : ""}` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
              tab === t.key ? "bg-teal-500 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>
      )}
      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : tab === "tasks" ? (
        <TasksView tasks={tasks} reload={() => load(true)} />
      ) : (
        <RemindersView reminders={reminders} reload={() => load(true)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
function TasksView({ tasks, reload }) {
  const [text, setText] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "completed").slice(0, 15);

  async function addTask() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.createAssistantTask({ text: t, priority, ...(dueDate ? { dueDate } : {}) });
      setText("");
      setDueDate("");
      setPriority("medium");
      await reload();
    } catch (e) {
      setError(e.message || "Couldn't add the task.");
    } finally {
      setBusy(false);
    }
  }

  async function act(fn) {
    setError("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e.message || "That didn't work — please try again.");
    }
  }

  const today = new Date(new Date().toDateString());

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="min-w-[200px] flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-teal-500 focus:outline-none"
          placeholder="Add a task… e.g. Review the ad budget"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
          disabled={busy}
        />
        <select
          className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-2 text-sm text-white focus:border-teal-500 focus:outline-none"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          <option value="high">High priority</option>
          <option value="medium">Medium priority</option>
          <option value="low">Low priority</option>
        </select>
        <input
          type="date"
          className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-2 text-sm text-white focus:border-teal-500 focus:outline-none"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <button
          className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={addTask}
          disabled={busy || !text.trim()}
        >
          Add
        </button>
      </div>
      {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>}

      {open.length === 0 && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-6 text-center text-sm text-gray-500">
          Your task list is clear.
        </div>
      )}
      <div className="flex flex-col gap-2">
        {open.map((t) => {
          const overdue = t.dueDate && new Date(t.dueDate) < today;
          const p = PRIORITY_META[t.priority] || PRIORITY_META.medium;
          return (
            <div
              key={t.taskId}
              className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2.5"
            >
              <button
                title="Mark done"
                onClick={() => act(() => api.completeAssistantTask(t.taskId))}
                className="h-5 w-5 flex-none rounded-full border-2 border-gray-600 transition hover:border-teal-400"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-gray-100">{t.text}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded px-1.5 py-0.5 font-medium ${p.cls}`}>{p.label}</span>
                  {t.dueDate && (
                    <span className={overdue ? "font-medium text-red-400" : "text-gray-500"}>
                      {overdue ? "Overdue — " : "Due "}
                      {fmtDate(t.dueDate)}
                    </span>
                  )}
                  {t.source === "auto" && (
                    <span className="text-gray-500">added by Echo (hot lead)</span>
                  )}
                </div>
              </div>
              <button
                title="Delete"
                onClick={() => act(() => api.deleteAssistantTask(t.taskId))}
                className="flex-none px-1 text-gray-600 transition hover:text-red-400"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {done.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Recently completed
          </div>
          <div className="flex flex-col gap-1.5">
            {done.map((t) => (
              <div
                key={t.taskId}
                className="flex items-center gap-2 rounded-md bg-gray-900/40 px-3 py-2 text-sm text-gray-500"
              >
                <span className="text-teal-500">✓</span>
                <span className="flex-1 truncate line-through">{t.text}</span>
                <span className="text-xs">{fmtDate(t.completedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------
function RemindersView({ reminders, reload }) {
  const [text, setText] = useState("");
  const [dueAt, setDueAt] = useState(toLocalInput());
  const [recurrence, setRecurrence] = useState("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const active = reminders.filter((r) => ["scheduled", "notifying", "delivered"].includes(r.status));
  const past = reminders
    .filter((r) => ["completed", "cancelled"].includes(r.status))
    .slice(0, 10);

  async function addReminder() {
    const t = text.trim();
    if (!t || !dueAt || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.createAssistantReminder({
        text: t,
        dueAt: new Date(dueAt).toISOString(),
        recurrence,
      });
      setText("");
      setDueAt(toLocalInput());
      setRecurrence("none");
      await reload();
    } catch (e) {
      setError(e.message || "Couldn't set the reminder.");
    } finally {
      setBusy(false);
    }
  }

  async function act(fn) {
    setError("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e.message || "That didn't work — please try again.");
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="min-w-[200px] flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-teal-500 focus:outline-none"
          placeholder="Remind me to… e.g. Call the bank"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addReminder()}
          disabled={busy}
        />
        <input
          type="datetime-local"
          className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-2 text-sm text-white focus:border-teal-500 focus:outline-none"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
        />
        <select
          className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-2 text-sm text-white focus:border-teal-500 focus:outline-none"
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value)}
        >
          <option value="none">One time</option>
          <option value="daily">Every day</option>
          <option value="weekly">Every week</option>
          <option value="monthly">Every month</option>
        </select>
        <button
          className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={addReminder}
          disabled={busy || !text.trim() || !dueAt}
        >
          Set
        </button>
      </div>
      {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>}

      {active.length === 0 && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-6 text-center text-sm text-gray-500">
          No upcoming reminders. Echo will speak each reminder at its time, and text you if
          you're away.
        </div>
      )}
      <div className="flex flex-col gap-2">
        {active.map((r) => (
          <div
            key={r.reminderId}
            className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-gray-100">{r.text}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span className="text-teal-400">{fmtDateTime(r.dueAt)}</span>
                {r.recurrence !== "none" && <span>{RECURRENCE_LABELS[r.recurrence]}</span>}
                {r.status === "delivered" && (
                  <span className="text-amber-400">
                    delivered{r.deliveryChannel === "sms" ? " by text" : ""}
                  </span>
                )}
              </div>
            </div>
            {r.status === "delivered" && (
              <button
                onClick={() => act(() => api.completeAssistantReminder(r.reminderId))}
                className="flex-none rounded-md bg-teal-500/15 px-2.5 py-1 text-xs font-medium text-teal-400 transition hover:bg-teal-500/25"
              >
                Done
              </button>
            )}
            <button
              title="Cancel reminder"
              onClick={() => act(() => api.deleteAssistantReminder(r.reminderId))}
              className="flex-none px-1 text-gray-600 transition hover:text-red-400"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {past.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Recent history
          </div>
          <div className="flex flex-col gap-1.5">
            {past.map((r) => (
              <div
                key={r.reminderId}
                className="flex items-center gap-2 rounded-md bg-gray-900/40 px-3 py-2 text-sm text-gray-500"
              >
                <span className={r.status === "completed" ? "text-teal-500" : "text-gray-600"}>
                  {r.status === "completed" ? "✓" : "—"}
                </span>
                <span className="flex-1 truncate line-through">{r.text}</span>
                <span className="text-xs">{fmtDate(r.dueAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
