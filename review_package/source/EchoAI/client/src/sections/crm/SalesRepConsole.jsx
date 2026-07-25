import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.js";
import Spinner from "../../components/Spinner.jsx";
import ErrorBanner from "../../components/ErrorBanner.jsx";

// The Sales Rep console is a focused, one-lead-at-a-time workspace. Reps never
// see the full lead list, other reps' work, or real phone numbers — calls are
// placed through a Twilio bridge that rings the rep's own phone and connects the
// lead. Reps work the current lead, then mark it complete to pull the next.

const tempColors = {
  hot: "bg-red-500/15 text-red-300",
  warm: "bg-amber-500/15 text-amber-300",
  cold: "bg-sky-500/15 text-sky-300",
};

const OUTCOMES = [
  { value: "contacted", label: "Contacted" },
  { value: "no_answer", label: "No answer" },
  { value: "voicemail", label: "Left voicemail" },
  { value: "not_interested", label: "Not interested" },
  { value: "callback", label: "Wants callback" },
  { value: "converted", label: "Converted" },
];

const CONVERSIONS = [
  { value: "", label: "Leave unchanged" },
  { value: "in_progress", label: "In progress" },
  { value: "converted", label: "Converted" },
  { value: "lost", label: "Lost" },
];

export default function SalesRepConsole({ email, ownerBusinessName, onLogout }) {
  const [lead, setLead] = useState(null);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [calling, setCalling] = useState(false);
  const [callStatus, setCallStatus] = useState("");

  // Complete form
  const [outcome, setOutcome] = useState("contacted");
  const [conversionStatus, setConversionStatus] = useState("");
  const [notes, setNotes] = useState("");
  const [completing, setCompleting] = useState(false);

  const loadCurrent = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.crmGetCurrentLead();
      setLead(data.lead || null);
      setRemaining(data.remaining || 0);
      setCallStatus("");
      setOutcome("contacted");
      setConversionStatus("");
      setNotes("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCurrent();
  }, [loadCurrent]);

  async function placeCall() {
    setCalling(true);
    setError("");
    setNotice("");
    setCallStatus("");
    try {
      await api.crmCallCurrentLead();
      setCallStatus(
        "Calling your phone now — answer it and we'll connect you to the lead."
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setCalling(false);
    }
  }

  async function complete(e) {
    e.preventDefault();
    setCompleting(true);
    setError("");
    setNotice("");
    try {
      const data = await api.crmCompleteLead({
        outcome,
        conversionStatus: conversionStatus || undefined,
        notes: notes.trim() || undefined,
      });
      setRemaining(data.remaining || 0);
      setNotice("Lead completed. Loading your next lead…");
      await loadCurrent();
    } catch (err) {
      setError(err.message);
      setCompleting(false);
    }
    setCompleting(false);
  }

  return (
    <div className="min-h-screen bg-black text-gray-100">
      <header className="border-b border-gray-800 bg-gray-950">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-amber-400">
              Sales Rep Console
            </div>
            <div className="truncate text-xs text-gray-500">
              {ownerBusinessName ? `${ownerBusinessName} · ` : ""}
              {email}
            </div>
          </div>
          <button
            onClick={onLogout}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-800"
          >
            Log out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-lg font-bold">Your current lead</h1>
          <span className="rounded-full bg-gray-800 px-3 py-1 text-xs font-medium text-gray-300">
            {remaining} waiting in your queue
          </span>
        </div>

        <ErrorBanner message={error} />
        {notice && (
          <p className="mb-4 text-sm text-green-400">{notice}</p>
        )}

        {loading ? (
          <Spinner label="Loading your lead…" />
        ) : !lead ? (
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-10 text-center">
            <div className="text-4xl">🎉</div>
            <h2 className="mt-3 text-lg font-semibold">Your queue is clear</h2>
            <p className="mt-2 text-sm text-gray-400">
              There are no leads waiting for you right now. Check back soon — new
              leads are assigned automatically.
            </p>
            <button
              onClick={loadCurrent}
              className="mt-5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600"
            >
              Refresh
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Lead card */}
            <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">
                    {lead.name || "Unnamed lead"}
                  </h2>
                  {lead.email && (
                    <p className="mt-1 text-sm text-gray-400">{lead.email}</p>
                  )}
                </div>
                {lead.temperature && (
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                      tempColors[lead.temperature] || "bg-gray-700 text-gray-300"
                    }`}
                  >
                    {lead.temperature}
                  </span>
                )}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wide text-gray-500">
                    Phone
                  </div>
                  <div className="mt-0.5 font-mono text-sm text-gray-300">
                    {lead.phoneMasked || "—"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-gray-600">
                    Number hidden for privacy
                  </div>
                </div>
                <div className="ml-auto">
                  <button
                    onClick={placeCall}
                    disabled={calling || !lead.hasPhone}
                    className="rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-60"
                  >
                    {calling
                      ? "Connecting…"
                      : lead.hasPhone
                        ? "📞 Call lead"
                        : "No phone on file"}
                  </button>
                </div>
              </div>
              {callStatus && (
                <p className="mt-4 rounded-lg bg-green-500/10 p-3 text-sm text-green-300">
                  {callStatus}
                </p>
              )}
            </div>

            {/* Conversation history (from the chatbot / prior touches) */}
            {lead.conversationHistory && lead.conversationHistory.length > 0 && (
              <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
                <h3 className="mb-3 text-sm font-semibold text-gray-300">
                  Conversation so far
                </h3>
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {lead.conversationHistory.map((m, i) => (
                    <div
                      key={i}
                      className="rounded-lg bg-gray-950 px-3 py-2 text-sm text-gray-300"
                    >
                      <span className="mr-2 text-xs font-semibold uppercase text-gray-500">
                        {m.role || m.sender || "note"}
                      </span>
                      {m.content || m.message || m.text || ""}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Complete form */}
            <form
              onSubmit={complete}
              className="rounded-2xl border border-gray-800 bg-gray-900 p-6"
            >
              <h3 className="mb-4 text-sm font-semibold text-gray-300">
                Log outcome & pull next lead
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-400">
                    Call outcome
                  </span>
                  <select
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value)}
                    className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
                  >
                    {OUTCOMES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-400">
                    Update lead status
                  </span>
                  <select
                    value={conversionStatus}
                    onChange={(e) => setConversionStatus(e.target.value)}
                    className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
                  >
                    {CONVERSIONS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="mt-4 block">
                <span className="mb-1 block text-xs font-medium text-gray-400">
                  Notes (visible to your manager)
                </span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="What happened on this call?"
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
                />
              </label>
              <button
                disabled={completing}
                className="mt-4 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
              >
                {completing ? "Saving…" : "Complete & next lead →"}
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
