import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

const TABS = [
  { key: "history", label: "Call History" },
  { key: "outbound", label: "Make a Call" },
];

const OUTCOME_LABELS = {
  appointment_booked: { label: "Appointment booked", cls: "bg-emerald-500/15 text-emerald-300" },
  sale_closed: { label: "Sale closed", cls: "bg-emerald-500/15 text-emerald-300" },
  interested: { label: "Interested", cls: "bg-sky-500/15 text-sky-300" },
  callback_requested: { label: "Callback requested", cls: "bg-amber-500/15 text-amber-300" },
  not_interested: { label: "Not interested", cls: "bg-gray-600/30 text-gray-300" },
  no_answer: { label: "No answer", cls: "bg-gray-600/30 text-gray-400" },
};

const TEMP_LABELS = {
  hot: { label: "🔥 Hot", cls: "bg-red-500/15 text-red-300" },
  warm: { label: "Warm", cls: "bg-amber-500/15 text-amber-300" },
  tire_kicker: { label: "Tire-kicker", cls: "bg-gray-600/30 text-gray-300" },
};

function Badge({ map, value }) {
  const meta = map[value];
  if (!meta) return <span className="text-gray-500">—</span>;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function formatDuration(seconds) {
  const s = Number(seconds) || 0;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

export default function PhoneAgent({ brandId }) {
  const [tab, setTab] = useState("history");
  const [config, setConfig] = useState(null);
  const [calls, setCalls] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const [cfg, history] = await Promise.all([
        api.getTwilioConfig(brandId),
        api.getCallHistory(brandId),
      ]);
      setConfig(cfg);
      setCalls(history.calls || []);
      setStats(history.stats || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setConfig(null);
    setCalls([]);
    setStats(null);
    load();
  }, [load]);

  if (!brandId) {
    return (
      <p className="text-sm text-gray-400">
        Select or create a brand to use the AI Phone Agent.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-100">AI Phone Agent</h2>
        <p className="mt-1 text-sm text-gray-400">
          Place AI-powered outbound calls to hot leads and let the agent answer
          inbound calls — qualifying every caller automatically.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}

      {config && !config.configured && (
        <div className="rounded-xl border border-amber-700/50 bg-amber-500/10 p-4 text-sm text-amber-200">
          Connect a Twilio phone number in{" "}
          <span className="font-semibold">Settings → Account → Twilio</span> to
          start making and receiving calls.
        </div>
      )}

      {config && config.configured && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-sm">
          <span className="text-gray-400">Connected number: </span>
          <span className="font-semibold text-gray-100">{config.phoneNumber}</span>
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Total calls" value={stats.total} />
          <StatCard label="Inbound" value={stats.inbound} />
          <StatCard label="Outbound" value={stats.outbound} />
          <StatCard label="Hot leads" value={stats.hot} />
        </div>
      )}

      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={[
              "rounded-lg px-4 py-2 text-sm font-semibold transition",
              tab === t.key
                ? "bg-amber-500 text-gray-900"
                : "border border-gray-700 text-gray-300 hover:bg-gray-800",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : tab === "history" ? (
        <CallHistory calls={calls} />
      ) : (
        <OutboundPanel
          brandId={brandId}
          configured={!!(config && config.configured)}
          onCallPlaced={load}
        />
      )}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="text-2xl font-bold text-gray-100">{value ?? 0}</div>
      <div className="text-xs text-gray-400">{label}</div>
    </div>
  );
}

function CallHistory({ calls }) {
  const [expanded, setExpanded] = useState(null);
  if (calls.length === 0) {
    return (
      <p className="rounded-xl border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">
        No calls yet. Place an outbound call or wait for an inbound call to your
        connected number.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {calls.map((c) => {
        const transcript = Array.isArray(c.transcript) ? c.transcript : [];
        const isOpen = expanded === c.call_id;
        return (
          <div
            key={c.call_id}
            className="rounded-xl border border-gray-800 bg-gray-900 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    c.direction === "outbound"
                      ? "bg-indigo-500/15 text-indigo-300"
                      : "bg-teal-500/15 text-teal-300"
                  }`}
                >
                  {c.direction === "outbound" ? "Outbound" : "Inbound"}
                </span>
                <span className="text-sm font-semibold text-gray-100">
                  {c.lead_name || c.caller_phone || "Unknown caller"}
                </span>
                {c.caller_phone && c.lead_name && (
                  <span className="text-xs text-gray-500">{c.caller_phone}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge map={TEMP_LABELS} value={c.lead_temperature} />
                <Badge map={OUTCOME_LABELS} value={c.outcome} />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-400">
              <span>{new Date(c.created_at).toLocaleString()}</span>
              <span>Duration: {formatDuration(c.duration_seconds)}</span>
              {transcript.length > 0 && (
                <button
                  onClick={() => setExpanded(isOpen ? null : c.call_id)}
                  className="font-semibold text-amber-400 hover:underline"
                >
                  {isOpen ? "Hide transcript" : "View transcript"}
                </button>
              )}
            </div>
            {isOpen && transcript.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-gray-800 pt-3">
                {transcript.map((m, i) => (
                  <div key={i} className="text-sm">
                    <span
                      className={`font-semibold ${
                        m.role === "assistant" ? "text-amber-400" : "text-gray-300"
                      }`}
                    >
                      {m.role === "assistant" ? "Agent" : "Caller"}:{" "}
                    </span>
                    <span className="text-gray-300">{m.content}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function OutboundPanel({ brandId, configured, onCallPlaced }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [calling, setCalling] = useState(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await api.getLeads(brandId);
        if (active)
          setLeads(
            (data.leads || data || []).filter(
              (l) => l.phone && l.temperature === "hot",
            ),
          );
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [brandId]);

  async function call(leadId) {
    setCalling(leadId);
    setError("");
    setNotice("");
    try {
      await api.initiateOutboundCall(leadId);
      setNotice("Call placed — the AI agent is dialing now.");
      if (onCallPlaced) onCallPlaced();
    } catch (err) {
      setError(err.message);
    } finally {
      setCalling(null);
    }
  }

  if (!configured) {
    return (
      <p className="rounded-xl border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">
        Connect Twilio in Settings before placing calls.
      </p>
    );
  }
  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}
      {notice && (
        <div className="rounded-lg border border-emerald-700/50 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {notice}
        </div>
      )}
      {leads.length === 0 ? (
        <p className="rounded-xl border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">
          No hot leads with a phone number yet. The AI agent places outbound
          calls to hot leads who shared a phone number.
        </p>
      ) : (
        <div className="space-y-2">
          {leads.map((l) => (
            <div
              key={l.lead_id}
              className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 p-4"
            >
              <div>
                <div className="text-sm font-semibold text-gray-100">
                  {l.lead_name || "Unnamed lead"}
                </div>
                <div className="text-xs text-gray-400">{l.phone}</div>
              </div>
              <div className="flex items-center gap-3">
                <Badge map={TEMP_LABELS} value={l.temperature} />
                <button
                  onClick={() => call(l.lead_id)}
                  disabled={calling === l.lead_id}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-amber-400 disabled:opacity-50"
                >
                  {calling === l.lead_id ? "Calling…" : "Call with AI"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
