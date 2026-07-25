import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

const SUB_TABS = [
  { key: "live", label: "Live Calls" },
  { key: "history", label: "Call History" },
  { key: "config", label: "Configuration" },
  { key: "performance", label: "Performance" },
];

function scoreColor(score) {
  if (score >= 7) return "bg-green-500";
  if (score >= 4) return "bg-amber-500";
  return "bg-red-500";
}

function scoreTextColor(score) {
  if (score >= 7) return "text-green-300";
  if (score >= 4) return "text-amber-300";
  return "text-red-300";
}

function InterestMeter({ score }) {
  const pct = Math.max(0, Math.min(10, score || 0)) * 10;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-800">
        <div
          className={`h-full ${scoreColor(score)} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-semibold ${scoreTextColor(score)}`}>
        {score || 0}/10
      </span>
    </div>
  );
}

function formatDuration(seconds) {
  const s = Number(seconds) || 0;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function outcomeLabel(outcome) {
  const map = {
    booked_demo: "Booked demo",
    follow_up_scheduled: "Follow-up scheduled",
    not_interested: "Not interested",
    interested: "Interested",
  };
  return map[outcome] || outcome || "—";
}

// ---------------------------------------------------------------------------
// Live Calls
// ---------------------------------------------------------------------------

function LiveCalls() {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api.salesGetLiveCalls();
      setCalls(data.calls || []);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 8000); // poll live calls
    return () => clearInterval(id);
  }, [load]);

  async function join(callId) {
    setBusyId(callId);
    setError("");
    try {
      await api.salesInvite(callId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  }

  if (loading) return <Spinner label="Loading live calls…" />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      {calls.length === 0 ? (
        <div className="rounded-xl border border-gray-800 bg-gray-950 px-4 py-8 text-center text-gray-500">
          No active sales calls right now.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {calls.map((c) => (
            <div
              key={c.callId}
              className="rounded-xl border border-gray-800 bg-gray-950 p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-gray-100">
                    {c.prospectName || c.prospectPhone || "Unknown prospect"}
                  </div>
                  <div className="text-xs text-gray-500">
                    {c.businessType || "Business type pending"} · {c.turns} turns
                  </div>
                </div>
                <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-300">
                  Live
                </span>
              </div>
              <div className="mt-3">
                <InterestMeter score={c.interestScore} />
              </div>
              <button
                disabled={busyId === c.callId}
                onClick={() => join(c.callId)}
                className="mt-4 w-full rounded-lg bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-40"
              >
                {busyId === c.callId ? "Sending invite…" : "Join Call"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Call History
// ---------------------------------------------------------------------------

function CallHistory() {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.salesGetCalls();
      setCalls(data.calls || []);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function view(callId) {
    setError("");
    try {
      const data = await api.salesGetCall(callId);
      setDetail(data.call);
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <Spinner label="Loading call history…" />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-900 text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">Prospect</th>
              <th className="px-4 py-3 font-medium">Business</th>
              <th className="px-4 py-3 font-medium">Interest</th>
              <th className="px-4 py-3 font-medium">Outcome</th>
              <th className="px-4 py-3 font-medium">Duration</th>
              <th className="px-4 py-3 font-medium">Summary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800 bg-gray-950 text-gray-200">
            {calls.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  No sales calls yet.
                </td>
              </tr>
            ) : (
              calls.map((c) => (
                <tr key={c.callId}>
                  <td className="px-4 py-3">
                    <div>{c.prospectName || "Unknown"}</div>
                    <div className="text-xs text-gray-500">{c.prospectPhone}</div>
                  </td>
                  <td className="px-4 py-3">{c.businessType || "—"}</td>
                  <td className="px-4 py-3">
                    <InterestMeter score={c.interestScore} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1">
                      {c.bookedDemo && <span title="Booked demo">✅</span>}
                      {outcomeLabel(c.outcome)}
                    </span>
                  </td>
                  <td className="px-4 py-3">{formatDuration(c.callDuration)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => view(c.callId)}
                      className="rounded-lg bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-300 transition hover:bg-blue-500/20"
                    >
                      View Summary
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setDetail(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-800 bg-gray-950 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-100">
                  {detail.prospectName || detail.prospectPhone || "Call summary"}
                </h3>
                <p className="text-xs text-gray-500">
                  {outcomeLabel(detail.outcome)} · Interest{" "}
                  {detail.interestScore}/10 ·{" "}
                  {formatDuration(detail.callDuration)}
                </p>
              </div>
              <button
                onClick={() => setDetail(null)}
                className="rounded-lg px-2 py-1 text-gray-400 hover:text-gray-200"
              >
                ✕
              </button>
            </div>

            <div className="mt-4">
              <h4 className="text-sm font-medium text-gray-300">AI Summary</h4>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-400">
                {detail.summary || "No summary was generated for this call."}
              </p>
            </div>

            {Array.isArray(detail.conversationHistory) &&
              detail.conversationHistory.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-300">
                    Transcript
                  </h4>
                  <div className="mt-2 space-y-2">
                    {detail.conversationHistory.map((m, i) => (
                      <div
                        key={i}
                        className={`rounded-lg px-3 py-2 text-sm ${
                          m.role === "assistant"
                            ? "bg-amber-500/5 text-amber-100"
                            : "bg-gray-800/50 text-gray-200"
                        }`}
                      >
                        <span className="mr-2 text-xs uppercase text-gray-500">
                          {m.coPilot
                            ? "Echo (co-pilot)"
                            : m.role === "assistant"
                              ? "Echo"
                              : "Prospect"}
                        </span>
                        {m.content}
                      </div>
                    ))}
                  </div>
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function emptyObjection() {
  return { objection: "", response: "" };
}

function Configuration() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.salesGetConfig();
      const c = data.config;
      setConfig({
        ...c,
        objections:
          c.objections && c.objections.length
            ? c.objections
            : [emptyObjection()],
      });
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function update(patch) {
    setConfig((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }

  function updateObjection(i, field, value) {
    setConfig((prev) => {
      const objections = [...prev.objections];
      objections[i] = { ...objections[i], [field]: value };
      return { ...prev, objections };
    });
    setSaved(false);
  }

  function addObjection() {
    setConfig((prev) => ({
      ...prev,
      objections: [...prev.objections, emptyObjection()].slice(0, 5),
    }));
  }

  function removeObjection(i) {
    setConfig((prev) => ({
      ...prev,
      objections: prev.objections.filter((_, idx) => idx !== i),
    }));
  }

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const payload = {
        ownerPhone: config.ownerPhone,
        heyEchoMode: config.heyEchoMode,
        bookingLink: config.bookingLink,
        enabled: config.enabled,
        objections: config.objections.filter(
          (o) => o.objection.trim() && o.response.trim(),
        ),
      };
      const data = await api.salesSaveConfig(payload);
      const c = data.config;
      setConfig({
        ...c,
        objections:
          c.objections && c.objections.length
            ? c.objections
            : [emptyObjection()],
      });
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner label="Loading configuration…" />;
  if (!config) return <ErrorBanner message={error || "Could not load config."} />;

  return (
    <div className="max-w-2xl space-y-6">
      <ErrorBanner message={error} />

      {!config.twilioConfigured && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
          The dedicated sales phone line is not configured yet. Set the
          SALES_TWILIO_ACCOUNT_SID, SALES_TWILIO_AUTH_TOKEN, and
          SALES_TWILIO_NUMBER environment variables to enable inbound sales
          calls and SMS invites.
        </div>
      )}
      {config.twilioConfigured && config.salesNumber && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-green-200">
          Sales line active on {config.salesNumber}.
        </div>
      )}

      <label className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-950 px-4 py-3">
        <div>
          <div className="font-medium text-gray-100">Enable AI Sales Agent</div>
          <div className="text-xs text-gray-500">
            When off, inbound callers hear an "offline" message.
          </div>
        </div>
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          className="h-5 w-5 accent-amber-500"
        />
      </label>

      <div>
        <label className="block text-sm font-medium text-gray-300">
          Owner phone (for three-way call invites)
        </label>
        <input
          type="tel"
          value={config.ownerPhone}
          onChange={(e) => update({ ownerPhone: e.target.value })}
          placeholder="+15551234567"
          className="mt-1 w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300">
          "Hey Echo" response mode
        </label>
        <div className="mt-2 flex gap-2">
          {["sms", "voice"].map((mode) => (
            <button
              key={mode}
              onClick={() => update({ heyEchoMode: mode })}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                config.heyEchoMode === mode
                  ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40"
                  : "bg-gray-900 text-gray-400 hover:text-gray-200"
              }`}
            >
              {mode === "sms" ? "Text the owner" : "Read aloud on call"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300">
          Demo booking link
        </label>
        <input
          type="url"
          value={config.bookingLink}
          onChange={(e) => update({ bookingLink: e.target.value })}
          placeholder="https://calendly.com/echoai/demo"
          className="mt-1 w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-300">
            Top objections & preferred responses (up to 5)
          </label>
          {config.objections.length < 5 && (
            <button
              onClick={addObjection}
              className="text-xs font-medium text-amber-300 hover:text-amber-200"
            >
              + Add
            </button>
          )}
        </div>
        <div className="mt-2 space-y-3">
          {config.objections.map((o, i) => (
            <div
              key={i}
              className="rounded-xl border border-gray-800 bg-gray-950 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase text-gray-500">
                  Objection {i + 1}
                </span>
                {config.objections.length > 1 && (
                  <button
                    onClick={() => removeObjection(i)}
                    className="text-xs text-gray-500 hover:text-red-300"
                  >
                    Remove
                  </button>
                )}
              </div>
              <input
                value={o.objection}
                onChange={(e) => updateObjection(i, "objection", e.target.value)}
                placeholder="e.g. It's too expensive"
                className="mt-2 w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
              />
              <textarea
                value={o.response}
                onChange={(e) => updateObjection(i, "response", e.target.value)}
                placeholder="Preferred response Echo should use…"
                rows={2}
                className="mt-2 w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-amber-500 px-5 py-2 text-sm font-semibold text-gray-950 transition hover:bg-amber-400 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save configuration"}
        </button>
        {saved && <span className="text-sm text-green-300">Saved.</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-gray-100">{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

function Performance() {
  const [perf, setPerf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const data = await api.salesGetPerformance();
        setPerf(data.performance);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <Spinner label="Loading performance…" />;
  if (!perf) return <ErrorBanner message={error || "No performance data."} />;

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Calls this month" value={perf.totalCalls} />
        <StatCard
          label="Avg interest score"
          value={`${perf.avgInterestScore}/10`}
        />
        <StatCard
          label="Booked demos"
          value={perf.bookedDemos}
          sub={`${perf.conversionRate}% conversion`}
        />
        <StatCard label="Conversion rate" value={`${perf.conversionRate}%`} />
      </div>

      <div>
        <h4 className="text-sm font-medium text-gray-300">
          Common objections raised
        </h4>
        {perf.commonObjections.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            No objections captured yet this month.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {perf.commonObjections.map((o, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm"
              >
                <span className="text-gray-200">{o.objection}</span>
                <span className="text-gray-500">{o.count}×</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

export default function AdminSalesAgent() {
  const [tab, setTab] = useState("live");

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-gray-100">AI Sales Agent</h3>
        <p className="text-sm text-gray-400">
          Echo answers inbound demo calls, qualifies prospects, and closes — with
          three-way co-pilot support so you can jump in when it matters.
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-800">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "border-amber-500 text-amber-300"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "live" && <LiveCalls />}
      {tab === "history" && <CallHistory />}
      {tab === "config" && <Configuration />}
      {tab === "performance" && <Performance />}
    </div>
  );
}
