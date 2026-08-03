import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

/**
 * Unified Approvals Inbox (Prompt 019) — the ONE place the owner discovers
 * everything waiting on their decision. A live projection only: every item is
 * read from its feature's own table on each load; nothing is cached or stored
 * here.
 *
 * Item classes are visibly badged (owner ruling D-29):
 *  - "Spine" — task-spine MANUAL_REVIEW items; resolving one is a recorded
 *    audit-trail transition (never a bare status edit).
 *  - "Adapter" — transitional projections over feature approval queues that
 *    have not adopted the Task Spine yet; the button jumps to the feature's
 *    own screen, where its existing approve/decline endpoints do the work.
 */

const KIND_LABELS = {
  manual_review: "Needs your review",
  autopilot_item: "Autopilot approval",
  growth_action: "Growth proposal",
  company_truth: "Company Truth approval",
  email_draft: "Email draft approval",
};

function SourceBadge({ source }) {
  const isSpine = source === "spine";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        isSpine ? "bg-teal-900/60 text-teal-300" : "bg-amber-900/60 text-amber-300"
      }`}
      title={
        isSpine
          ? "Tracked end-to-end on the task audit trail"
          : "Transitional adapter — this feature has not adopted the audit trail yet"
      }
    >
      {isSpine ? "Spine" : "Adapter"}
    </span>
  );
}

export default function ApprovalsInbox({ brandId, onSelectSection }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState("");
  const [showInventory, setShowInventory] = useState(false);

  const load = useCallback(async (isFirst = false) => {
    if (isFirst) setLoading(true);
    setError("");
    try {
      const res = await api.getApprovalsInbox(brandId);
      setData(res);
    } catch (err) {
      setError(err.message || "Failed to load the approvals inbox");
    } finally {
      if (isFirst) setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load(true);
  }, [load]);

  async function resolve(item, resolution) {
    setBusyId(item.id);
    setError("");
    setNotice("");
    try {
      await api.resolveApprovalTask(item.taskId, resolution);
      setNotice(
        resolution === "confirm_handled"
          ? "Marked as handled — recorded on the audit trail."
          : "Dismissed — recorded on the audit trail."
      );
      await load(false);
    } catch (err) {
      setError(err.message || "Failed to resolve this item");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Spinner label="Loading approvals…" />;

  const items = (data && data.items) || [];
  const counts = (data && data.counts) || { total: 0, spine: 0, adapter: 0 };
  const inventory = (data && data.adapterInventory) || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-white">Approvals Inbox</h2>
          <p className="text-sm text-gray-400">
            Everything waiting on your decision, in one place.
          </p>
        </div>
        <div className="text-sm text-gray-400">
          {counts.total} waiting · {counts.spine} tracked · {counts.adapter} adapter-backed
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {notice && (
        <div className="rounded-lg border border-emerald-800 bg-emerald-900/40 px-3 py-2 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-8 text-center text-gray-400">
          Nothing is waiting for your approval right now.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-xl border border-gray-800 bg-gray-900 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <SourceBadge source={item.source} />
                    <span className="text-xs font-semibold text-gray-400">
                      {item.feature} · {KIND_LABELS[item.kind] || item.kind}
                    </span>
                    {item.brandName && (
                      <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300">
                        {item.brandName}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 break-words text-sm font-medium text-gray-100">
                    {item.title}
                  </div>
                  {item.detail && (
                    <div className="mt-1 break-words text-xs text-amber-300/90">{item.detail}</div>
                  )}
                  <div className="mt-1 text-xs text-gray-500">
                    {item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.source === "spine" ? (
                    <>
                      <button
                        disabled={busyId === item.id}
                        onClick={() => resolve(item, "confirm_handled")}
                        className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                      >
                        Mark handled
                      </button>
                      <button
                        disabled={busyId === item.id}
                        onClick={() => resolve(item, "dismiss")}
                        className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-gray-600 disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => onSelectSection && onSelectSection(item.goToSection)}
                      className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-600"
                    >
                      Review in {item.feature}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
        <button
          onClick={() => setShowInventory((v) => !v)}
          className="text-xs font-semibold text-gray-400 hover:text-gray-200"
        >
          {showInventory ? "Hide" : "Show"} adapter inventory ({inventory.length})
        </button>
        {showInventory && (
          <ul className="mt-2 space-y-1 text-xs text-gray-400">
            {inventory.map((a) => (
              <li key={a.key}>
                <span className="font-semibold text-gray-300">{a.feature}</span> — {a.retirement}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
