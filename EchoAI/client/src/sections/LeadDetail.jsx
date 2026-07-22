import { useEffect, useState } from "react";
import { api } from "../api.js";
import Badge from "../components/Badge.jsx";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

export default function LeadDetail({ leadId, jobberConnected = false, onClose }) {
  const [lead, setLead] = useState(null);
  const [interactions, setInteractions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [outcomeCapture, setOutcomeCapture] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await api.getLead(leadId);
        if (!active) return;
        setLead(data.lead || null);
        setInteractions(data.interactions || []);
        setOutcomeCapture(data.outcomeCapture === true);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [leadId]);

  const conversation = Array.isArray(lead?.conversation_history)
    ? lead.conversation_history
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-gray-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-lg font-bold text-gray-100">Lead profile</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-400"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <Spinner label="Loading lead…" />
        ) : error ? (
          <ErrorBanner message={error} />
        ) : lead ? (
          <div className="space-y-5">
            <div className="space-y-1">
              <p className="text-xl font-semibold text-gray-100">
                {lead.lead_name || "Unnamed lead"}
              </p>
              <div className="flex items-center gap-2">
                <Badge temperature={lead.temperature} />
                <span className="text-xs text-gray-400">
                  {lead.conversion_status}
                </span>
              </div>
            </div>

            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <Field label="Email" value={lead.email} />
              <Field label="Phone" value={lead.phone} />
            </dl>

            {jobberConnected && (
              <JobberSendSection
                lead={lead}
                onSent={(jobberClientId) =>
                  setLead((prev) => ({ ...prev, jobber_client_id: jobberClientId }))
                }
              />
            )}

            {outcomeCapture && (
              <OutcomeSection lead={lead} onRecorded={(updated) => setLead((prev) => ({ ...prev, ...updated }))} />
            )}

            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-300">
                Conversation history
              </h4>
              {conversation.length === 0 ? (
                <p className="text-sm text-gray-400">No conversation recorded.</p>
              ) : (
                <div className="space-y-2">
                  {conversation.map((m, i) => (
                    <div
                      key={i}
                      className={`rounded-lg p-2 text-sm ${
                        m.role === "user"
                          ? "bg-gray-800 text-gray-200"
                          : "bg-amber-500/10 text-amber-300"
                      }`}
                    >
                      <span className="mb-0.5 block text-xs font-semibold uppercase text-gray-400">
                        {m.role}
                      </span>
                      {m.content}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {interactions.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-semibold text-gray-300">
                  Interactions
                </h4>
                <ul className="space-y-1 text-sm text-gray-400">
                  {interactions.map((it) => (
                    <li
                      key={it.interaction_id}
                      className="flex justify-between gap-2"
                    >
                      <span>{it.interaction_type}</span>
                      <span className="text-gray-400">
                        {formatDate(it.occurred_at || it.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const OUTCOME_LABELS = {
  won: "Won",
  lost: "Lost",
  no_show: "No-show",
  unqualified: "Not a fit",
};

/**
 * Sage V2 P3 outcome chips — rendered only when the server says outcome
 * capture is enabled. Two taps: pick the outcome, then (for Won) the deal
 * value or (for Lost) an optional reason. Deal value is never guessed — an
 * empty value saves as "won, value pending".
 */
function OutcomeSection({ lead, onRecorded }) {
  const [picking, setPicking] = useState(null); // outcome awaiting details
  const [valueDollars, setValueDollars] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const recorded = lead.outcome || null;

  async function save(outcome) {
    setSaving(true);
    setSaveError("");
    try {
      let dealValueCents;
      if (outcome === "won" && valueDollars.trim() !== "") {
        const dollars = Number(valueDollars);
        if (!Number.isFinite(dollars) || dollars < 0) {
          setSaveError("Deal value must be a number (or leave it blank for now).");
          setSaving(false);
          return;
        }
        dealValueCents = Math.round(dollars * 100);
      }
      const data = await api.recordLeadOutcome(lead.lead_id, {
        outcome,
        reason: reason.trim() || undefined,
        dealValueCents,
      });
      if (data && data.enabled === false) {
        setSaveError("Outcome capture is currently turned off.");
        return;
      }
      if (data && data.lead) onRecorded(data.lead);
      setPicking(null);
      setValueDollars("");
      setReason("");
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
      <h4 className="mb-2 text-sm font-semibold text-gray-300">Outcome</h4>
      {recorded ? (
        <div className="space-y-1 text-sm">
          <p className="text-gray-200">
            <span
              className={`mr-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                recorded === "won"
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-gray-800 text-gray-300"
              }`}
            >
              {OUTCOME_LABELS[recorded] || recorded}
            </span>
            {recorded === "won" &&
              (lead.deal_value_cents != null
                ? `$${(Number(lead.deal_value_cents) / 100).toLocaleString()}`
                : "value pending")}
          </p>
          {lead.outcome_reason && (
            <p className="text-xs text-gray-400">{lead.outcome_reason}</p>
          )}
          <button
            onClick={() => setPicking("won")}
            className="text-xs text-amber-400 hover:text-amber-300"
          >
            Change
          </button>
        </div>
      ) : null}

      {(!recorded || picking) && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(OUTCOME_LABELS).map(([value, label]) => (
              <button
                key={value}
                disabled={saving}
                onClick={() => {
                  setPicking(value);
                  setSaveError("");
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  picking === value
                    ? "bg-amber-500 text-gray-900"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {picking && (
            <div className="flex flex-wrap items-center gap-2">
              {picking === "won" && (
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={valueDollars}
                  onChange={(e) => setValueDollars(e.target.value)}
                  placeholder="Deal value $ (optional)"
                  className="w-40 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200"
                />
              )}
              {picking !== "won" && (
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why? (optional)"
                  className="w-48 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200"
                />
              )}
              <button
                disabled={saving}
                onClick={() => save(picking)}
                className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-amber-400 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          )}
          {saveError && <p className="text-xs text-red-400">{saveError}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * "Send to Jobber" — rendered only when the owner's Jobber account is
 * connected. Idempotent server-side: an already-linked lead just reports its
 * existing Jobber client instead of creating a duplicate.
 */
function JobberSendSection({ lead, onSent }) {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [webUri, setWebUri] = useState(null);
  const [sendError, setSendError] = useState("");

  const linked = Boolean(lead.jobber_client_id);

  async function send() {
    setSending(true);
    setSendError("");
    setMessage("");
    try {
      const data = await api.sendLeadToJobber(lead.lead_id);
      setMessage(data.message || "Lead created in Jobber.");
      if (data.jobberWebUri) setWebUri(data.jobberWebUri);
      if (data.jobberClientId) onSent(data.jobberClientId);
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-gray-300">Jobber</h4>
        {linked ? (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
            In Jobber
          </span>
        ) : (
          <button
            onClick={send}
            disabled={sending}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send to Jobber"}
          </button>
        )}
        {webUri && (
          <a
            href={webUri}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-amber-400 hover:text-amber-300"
          >
            Open in Jobber ↗
          </a>
        )}
      </div>
      {message && <p className="mt-1 text-xs text-emerald-300">{message}</p>}
      {sendError && <p className="mt-1 text-xs text-red-400">{sendError}</p>}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-gray-400">{label}</dt>
      <dd className="text-gray-200">{value || "—"}</dd>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}
