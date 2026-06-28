import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

const TABS = [
  { key: "active", label: "Active" },
  { key: "builder", label: "New Sequence" },
  { key: "history", label: "History" },
];

const STATUS_LABELS = {
  active: { label: "Active", cls: "bg-emerald-500/15 text-emerald-300" },
  paused: { label: "Paused", cls: "bg-amber-500/15 text-amber-300" },
  completed: { label: "Completed", cls: "bg-sky-500/15 text-sky-300" },
  stopped: { label: "Stopped", cls: "bg-gray-600/30 text-gray-300" },
  cancelled: { label: "Cancelled", cls: "bg-red-500/15 text-red-300" },
};

const CHANNEL_LABELS = {
  email: { label: "Email", cls: "bg-indigo-500/15 text-indigo-300" },
  sms: { label: "SMS", cls: "bg-teal-500/15 text-teal-300" },
  phone: { label: "Phone", cls: "bg-purple-500/15 text-purple-300" },
};

const TP_STATUS_LABELS = {
  pending: { label: "Pending", cls: "text-gray-400" },
  sent: { label: "Sent", cls: "text-emerald-300" },
  skipped: { label: "Skipped", cls: "text-amber-300" },
  failed: { label: "Failed", cls: "text-red-300" },
};

const GOALS = [
  { value: "reengage", label: "Re-engage a quiet lead" },
  { value: "book_appointment", label: "Book an appointment" },
  { value: "close_sale", label: "Close the sale" },
];

const SOURCE_LABELS = { auto: "Auto-enrolled", manual: "Manual" };

function Badge({ map, value }) {
  const meta = map[value];
  if (!meta) return <span className="text-gray-500">{value || "—"}</span>;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function fmt(dt) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function FollowUps({ brandId }) {
  const [tab, setTab] = useState("active");

  if (!brandId) {
    return (
      <p className="text-sm text-gray-400">
        Select or create a brand to manage follow-up sequences.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-100">AI Follow-Ups</h2>
        <p className="mt-1 text-sm text-gray-400">
          Multi-step email, SMS, and phone sequences that keep working a lead
          until they reply, book, or convert. Leads are auto-enrolled the moment
          they warm up and auto-stopped the moment they respond.
        </p>
      </div>

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

      {tab === "active" ? (
        <SequenceList brandId={brandId} mode="active" />
      ) : tab === "builder" ? (
        <Builder brandId={brandId} onSaved={() => setTab("active")} />
      ) : (
        <SequenceList brandId={brandId} mode="history" />
      )}
    </div>
  );
}

function SequenceList({ brandId, mode }) {
  const [sequences, setSequences] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getFollowUps(brandId);
      setSequences(data.sequences || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setSequences([]);
    setExpanded(null);
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const running = (s) => s.status === "active" || s.status === "paused";
    return sequences.filter((s) => (mode === "active" ? running(s) : !running(s)));
  }, [sequences, mode]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}
      {filtered.length === 0 ? (
        <p className="rounded-xl border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">
          {mode === "active"
            ? "No running sequences. Start one from the New Sequence tab, or let a lead warm up to be auto-enrolled."
            : "No completed, stopped, or cancelled sequences yet."}
        </p>
      ) : (
        filtered.map((s) => (
          <SequenceCard
            key={s.sequence_id}
            seq={s}
            expanded={expanded === s.sequence_id}
            onToggle={() =>
              setExpanded(expanded === s.sequence_id ? null : s.sequence_id)
            }
            onChange={load}
          />
        ))
      )}
    </div>
  );
}

