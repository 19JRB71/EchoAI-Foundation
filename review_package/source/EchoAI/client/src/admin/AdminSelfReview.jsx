import { useEffect, useState } from "react";
import { api } from "../api.js";
import ErrorBanner from "../components/ErrorBanner.jsx";

const IMPACT_BADGE = {
  high: "bg-red-500/10 text-red-300 border border-red-500/30",
  medium: "bg-amber-500/10 text-amber-300 border border-amber-500/30",
  low: "bg-gray-800 text-gray-300 border border-gray-700",
};

const ITEM_STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "planned", label: "Planned" },
  { value: "dismissed", label: "Dismissed" },
  { value: "done", label: "Done" },
];

const ITEM_STATUS_BADGE = {
  new: "bg-sky-500/10 text-sky-300 border border-sky-500/30",
  planned: "bg-amber-500/10 text-amber-300 border border-amber-500/30",
  dismissed: "bg-gray-800 text-gray-400 border border-gray-700",
  done: "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30",
};

function formatWeek(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AdminSelfReview() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState("");
  const [busyItemId, setBusyItemId] = useState(null);

  async function load({ initial = false } = {}) {
    if (initial) setLoading(true);
    try {
      const result = await api.adminGetSelfReviewReports();
      const list = result.reports || [];
      setReports(list);
      setError("");
      return list;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      if (initial) setLoading(false);
    }
  }

  async function openReport(reportId) {
    setSelectedId(reportId);
    setDetail(null);
    setDetailError("");
    try {
      const result = await api.adminGetSelfReviewReport(reportId);
      setDetail(result);
    } catch (err) {
      setDetailError(err.message);
    }
  }

  useEffect(() => {
    (async () => {
      const list = await load({ initial: true });
      const first = list.find((r) => r.status === "completed") || list[0];
      if (first) openReport(first.report_id);
    })();
  }, []);

  async function runNow() {
    setRunning(true);
    setRunMessage("Sage is studying the past week — this can take a minute…");
    try {
      const result = await api.adminRunSelfReview();
      setRunMessage("");
      const list = await load();
      const target = result.reportId || (list[0] && list[0].report_id);
      if (target) openReport(target);
    } catch (err) {
      setRunMessage("");
      setError(err.message);
      // The failed report (with its gathered evidence) is still listed.
      await load();
    } finally {
      setRunning(false);
    }
  }

  async function changeItemStatus(itemId, status) {
    setBusyItemId(itemId);
    try {
      await api.adminUpdateSelfReviewItemStatus(itemId, status);
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((i) =>
                i.item_id === itemId ? { ...i, status } : i,
              ),
            }
          : prev,
      );
    } catch (err) {
      setDetailError(err.message);
    } finally {
      setBusyItemId(null);
    }
  }

  if (loading) {
    return <p className="py-8 text-center text-sm text-gray-500">Loading self-reviews…</p>;
  }

  const report = detail && detail.report;
  const readErrors =
    (report && report.evidence && report.evidence.readErrors) || [];

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} onDismiss={() => setError("")} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-100">Echo Self-Review</h3>
          <p className="text-sm text-gray-400">
            Every Monday, Sage studies the past week&apos;s real platform data and
            recommends improvements. Recommendations only — nothing changes without you.
          </p>
        </div>
        <button
          onClick={runNow}
          disabled={running}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-950 transition hover:bg-amber-400 disabled:opacity-50"
        >
          {running ? "Studying…" : "Run this week's review"}
        </button>
      </div>
      {runMessage && <p className="text-sm text-amber-300">{runMessage}</p>}

      {reports.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">
          No self-reviews yet. The first one runs automatically Monday morning, or run
          one now.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {reports.map((r) => (
            <button
              key={r.report_id}
              onClick={() => openReport(r.report_id)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                selectedId === r.report_id
                  ? "border-amber-500 bg-amber-500/10 text-amber-300"
                  : "border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-500"
              }`}
            >
              Week of {formatWeek(r.week_start)}
              {r.status === "failed" && <span className="ml-1 text-red-400">• failed</span>}
              {r.status === "running" && <span className="ml-1 text-amber-400">• running</span>}
              {r.status === "completed" && r.new_count > 0 && (
                <span className="ml-1 text-sky-300">• {r.new_count} new</span>
              )}
            </button>
          ))}
        </div>
      )}

      <ErrorBanner message={detailError} onDismiss={() => setDetailError("")} />

      {selectedId && !detail && !detailError && (
        <p className="py-4 text-center text-sm text-gray-500">Loading report…</p>
      )}

      {report && (
        <div className="space-y-4">
          {report.status === "failed" && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
              This review failed: {report.error || "unknown error"}. The gathered data
              was kept — use &quot;Run this week&apos;s review&quot; to try again.
            </div>
          )}

          {report.summary && (
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <h4 className="mb-1 text-sm font-semibold text-gray-200">
                Week of {formatWeek(report.week_start)} — summary
              </h4>
              <p className="text-sm leading-relaxed text-gray-300">{report.summary}</p>
            </div>
          )}

          {readErrors.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
              Some data could not be read this week (recommendations exclude it):{" "}
              {readErrors.join("; ")}
            </div>
          )}

          {detail.items && detail.items.length > 0 && (
            <div className="space-y-3">
              {detail.items.map((item) => (
                <div
                  key={item.item_id}
                  className="rounded-lg border border-gray-800 bg-gray-900 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-gray-500">#{item.rank}</span>
                      <h5 className="text-sm font-semibold text-gray-100">{item.title}</h5>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          IMPACT_BADGE[item.impact] || IMPACT_BADGE.medium
                        }`}
                      >
                        {item.impact} impact
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          ITEM_STATUS_BADGE[item.status] || ITEM_STATUS_BADGE.new
                        }`}
                      >
                        {item.status}
                      </span>
                      <select
                        value={item.status}
                        disabled={busyItemId === item.item_id}
                        onChange={(e) => changeItemStatus(item.item_id, e.target.value)}
                        className="rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-300"
                      >
                        {ITEM_STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-gray-300">
                    {item.recommendation}
                  </p>
                  {item.evidence && (
                    <p className="mt-2 rounded bg-gray-950 p-2 text-xs text-gray-400">
                      Evidence: {item.evidence}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
