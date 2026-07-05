import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.js";
import Spinner from "../../components/Spinner.jsx";
import ErrorBanner from "../../components/ErrorBanner.jsx";

// Pulse department — lead queue overview. Owners/admins see per-rep workload and
// throughput plus the live working queue, and can assign, prioritise or pull
// leads. Managers see the same view read-only (mutating controls are hidden).

const tempColors = {
  hot: "text-red-300",
  warm: "text-amber-300",
  cold: "text-sky-300",
};

export default function QueueOverview({ readOnly = false }) {
  const [overview, setOverview] = useState(null);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ov, q] = await Promise.all([
        api.crmQueueOverview(),
        api.crmGetQueue(),
      ]);
      setOverview(ov);
      setQueue(q.queue || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setPriority(lead) {
    const input = window.prompt(
      "Set queue priority (lower = worked sooner). Leave blank to clear.",
      lead.queuePriority ?? ""
    );
    if (input === null) return;
    setBusyId(lead.leadId);
    setError("");
    try {
      await api.crmSetPriority(lead.leadId, input.trim() === "" ? null : input.trim());
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  }

  async function removeFromQueue(lead) {
    if (
      !window.confirm(
        `Remove ${lead.name || "this lead"} from the working queue? Their history is kept.`
      )
    )
      return;
    setBusyId(lead.leadId);
    setError("");
    try {
      await api.crmRemoveFromQueue(lead.leadId);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  }

  if (loading) return <Spinner label="Loading queue…" />;

  return (
    <div className="space-y-6">
      {readOnly && (
        <div className="rounded-lg bg-sky-500/10 p-3 text-sm text-sky-300">
          You have read-only access. You can view the queue but not change it.
        </div>
      )}
      <ErrorBanner message={error} />

      {/* Per-rep workload */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-300">
            Sales rep workload
          </h3>
          <button
            onClick={load}
            className="rounded-lg border border-gray-700 px-3 py-1 text-xs font-semibold text-gray-300 hover:bg-gray-800"
          >
            Refresh
          </button>
        </div>
        {!overview || overview.reps.length === 0 ? (
          <p className="text-sm text-gray-400">
            No sales reps yet. Invite team members as Sales Reps to start
            distributing leads.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-4 font-medium">Rep</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium text-right">In progress</th>
                  <th className="py-2 pr-4 font-medium text-right">Today</th>
                  <th className="py-2 pr-4 font-medium text-right">This week</th>
                </tr>
              </thead>
              <tbody>
                {overview.reps.map((r) => (
                  <tr key={r.repUserId} className="border-b border-gray-800/60">
                    <td className="py-3 pr-4 text-gray-200">{r.repEmail}</td>
                    <td className="py-3 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                          r.status === "active"
                            ? "bg-green-500/15 text-green-400"
                            : "bg-gray-500/15 text-gray-400"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-right text-gray-200">
                      {r.inProgress}
                    </td>
                    <td className="py-3 pr-4 text-right text-gray-200">
                      {r.completedToday}
                    </td>
                    <td className="py-3 pr-4 text-right text-gray-200">
                      {r.completedWeek}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {overview && (
          <p className="mt-3 text-xs text-gray-500">
            Pool: {overview.pool.unassignedQueued} unassigned of{" "}
            {overview.pool.totalQueued} leads queued.
          </p>
        )}
      </div>

      {/* Live working queue */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="mb-4 text-sm font-semibold text-gray-300">
          Working queue
        </h3>
        {queue.length === 0 ? (
          <p className="text-sm text-gray-400">
            No leads in the working queue right now.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-4 font-medium">Lead</th>
                  <th className="py-2 pr-4 font-medium">State</th>
                  <th className="py-2 pr-4 font-medium">Assigned to</th>
                  <th className="py-2 pr-4 font-medium text-right">Priority</th>
                  {!readOnly && (
                    <th className="py-2 pr-4 font-medium text-right">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {queue.map((l) => {
                  const busy = busyId === l.leadId;
                  return (
                    <tr key={l.leadId} className="border-b border-gray-800/60">
                      <td className="py-3 pr-4">
                        <div className="text-gray-200">{l.name || "Unnamed"}</div>
                        <div className={`text-xs capitalize ${tempColors[l.temperature] || "text-gray-500"}`}>
                          {l.temperature || "—"}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs font-medium capitalize text-gray-300">
                          {l.queueState === "assigned" ? "in progress" : "queued"}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-gray-300">
                        {l.assignedRepEmail || (
                          <span className="text-gray-500">Unassigned pool</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right text-gray-300">
                        {l.queuePriority ?? "—"}
                      </td>
                      {!readOnly && (
                        <td className="py-3 pr-4">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setPriority(l)}
                              disabled={busy}
                              className="rounded-lg border border-gray-700 px-3 py-1 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-60"
                            >
                              {busy ? "…" : "Priority"}
                            </button>
                            <button
                              onClick={() => removeFromQueue(l)}
                              disabled={busy}
                              className="rounded-lg border border-red-900 px-3 py-1 text-xs font-semibold text-red-400 hover:bg-red-950 disabled:opacity-60"
                            >
                              {busy ? "…" : "Remove"}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
