import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import {
  PRIORITY_META,
  PRIORITY_ORDER,
  sortByPriority,
} from "../lib/notificationPriority";

// One-line relative timestamp ("2m ago", "3h ago", "Jul 4"). Falls back to the
// raw string if it can't be parsed.
function relTime(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Slide-over panel listing a brand's pending notifications grouped by color
 * priority (red → yellow → green). Each row shows a one-line description + a
 * relative timestamp; the owner can dismiss one or clear all. `brandId` is the
 * originating brand id, or the string "general" for non-brand notifications.
 * On any change it dispatches `echoai:notifications-changed` so the tab badges
 * (driven by VoiceContext's summary poll) refresh immediately.
 */
export default function NotificationPanel({
  brandId,
  brandName,
  includeGeneral = false,
  onClose,
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      // The active brand's panel also folds in the general (non-brand) bucket,
      // so nothing is hidden. Fetch both, concat, then re-sort red-first.
      const calls = [api.echoVoiceListNotifications(brandId)];
      if (includeGeneral && brandId !== "general") {
        calls.push(api.echoVoiceListNotifications("general"));
      }
      const results = await Promise.all(calls);
      let all = [];
      for (const r of results) all = all.concat((r && r.notifications) || []);
      setItems(sortByPriority(all));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [brandId, includeGeneral]);

  useEffect(() => {
    load();
  }, [load]);

  const notifyChanged = () => {
    try {
      window.dispatchEvent(new CustomEvent("echoai:notifications-changed"));
    } catch {
      /* noop */
    }
  };

  const dismissOne = async (id) => {
    setBusy(true);
    try {
      await api.echoVoiceMarkNotification(id, "dismissed");
      setItems((prev) => prev.filter((n) => n.id !== id));
      notifyChanged();
    } catch {
      /* leave it; a later load will reconcile */
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    setBusy(true);
    try {
      const calls = [api.echoVoiceClearNotifications(brandId)];
      if (includeGeneral && brandId !== "general") {
        calls.push(api.echoVoiceClearNotifications("general"));
      }
      await Promise.all(calls);
      setItems([]);
      notifyChanged();
    } catch {
      /* noop */
    } finally {
      setBusy(false);
    }
  };

  const groups = PRIORITY_ORDER.map((p) => ({
    priority: p,
    meta: PRIORITY_META[p],
    rows: items.filter((n) => n.priority === p),
  })).filter((g) => g.rows.length > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label="Notifications"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-gray-700 bg-gray-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-700 p-4">
          <div>
            <div className="text-sm font-semibold text-white">Notifications</div>
            {brandName ? (
              <div className="text-xs text-gray-400">{brandName}</div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {items.length > 0 ? (
              <button
                type="button"
                onClick={clearAll}
                disabled={busy}
                className="rounded-md border border-gray-600 px-2.5 py-1 text-xs text-gray-300 hover:border-indigo-500 hover:text-white disabled:opacity-50"
              >
                Clear all
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md px-2 py-1 text-gray-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-sm text-gray-400">Loading…</div>
          ) : items.length === 0 ? (
            <div className="mt-8 text-center text-sm text-gray-500">
              You're all caught up. No pending notifications.
            </div>
          ) : (
            <div className="space-y-5">
              {groups.map((g) => (
                <div key={g.priority}>
                  <div
                    className={`mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${g.meta.header}`}
                  >
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${g.meta.dot}`} />
                    {g.meta.label}
                    <span className="text-gray-500">({g.rows.length})</span>
                  </div>
                  <ul className="space-y-2">
                    {g.rows.map((n) => (
                      <li
                        key={n.id}
                        className={`flex items-start justify-between gap-3 rounded-lg p-3 ${g.meta.chip}`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm text-white">
                            {n.title || n.text || "Notification"}
                          </div>
                          <div className="mt-0.5 text-[0.7rem] text-gray-400">
                            {relTime(n.createdAt)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => dismissOne(n.id)}
                          disabled={busy}
                          aria-label="Dismiss notification"
                          className="shrink-0 rounded-md px-2 py-0.5 text-xs text-gray-300 hover:text-white disabled:opacity-50"
                        >
                          Dismiss
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
