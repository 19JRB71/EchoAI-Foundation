import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import Spinner from "../../components/Spinner.jsx";
import ErrorBanner from "../../components/ErrorBanner.jsx";

// Sentinel department — call monitoring. Owners/admins review every call placed
// across the workspace today (who made it, outcome, duration) and play back
// recordings. Drilling into a lead opens its full accountability log.

function fmtDuration(s) {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function fmtTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

const statusColors = {
  completed: "bg-green-500/15 text-green-400",
  in_progress: "bg-sky-500/15 text-sky-300",
  failed: "bg-red-500/15 text-red-400",
};

export default function CallMonitoring() {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playingId, setPlayingId] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [loadingAudio, setLoadingAudio] = useState("");
  const [logLeadId, setLogLeadId] = useState(null);
  const audioUrlRef = useRef("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.crmCallsToday();
      setCalls(data.calls || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Revoke any outstanding object URL when it changes or on unmount.
  useEffect(() => {
    return () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  async function playRecording(call) {
    setError("");
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }
    setAudioUrl("");
    setLoadingAudio(call.callId);
    try {
      const url = await api.crmRecordingBlobUrl(call.callId);
      audioUrlRef.current = url;
      setAudioUrl(url);
      setPlayingId(call.callId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingAudio("");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300">
          Today's calls
        </h3>
        <button
          onClick={load}
          className="rounded-lg border border-gray-700 px-3 py-1 text-xs font-semibold text-gray-300 hover:bg-gray-800"
        >
          Refresh
        </button>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="Loading calls…" />
      ) : calls.length === 0 ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-8 text-center text-sm text-gray-400">
          No calls placed yet today.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Lead</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Duration</th>
                <th className="px-4 py-3 font-medium text-right">Recording</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.callId} className="border-b border-gray-800/60">
                  <td className="px-4 py-3 text-gray-400">
                    {fmtTime(c.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-gray-200">
                    {c.agentName || "AI agent"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setLogLeadId(c.leadId)}
                      disabled={!c.leadId}
                      className="text-teal-400 hover:underline disabled:text-gray-500 disabled:no-underline"
                    >
                      {c.leadName || "—"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                        statusColors[c.status] || "bg-gray-500/15 text-gray-400"
                      }`}
                    >
                      {String(c.status || "").replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {fmtDuration(c.durationSeconds)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {c.hasRecording ? (
                      <button
                        onClick={() => playRecording(c)}
                        disabled={loadingAudio === c.callId}
                        className="rounded-lg border border-gray-700 px-3 py-1 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-60"
                      >
                        {loadingAudio === c.callId ? "Loading…" : "▶ Play"}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {playingId && audioUrl && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-300">
              Now playing recording
            </span>
            <button
              onClick={() => {
                if (audioUrlRef.current) {
                  URL.revokeObjectURL(audioUrlRef.current);
                  audioUrlRef.current = "";
                }
                setAudioUrl("");
                setPlayingId("");
              }}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Close
            </button>
          </div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls autoPlay src={audioUrl} className="w-full" />
        </div>
      )}

      {logLeadId && (
        <LeadLogModal leadId={logLeadId} onClose={() => setLogLeadId(null)} />
      )}
    </div>
  );
}

// Full accountability timeline for one lead — every logged interaction plus
// every call, in order. Read-only.
function LeadLogModal({ leadId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.crmLeadLog(leadId);
        if (active) setData(res);
      } catch (err) {
        if (active) setError(err.message);
      }
    })();
    return () => {
      active = false;
    };
  }, [leadId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-800 bg-gray-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">
            Accountability log
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <ErrorBanner message={error} />
        {!data && !error ? (
          <Spinner label="Loading log…" />
        ) : data ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-gray-950 p-3 text-sm">
              <div className="font-semibold text-gray-100">
                {data.lead.name || "Unnamed lead"}
              </div>
              <div className="text-xs text-gray-500">
                {data.lead.email || ""} {data.lead.phone ? `· ${data.lead.phone}` : ""}
              </div>
            </div>
            <TimelineList data={data} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TimelineList({ data }) {
  const items = [];
  (data.interactions || []).forEach((it) => {
    const d = it.interaction_details || {};
    items.push({
      at: it.occurred_at,
      label: (d.action || it.interaction_type || "activity").replace(/_/g, " "),
      detail:
        [d.byEmail, d.outcome, d.notes].filter(Boolean).join(" · ") || "",
    });
  });
  (data.calls || []).forEach((c) => {
    items.push({
      at: c.createdAt,
      label: `call (${c.status})`,
      detail:
        [c.agentName, c.outcome, c.hasRecording ? "recorded" : null]
          .filter(Boolean)
          .join(" · ") || "",
    });
  });
  items.sort((a, b) => new Date(a.at) - new Date(b.at));

  if (items.length === 0) {
    return <p className="text-sm text-gray-400">No activity logged yet.</p>;
  }
  return (
    <ol className="space-y-2">
      {items.map((it, i) => (
        <li
          key={i}
          className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm"
        >
          <div className="flex items-center justify-between">
            <span className="font-medium capitalize text-gray-200">
              {it.label}
            </span>
            <span className="text-xs text-gray-500">
              {it.at ? new Date(it.at).toLocaleString() : ""}
            </span>
          </div>
          {it.detail && (
            <div className="mt-0.5 text-xs text-gray-400">{it.detail}</div>
          )}
        </li>
      ))}
    </ol>
  );
}