function SequenceCard({ seq, expanded, onToggle, onChange }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const running = seq.status === "active" || seq.status === "paused";

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setLoadingDetail(true);
    api
      .getFollowUp(seq.sequence_id)
      .then((data) => {
        if (!cancelled) setDetail(data.touchpoints || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, seq.sequence_id]);

  async function act(fn, label) {
    setBusy(label);
    setError("");
    try {
      await fn(seq.sequence_id);
      if (onChange) await onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  const sent = Number(seq.sent_count || 0);
  const total = Number(seq.total_steps || seq.touchpoint_count || 0);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-100">
              {seq.lead_name || "Lead"}
            </span>
            <Badge map={STATUS_LABELS} value={seq.status} />
            {seq.source && (
              <span className="text-xs text-gray-500">
                {SOURCE_LABELS[seq.source] || seq.source}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-gray-400">
            {seq.lead_email || "no email"}
            {seq.lead_phone ? ` · ${seq.lead_phone}` : ""}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            Goal: {seq.goal} · {sent}/{total} sent
            {running && seq.next_touchpoint_at
              ? ` · next ${fmt(seq.next_touchpoint_at)}`
              : ""}
            {seq.status === "stopped" && seq.stop_reason
              ? ` · stopped: ${seq.stop_reason}`
              : ""}
          </div>
        </div>
        <button
          onClick={onToggle}
          className="text-xs font-medium text-amber-400 hover:text-amber-300"
        >
          {expanded ? "Hide steps" : "View steps"}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {running && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-800 pt-3">
          {seq.status === "active" ? (
            <button
              onClick={() => act(api.pauseFollowUp, "pause")}
              disabled={!!busy}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 transition hover:bg-gray-800 disabled:opacity-50"
            >
              {busy === "pause" ? "…" : "Pause"}
            </button>
          ) : (
            <button
              onClick={() => act(api.resumeFollowUp, "resume")}
              disabled={!!busy}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy === "resume" ? "…" : "Resume"}
            </button>
          )}
          <button
            onClick={() => act(api.cancelFollowUp, "cancel")}
            disabled={!!busy}
            className="rounded-lg border border-red-700/60 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
          >
            {busy === "cancel" ? "…" : "Cancel"}
          </button>
        </div>
      )}

      {expanded && (
        <div className="mt-3 border-t border-gray-800 pt-3">
          {loadingDetail ? (
            <Spinner />
          ) : !detail || detail.length === 0 ? (
            <p className="text-xs text-gray-500">No touchpoints.</p>
          ) : (
            <ol className="space-y-3">
              {detail.map((tp) => (
                <li key={tp.touchpoint_id} className="rounded-lg bg-gray-950 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-300">
                        Step {tp.step_number}
                      </span>
                      <Badge map={CHANNEL_LABELS} value={tp.channel} />
                    </div>
                    <span
                      className={`text-xs ${
                        (TP_STATUS_LABELS[tp.status] || {}).cls || "text-gray-400"
                      }`}
                    >
                      {(TP_STATUS_LABELS[tp.status] || {}).label || tp.status}
                      {tp.status === "pending"
                        ? ` · ${fmt(tp.scheduled_at)}`
                        : tp.sent_at
                          ? ` · ${fmt(tp.sent_at)}`
                          : ""}
                    </span>
                  </div>
                  {tp.subject && (
                    <div className="mt-1 text-xs font-medium text-gray-300">
                      {tp.subject}
                    </div>
                  )}
                  <p className="mt-1 whitespace-pre-wrap text-xs text-gray-400">
                    {tp.body}
                  </p>
                  {tp.error && (
                    <p className="mt-1 text-xs text-red-400">{tp.error}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function Builder({ brandId, onSaved }) {
  const [leads, setLeads] = useState([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [leadId, setLeadId] = useState("");
  const [goal, setGoal] = useState("reengage");
  const [preview, setPreview] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadLeads = useCallback(async () => {
    setLoadingLeads(true);
    setError("");
    try {
      const data = await api.getLeads(brandId);
      setLeads(data.leads || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingLeads(false);
    }
  }, [brandId]);

  useEffect(() => {
    setLeadId("");
    setPreview(null);
    setNotice("");
    loadLeads();
  }, [loadLeads]);

  async function generate() {
    if (!leadId) {
      setError("Pick a lead first.");
      return;
    }
    setGenerating(true);
    setError("");
    setNotice("");
    setPreview(null);
    try {
      const data = await api.generateFollowUp({ brandId, leadId, goal });
      setPreview(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    if (!preview) return;
    setSaving(true);
    setError("");
    try {
      await api.saveFollowUp({
        brandId,
        leadId,
        goal,
        touchpoints: preview.touchpoints,
      });
      setNotice("Sequence activated.");
      setPreview(null);
      setLeadId("");
      if (onSaved) onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {error && <ErrorBanner message={error} />}
      {notice && (
        <div className="rounded-lg border border-emerald-700/50 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {notice}
        </div>
      )}

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="mb-4 text-sm font-semibold text-gray-200">
          Build a follow-up sequence
        </h3>

        {loadingLeads ? (
          <Spinner />
        ) : leads.length === 0 ? (
          <p className="text-sm text-gray-400">
            No leads yet. Once your chatbot or phone agent captures a lead, you
            can start a sequence for them here.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-gray-400">Lead</span>
              <select
                value={leadId}
                onChange={(e) => {
                  setLeadId(e.target.value);
                  setPreview(null);
                }}
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
              >
                <option value="">Select a lead…</option>
                {leads.map((l) => (
                  <option key={l.lead_id} value={l.lead_id}>
                    {(l.lead_name || "Lead") +
                      (l.email ? ` · ${l.email}` : l.phone ? ` · ${l.phone}` : "") +
                      (l.temperature ? ` (${l.temperature})` : "")}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-400">Goal</span>
              <select
                value={goal}
                onChange={(e) => {
                  setGoal(e.target.value);
                  setPreview(null);
                }}
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
              >
                {GOALS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {leads.length > 0 && (
          <button
            onClick={generate}
            disabled={generating || !leadId}
            className="mt-4 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-amber-400 disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate with AI"}
          </button>
        )}
      </div>

      {preview && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-200">
              Preview · {preview.count} touchpoint
              {preview.count === 1 ? "" : "s"}
            </h3>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? "Activating…" : "Activate sequence"}
            </button>
          </div>
          <ol className="space-y-3">
            {preview.touchpoints.map((tp) => (
              <li key={tp.stepNumber} className="rounded-lg bg-gray-950 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-300">
                    Step {tp.stepNumber}
                  </span>
                  <Badge map={CHANNEL_LABELS} value={tp.channel} />
                  <span className="text-xs text-gray-500">
                    Day {tp.dayOffset}
                  </span>
                </div>
                {tp.subject && (
                  <div className="mt-1 text-xs font-medium text-gray-300">
                    {tp.subject}
                  </div>
                )}
                <p className="mt-1 whitespace-pre-wrap text-xs text-gray-400">
                  {tp.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
