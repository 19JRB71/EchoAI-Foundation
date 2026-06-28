import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

const TABS = [
  { key: "campaigns", label: "Campaigns" },
  { key: "conversations", label: "Conversations" },
  { key: "contacts", label: "Contacts" },
  { key: "analytics", label: "Analytics" },
];

const SEGMENTS = [
  { value: "all", label: "All contacts" },
  { value: "hot", label: "Hot leads" },
  { value: "warm", label: "Warm leads" },
  { value: "tire_kicker", label: "Cold / tire-kickers" },
];

const CAMPAIGN_STATUS = {
  draft: { label: "Draft", cls: "bg-gray-600/30 text-gray-300" },
  sending: { label: "Sending", cls: "bg-amber-500/15 text-amber-300" },
  sent: { label: "Sent", cls: "bg-emerald-500/15 text-emerald-300" },
  failed: { label: "Failed", cls: "bg-red-500/15 text-red-300" },
};

const TEMP_LABELS = {
  hot: { label: "Hot", cls: "bg-red-500/15 text-red-300" },
  warm: { label: "Warm", cls: "bg-amber-500/15 text-amber-300" },
  tire_kicker: { label: "Cold", cls: "bg-sky-500/15 text-sky-300" },
};

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
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function SmsMarketing({ brandId }) {
  const [tab, setTab] = useState("campaigns");

  if (!brandId) {
    return (
      <p className="text-sm text-gray-400">
        Select or create a brand to run SMS marketing.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-100">Two-Way SMS Marketing</h2>
        <p className="mt-1 text-sm text-gray-400">
          Send AI-written text campaigns to your contacts and let the AI handle
          two-way replies automatically. Inbound STOP requests opt a contact out
          everywhere, instantly.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
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

      {tab === "campaigns" && <Campaigns brandId={brandId} />}
      {tab === "conversations" && <Conversations brandId={brandId} />}
      {tab === "contacts" && <Contacts brandId={brandId} />}
      {tab === "analytics" && <Analytics brandId={brandId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

function Campaigns({ brandId }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showBuilder, setShowBuilder] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.getSmsCampaigns(brandId);
      setCampaigns(res.campaigns || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  async function send(id) {
    setBusyId(id);
    setError("");
    try {
      await api.sendSmsCampaign(id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (showBuilder) {
    return (
      <CampaignBuilder
        brandId={brandId}
        onClose={() => setShowBuilder(false)}
        onSaved={() => {
          setShowBuilder(false);
          load();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-200">Campaigns</h3>
        <button
          onClick={() => setShowBuilder(true)}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-400"
        >
          New Campaign
        </button>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading ? (
        <Spinner />
      ) : campaigns.length === 0 ? (
        <p className="text-sm text-gray-400">
          No campaigns yet. Create your first SMS campaign to reach your contacts.
        </p>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <div
              key={c.campaign_id}
              className="rounded-xl border border-gray-800 bg-gray-900/40 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="truncate font-semibold text-gray-100">
                      {c.campaign_name}
                    </h4>
                    <Badge map={CAMPAIGN_STATUS} value={c.status} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-gray-400">
                    {c.message_content}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-500">
                    <span>{c.recipient_count} recipients</span>
                    <span>{c.delivered_count} delivered</span>
                    <span>{c.reply_count} replies</span>
                    <span>{c.sent_at ? `Sent ${fmt(c.sent_at)}` : `Created ${fmt(c.created_at)}`}</span>
                  </div>
                </div>
                {(c.status === "draft" || c.status === "failed") && (
                  <button
                    onClick={() => send(c.campaign_id)}
                    disabled={busyId === c.campaign_id}
                    className="shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {busyId === c.campaign_id ? "Sending…" : "Send Now"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignBuilder({ brandId, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [cta, setCta] = useState("");
  const [segment, setSegment] = useState("all");
  const [message, setMessage] = useState("");
  const [variations, setVariations] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    if (!goal.trim()) {
      setError("Describe the goal of this campaign first.");
      return;
    }
    setGenerating(true);
    setError("");
    try {
      const segLabel = SEGMENTS.find((s) => s.value === segment)?.label;
      const res = await api.generateSmsMessages({
        brandId,
        goal,
        audienceSegment: segLabel,
        callToAction: cta || undefined,
      });
      setVariations(res.variations || []);
      if ((res.variations || []).length > 0 && !message) {
        setMessage(res.variations[0]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    if (!name.trim() || !message.trim()) {
      setError("A campaign name and message are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.createSmsCampaign({
        brandId,
        campaignName: name,
        messageContent: message,
        segmentFilter: segment,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const chars = message.length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-200">New Campaign</h3>
        <button
          onClick={onClose}
          className="text-sm text-gray-400 hover:text-gray-200"
        >
          ← Back
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-gray-300">Campaign name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Spring promo"
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100 outline-none focus:border-amber-500"
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-300">Send to</span>
          <select
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100 outline-none focus:border-amber-500"
          >
            {SEGMENTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-gray-300">Campaign goal (for the AI)</span>
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Drive bookings for our weekend sale"
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100 outline-none focus:border-amber-500"
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-300">Call to action (optional)</span>
          <input
            value={cta}
            onChange={(e) => setCta(e.target.value)}
            placeholder="Book at example.com"
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100 outline-none focus:border-amber-500"
          />
        </label>
      </div>

      <button
        onClick={generate}
        disabled={generating}
        className="rounded-lg border border-amber-500 px-4 py-2 text-sm font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
      >
        {generating ? "Generating…" : "✨ Generate with AI"}
      </button>

      {variations.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-gray-300">Pick a variation:</p>
          {variations.map((v, i) => (
            <button
              key={i}
              onClick={() => setMessage(v)}
              className={[
                "block w-full rounded-lg border px-3 py-2 text-left text-sm transition",
                message === v
                  ? "border-amber-500 bg-amber-500/10 text-gray-100"
                  : "border-gray-700 text-gray-300 hover:bg-gray-800",
              ].join(" ")}
            >
              {v}
            </button>
          ))}
        </div>
      )}

      <label className="block text-sm">
        <span className="text-gray-300">Message</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder="Write your SMS or generate one with AI…"
          className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100 outline-none focus:border-amber-500"
        />
        <span className={`mt-1 block text-xs ${chars > 160 ? "text-amber-400" : "text-gray-500"}`}>
          {chars} characters{chars > 160 ? ` · ${Math.ceil(chars / 153)} SMS segments` : ""}
        </span>
      </label>

      <div className="flex gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-amber-500 px-5 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-400 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save as Draft"}
        </button>
        <button
          onClick={onClose}
          className="rounded-lg border border-gray-700 px-5 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

function Conversations({ brandId }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.getSmsConversations(brandId);
      setConversations(res.conversations || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  const active = useMemo(
    () => conversations.find((c) => c.leadId === activeId) || null,
    [conversations, activeId],
  );

  async function send() {
    if (!active || !reply.trim()) return;
    setSending(true);
    setError("");
    try {
      await api.sendSmsReply({ brandId, leadId: active.leadId, message: reply });
      setReply("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} />;
  if (conversations.length === 0) {
    return (
      <p className="text-sm text-gray-400">
        No SMS conversations yet. Once contacts reply to your messages, their
        threads appear here.
      </p>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <div className="space-y-2">
        {conversations.map((c) => (
          <button
            key={c.leadId}
            onClick={() => setActiveId(c.leadId)}
            className={[
              "block w-full rounded-lg border px-3 py-2 text-left transition",
              activeId === c.leadId
                ? "border-amber-500 bg-amber-500/10"
                : "border-gray-800 hover:bg-gray-800",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium text-gray-100">
                {c.leadName || c.phone || "Unknown"}
              </span>
              <Badge map={TEMP_LABELS} value={c.temperature} />
            </div>
            <p className="truncate text-xs text-gray-400">
              {c.messages[c.messages.length - 1]?.body}
            </p>
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
        {!active ? (
          <p className="text-sm text-gray-400">Select a conversation.</p>
        ) : (
          <div className="flex h-full flex-col">
            <div className="mb-3 border-b border-gray-800 pb-2">
              <p className="font-semibold text-gray-100">
                {active.leadName || active.phone}
              </p>
              <p className="text-xs text-gray-500">{active.phone}</p>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto" style={{ maxHeight: 360 }}>
              {active.messages.map((m) => (
                <div
                  key={m.messageId}
                  className={m.direction === "outbound" ? "text-right" : "text-left"}
                >
                  <div
                    className={[
                      "inline-block max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                      m.direction === "outbound"
                        ? "bg-amber-500 text-gray-900"
                        : "bg-gray-800 text-gray-100",
                    ].join(" ")}
                  >
                    {m.body}
                  </div>
                  <div className="mt-0.5 text-[10px] text-gray-500">{fmt(m.at)}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Type a reply…"
                className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-amber-500"
              />
              <button
                onClick={send}
                disabled={sending || !reply.trim()}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-400 disabled:opacity-50"
              >
                {sending ? "…" : "Send"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

function Contacts({ brandId }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.getSmsContacts(brandId);
      setContacts(res.contacts || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  async function resubscribe(phone) {
    setBusy(phone);
    setError("");
    try {
      await api.resubscribeSmsContact({ brandId, phone });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} />;
  if (contacts.length === 0) {
    return (
      <p className="text-sm text-gray-400">
        No contacts with a phone number yet. Leads with phone numbers will show up
        here.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-900/60 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Phone</th>
            <th className="px-4 py-3">Temperature</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {contacts.map((c) => (
            <tr key={c.lead_id}>
              <td className="px-4 py-3 text-gray-100">{c.lead_name || "—"}</td>
              <td className="px-4 py-3 text-gray-300">{c.phone}</td>
              <td className="px-4 py-3">
                <Badge map={TEMP_LABELS} value={c.temperature} />
              </td>
              <td className="px-4 py-3">
                {c.opted_out ? (
                  <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-300">
                    Opted out
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
                    Subscribed
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {c.opted_out && (
                  <button
                    onClick={() => resubscribe(c.phone)}
                    disabled={busy === c.phone}
                    className="rounded-lg border border-gray-700 px-3 py-1 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                  >
                    {busy === c.phone ? "…" : "Re-subscribe"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-100">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

function Analytics({ brandId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.getSmsAnalytics(brandId);
        if (alive) setData(res);
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [brandId]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;

  const maxDay = Math.max(
    1,
    ...data.activity.map((d) => Math.max(d.sent, d.received)),
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Sent this month" value={data.sentThisMonth} />
        <Stat label="Received this month" value={data.receivedThisMonth} />
        <Stat label="Campaigns sent" value={data.campaignsSent} />
        <Stat label="Delivery rate" value={`${data.deliveryRate}%`} />
        <Stat label="Reply rate" value={`${data.replyRate}%`} />
        <Stat label="Opted out" value={data.optOuts} sub="Across all contacts" />
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
        <h3 className="mb-4 text-sm font-semibold text-gray-200">
          Last 30 days
        </h3>
        {data.activity.length === 0 ? (
          <p className="text-sm text-gray-400">No SMS activity yet.</p>
        ) : (
          <div className="flex items-end gap-1" style={{ height: 160 }}>
            {data.activity.map((d) => (
              <div
                key={d.day}
                className="flex flex-1 flex-col items-center justify-end gap-0.5"
                title={`${d.day}: ${d.sent} sent, ${d.received} received`}
              >
                <div
                  className="w-full rounded-t bg-amber-500"
                  style={{ height: `${(d.sent / maxDay) * 120}px` }}
                />
                <div
                  className="w-full rounded-t bg-sky-500"
                  style={{ height: `${(d.received / maxDay) * 120}px` }}
                />
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-amber-500" /> Sent
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-sky-500" /> Received
          </span>
        </div>
      </div>
    </div>
  );
}
