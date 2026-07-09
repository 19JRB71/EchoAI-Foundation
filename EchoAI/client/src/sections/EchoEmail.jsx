/**
 * Echo · Email & Communications (Echo department). Owner-only.
 *
 * Echo watches the owner's connected inboxes every 15 minutes: new mail is
 * categorized (urgent / important / contract / lead / invoice / payment),
 * summarized in plain English, contracts get a key-terms review, and customer
 * inquiries flow into the CRM automatically. Echo drafts replies in the
 * owner's voice — nothing is ever sent without explicit approval here.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";

const CATEGORY_META = {
  urgent: { label: "Urgent", cls: "bg-red-500/15 text-red-400" },
  important: { label: "Important", cls: "bg-amber-500/15 text-amber-400" },
  contract: { label: "Contract", cls: "bg-purple-500/15 text-purple-400" },
  lead: { label: "New Lead", cls: "bg-emerald-500/15 text-emerald-400" },
  invoice: { label: "Invoice", cls: "bg-sky-500/15 text-sky-400" },
  payment: { label: "Payment", cls: "bg-emerald-500/15 text-emerald-300" },
  general: { label: "General", cls: "bg-gray-500/15 text-gray-400" },
};

const PROVIDERS = [
  { value: "gmail", label: "Gmail" },
  { value: "yahoo", label: "Yahoo" },
  { value: "icloud", label: "iCloud" },
  { value: "outlook", label: "Outlook" },
  { value: "custom", label: "Other (custom)" },
];

const FILTERS = [
  { value: "", label: "All" },
  { value: "urgent", label: "Urgent" },
  { value: "important", label: "Important" },
  { value: "contract", label: "Contracts" },
  { value: "lead", label: "Leads" },
  { value: "invoice", label: "Invoices" },
  { value: "payment", label: "Payments" },
];

function fmtDateTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function EchoEmail() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [messages, setMessages] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [notice, setNotice] = useState("");
  const [checking, setChecking] = useState(false);

  // Connect form
  const [showConnect, setShowConnect] = useState(false);
  const [form, setForm] = useState({ provider: "gmail", emailAddress: "", password: "", displayName: "", imapHost: "", imapPort: "", smtpHost: "", smtpPort: "" });
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");

  // Compose form
  const [showCompose, setShowCompose] = useState(false);
  const [compose, setCompose] = useState({ toAddress: "", instruction: "" });
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState("");

  // Per-draft busy flag
  const [busyDraft, setBusyDraft] = useState(null);
  const [editDraft, setEditDraft] = useState(null); // { draftId, subject, body }

  const load = useCallback(
    async (opts = {}) => {
      if (opts.initial) setLoading(true);
      setError("");
      try {
        const [s, m, d] = await Promise.all([
          api.getEmailSummary(),
          api.listEmailMessages(filter || undefined),
          api.listEmailDrafts(),
        ]);
        setSummary(s);
        setMessages(m.messages || []);
        setDrafts(d.drafts || []);
      } catch (err) {
        setError(err.message || "Couldn't load your email overview.");
      } finally {
        setLoading(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    load({ initial: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const accounts = summary?.accounts || [];
  const counts = summary?.counts || null;

  async function handleConnect(e) {
    e.preventDefault();
    setConnecting(true);
    setConnectError("");
    try {
      const body = {
        provider: form.provider,
        emailAddress: form.emailAddress,
        password: form.password,
        displayName: form.displayName || undefined,
      };
      if (form.provider === "custom") {
        body.imapHost = form.imapHost;
        body.imapPort = form.imapPort ? Number(form.imapPort) : undefined;
        body.smtpHost = form.smtpHost;
        body.smtpPort = form.smtpPort ? Number(form.smtpPort) : undefined;
      }
      await api.connectEmailAccount(body);
      setShowConnect(false);
      setForm({ provider: "gmail", emailAddress: "", password: "", displayName: "", imapHost: "", imapPort: "", smtpHost: "", smtpPort: "" });
      setNotice("Mailbox connected. Echo is watching it now — new mail shows up here within 15 minutes.");
      await load();
    } catch (err) {
      setConnectError(err.message || "Couldn't connect that mailbox.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleRemove(accountId, emailAddress) {
    if (!window.confirm(`Stop watching ${emailAddress}? Its cached messages will be removed too.`)) return;
    try {
      await api.removeEmailAccount(accountId);
      setNotice(`${emailAddress} disconnected.`);
      await load();
    } catch (err) {
      setError(err.message || "Couldn't remove that account.");
    }
  }

  async function handleCheckNow() {
    setChecking(true);
    setNotice("");
    setError("");
    try {
      const r = await api.checkEmailNow();
      const total = (r.results || []).reduce((n, x) => n + (x.newMessages || 0), 0);
      const failed = (r.results || []).filter((x) => !x.ok);
      let msg = total > 0 ? `Checked your mail — ${total} new message${total === 1 ? "" : "s"}.` : "Checked your mail — nothing new.";
      if (failed.length) msg += ` (${failed.map((f) => `${f.emailAddress}: ${f.error}`).join("; ")})`;
      setNotice(msg);
      await load();
    } catch (err) {
      setError(err.message || "Couldn't check your mail right now.");
    } finally {
      setChecking(false);
    }
  }

  async function handleCompose(e) {
    e.preventDefault();
    setComposing(true);
    setComposeError("");
    try {
      await api.draftEmailMessage({ toAddress: compose.toAddress, instruction: compose.instruction });
      setShowCompose(false);
      setCompose({ toAddress: "", instruction: "" });
      setNotice("Draft ready below — review it and hit Approve & Send when you're happy.");
      await load();
    } catch (err) {
      setComposeError(err.message || "Echo couldn't draft that email.");
    } finally {
      setComposing(false);
    }
  }

  async function handleReply(message) {
    const instruction = window.prompt(`What should the reply to ${message.fromName || message.fromAddress} say?`);
    if (!instruction || !instruction.trim()) return;
    setNotice("");
    setError("");
    try {
      await api.draftEmailMessage({ replyToMessageId: message.messageId, instruction: instruction.trim() });
      setNotice("Reply drafted below — nothing sends until you approve it.");
      await load();
    } catch (err) {
      setError(err.message || "Echo couldn't draft that reply.");
    }
  }

  async function handleSend(draftId) {
    setBusyDraft(draftId);
    setError("");
    try {
      await api.sendEmailDraft(draftId);
      setNotice("Sent.");
      await load();
    } catch (err) {
      setError(err.message || "The email couldn't be sent.");
      await load();
    } finally {
      setBusyDraft(null);
    }
  }

  async function handleDiscard(draftId) {
    setBusyDraft(draftId);
    try {
      await api.discardEmailDraft(draftId);
      await load();
    } catch (err) {
      setError(err.message || "Couldn't discard that draft.");
    } finally {
      setBusyDraft(null);
    }
  }

  async function handleSaveEdit() {
    if (!editDraft) return;
    setBusyDraft(editDraft.draftId);
    try {
      await api.updateEmailDraft(editDraft.draftId, { subject: editDraft.subject, body: editDraft.body });
      setEditDraft(null);
      await load();
    } catch (err) {
      setError(err.message || "Couldn't save those changes.");
    } finally {
      setBusyDraft(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  const pendingDrafts = drafts.filter((d) => d.status === "pending");
  const otherDrafts = drafts.filter((d) => d.status !== "pending").slice(0, 10);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Email & Communications</h2>
          <p className="text-sm text-gray-400">
            Echo checks your inboxes every 15 minutes and flags what matters. Replies are drafted for your approval — nothing sends without you.
          </p>
        </div>
        <div className="flex gap-2">
          {accounts.length > 0 && (
            <>
              <button
                onClick={handleCheckNow}
                disabled={checking}
                className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
              >
                {checking ? "Checking…" : "Check now"}
              </button>
              <button
                onClick={() => { setShowCompose((v) => !v); setComposeError(""); }}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Ask Echo to write an email
              </button>
            </>
          )}
          <button
            onClick={() => { setShowConnect((v) => !v); setConnectError(""); }}
            className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800"
          >
            Connect mailbox
          </button>
        </div>
      </div>

      {notice && <div className="rounded-lg border border-emerald-700/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</div>}
      {error && <div className="rounded-lg border border-red-700/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      {showConnect && (
        <form onSubmit={handleConnect} className="space-y-3 rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <h3 className="font-medium text-white">Connect a mailbox</h3>
          <p className="text-xs text-gray-400">
            Use an <span className="text-gray-200">app password</span>, not your normal password. Gmail: Google Account → Security → App passwords. Yahoo: Account Security → Generate app password. iCloud: appleid.apple.com → App-Specific Passwords.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Display name (optional)"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            />
            <input
              type="email"
              required
              placeholder="Email address"
              value={form.emailAddress}
              onChange={(e) => setForm({ ...form, emailAddress: e.target.value })}
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            />
            <input
              type="password"
              required
              placeholder="App password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            />
            {form.provider === "custom" && (
              <>
                <input type="text" required placeholder="IMAP host (incoming)" value={form.imapHost} onChange={(e) => setForm({ ...form, imapHost: e.target.value })} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white" />
                <input type="number" placeholder="IMAP port (993)" value={form.imapPort} onChange={(e) => setForm({ ...form, imapPort: e.target.value })} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white" />
                <input type="text" required placeholder="SMTP host (outgoing)" value={form.smtpHost} onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white" />
                <input type="number" placeholder="SMTP port (465)" value={form.smtpPort} onChange={(e) => setForm({ ...form, smtpPort: e.target.value })} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white" />
              </>
            )}
          </div>
          {connectError && <p className="text-sm text-red-400">{connectError}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={connecting} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
              {connecting ? "Verifying login…" : "Connect"}
            </button>
            <button type="button" onClick={() => setShowConnect(false)} className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800">
              Cancel
            </button>
          </div>
        </form>
      )}

      {showCompose && (
        <form onSubmit={handleCompose} className="space-y-3 rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <h3 className="font-medium text-white">Ask Echo to write an email</h3>
          <input
            type="email"
            required
            placeholder="To (email address)"
            value={compose.toAddress}
            onChange={(e) => setCompose({ ...compose, toAddress: e.target.value })}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
          <textarea
            required
            rows={3}
            placeholder='What should it say? e.g. "Thank them for the meeting and confirm we start Monday."'
            value={compose.instruction}
            onChange={(e) => setCompose({ ...compose, instruction: e.target.value })}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
          {composeError && <p className="text-sm text-red-400">{composeError}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={composing} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
              {composing ? "Drafting…" : "Draft it"}
            </button>
            <button type="button" onClick={() => setShowCompose(false)} className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Connected accounts */}
      {accounts.length === 0 ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-8 text-center">
          <p className="text-lg text-white">No mailboxes connected yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-400">
            Connect your email and Echo will watch it around the clock — flagging urgent messages, reviewing contracts, capturing new customer inquiries into your CRM, and telling you about payments the moment they land.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {accounts.map((a) => (
            <div key={a.accountId} className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{a.emailAddress}</p>
                <p className="text-xs text-gray-400">
                  {a.status === "error" ? (
                    <span className="text-red-400">Connection problem — check the app password</span>
                  ) : a.lastCheckedAt ? (
                    <>Last checked {fmtDateTime(a.lastCheckedAt)} · {a.newToday} new today</>
                  ) : (
                    "Waiting for first check…"
                  )}
                </p>
              </div>
              <button onClick={() => handleRemove(a.accountId, a.emailAddress)} className="ml-3 shrink-0 text-xs text-gray-500 hover:text-red-400">
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Pending drafts (approval queue) */}
      {pendingDrafts.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-medium text-white">Waiting for your approval</h3>
          {pendingDrafts.map((d) => (
            <div key={d.draftId} className="rounded-xl border border-amber-700/40 bg-amber-500/5 p-4">
              {editDraft && editDraft.draftId === d.draftId ? (
                <div className="space-y-2">
                  <input
                    value={editDraft.subject}
                    onChange={(e) => setEditDraft({ ...editDraft, subject: e.target.value })}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                  />
                  <textarea
                    rows={6}
                    value={editDraft.body}
                    onChange={(e) => setEditDraft({ ...editDraft, body: e.target.value })}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                  />
                  <div className="flex gap-2">
                    <button onClick={handleSaveEdit} disabled={busyDraft === d.draftId} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">Save</button>
                    <button onClick={() => setEditDraft(null)} className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-gray-300">
                      To <span className="text-white">{d.toName || d.toAddress}</span>
                      <span className="text-gray-500"> from {d.fromAddress}</span>
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setEditDraft({ draftId: d.draftId, subject: d.subject, body: d.body })} className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800">Edit</button>
                      <button onClick={() => handleDiscard(d.draftId)} disabled={busyDraft === d.draftId} className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50">Discard</button>
                      <button onClick={() => handleSend(d.draftId)} disabled={busyDraft === d.draftId} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
                        {busyDraft === d.draftId ? "Sending…" : "Approve & Send"}
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 text-sm font-medium text-white">{d.subject}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-300">{d.body}</p>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Inbox digest */}
      {accounts.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium text-white">
              Recent mail{counts ? ` · ${counts.total} in the last 24h` : ""}
            </h3>
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFilter(f.value)}
                  className={`rounded-full px-3 py-1 text-xs ${filter === f.value ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-200"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {messages.length === 0 ? (
            <p className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-6 text-center text-sm text-gray-400">
              Nothing here yet — new mail appears within 15 minutes of arriving.
            </p>
          ) : (
            <div className="space-y-2">
              {messages.map((m) => {
                const meta = CATEGORY_META[m.category] || CATEGORY_META.general;
                const open = expanded === m.messageId;
                return (
                  <div key={m.messageId} className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3">
                    <button className="w-full text-left" onClick={() => setExpanded(open ? null : m.messageId)}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>{meta.label}</span>
                        <span className="text-sm font-medium text-white">{m.fromName || m.fromAddress}</span>
                        <span className="ml-auto text-xs text-gray-500">{fmtDateTime(m.receivedAt)}</span>
                      </div>
                      <p className="mt-1 truncate text-sm text-gray-300">{m.subject || "(no subject)"}</p>
                      {m.aiSummary && <p className="mt-1 text-xs text-gray-400">{m.aiSummary}</p>}
                    </button>
                    {open && (
                      <div className="mt-3 space-y-2 border-t border-gray-800 pt-3">
                        <p className="text-xs text-gray-500">{m.emailAddress} · from {m.fromAddress}</p>
                        {m.snippet && <p className="whitespace-pre-wrap text-sm text-gray-300">{m.snippet}</p>}
                        {m.contractAnalysis && (
                          <div className="rounded-lg border border-purple-700/40 bg-purple-500/5 p-3">
                            <p className="text-xs font-medium text-purple-300">Echo's contract review (plain English — not legal advice)</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-300">{m.contractAnalysis}</p>
                          </div>
                        )}
                        {m.leadId && (
                          <p className="text-xs text-emerald-400">Captured into your CRM as a lead.</p>
                        )}
                        <button onClick={() => handleReply(m)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">
                          Have Echo draft a reply
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Sent / recent draft history */}
      {otherDrafts.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-medium text-white">Recent drafts</h3>
          {otherDrafts.map((d) => (
            <div key={d.draftId} className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate text-gray-300">
                  To {d.toName || d.toAddress}: <span className="text-white">{d.subject}</span>
                </p>
                {d.status === "failed" && d.sendError && <p className="text-xs text-red-400">{d.sendError}</p>}
              </div>
              <span
                className={`ml-3 shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                  d.status === "sent"
                    ? "bg-emerald-500/15 text-emerald-400"
                    : d.status === "failed"
                      ? "bg-red-500/15 text-red-400"
                      : "bg-gray-500/15 text-gray-400"
                }`}
              >
                {d.status === "sent" ? `Sent ${fmtDateTime(d.sentAt)}` : d.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
