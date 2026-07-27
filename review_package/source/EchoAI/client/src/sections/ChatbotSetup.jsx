import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

const TABS = [
  { key: "setup", label: "Setup & Embed" },
  { key: "conversations", label: "Conversations" },
];

const AVATAR_STYLES = [
  { key: "initials", label: "Initials" },
  { key: "robot", label: "Robot" },
  { key: "circle", label: "Dot" },
];

const TEMP_LABELS = {
  hot: { label: "🔥 Hot", cls: "bg-red-500/15 text-red-300" },
  warm: { label: "Warm", cls: "bg-amber-500/15 text-amber-300" },
  tire_kicker: { label: "Tire-kicker", cls: "bg-gray-600/30 text-gray-300" },
};

function contrastColor(hex) {
  let c = (hex || "#f59e0b").replace("#", "");
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  const r = parseInt(c.substr(0, 2), 16);
  const g = parseInt(c.substr(2, 2), 16);
  const b = parseInt(c.substr(4, 2), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? "#111827" : "#ffffff";
}

function initials(name) {
  const parts = (name || "").trim().split(/\s+/).slice(0, 2);
  return (parts.map((p) => p[0]).join("") || "AI").toUpperCase();
}

function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function Badge({ value }) {
  const meta = TEMP_LABELS[value];
  if (!meta) return <span className="text-gray-500">—</span>;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function LivePreview({ brandName, greeting, accentColor, avatarStyle }) {
  const fg = contrastColor(accentColor);
  const avatar =
    avatarStyle === "robot" ? "🤖" : avatarStyle === "circle" ? "●" : initials(brandName);
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-700 bg-white shadow-xl">
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{ background: accentColor, color: fg }}
      >
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold"
          style={{ background: "rgba(255,255,255,0.25)", color: fg }}
        >
          {avatar}
        </div>
        <span className="text-sm font-semibold">{brandName || "Your Brand"}</span>
      </div>
      <div className="space-y-2 bg-slate-50 p-4">
        <div className="max-w-[80%] rounded-2xl rounded-bl-sm border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800">
          {greeting || "Hi! How can I help you today?"}
        </div>
        <div
          className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm px-3 py-2 text-sm"
          style={{ background: accentColor, color: fg }}
        >
          What are your hours?
        </div>
      </div>
      <div className="flex gap-2 border-t border-gray-200 bg-white p-3">
        <div className="flex-1 rounded-full border border-gray-300 px-3 py-2 text-sm text-gray-400">
          Type your message…
        </div>
        <div
          className="rounded-full px-4 py-2 text-sm font-semibold"
          style={{ background: accentColor, color: fg }}
        >
          Send
        </div>
      </div>
    </div>
  );
}

export default function ChatbotSetup({ brandId }) {
  const [tab, setTab] = useState("setup");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [brandName, setBrandName] = useState("");
  const [greeting, setGreeting] = useState("");
  const [accentColor, setAccentColor] = useState("#f59e0b");
  const [avatarStyle, setAvatarStyle] = useState("initials");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [sessions, setSessions] = useState([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [copied, setCopied] = useState(false);

  const embedCode = useMemo(() => {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://your-domain";
    return `<script src="${origin}/chatbot-widget.js" data-brand-id="${brandId}" defer></script>`;
  }, [brandId]);

  const loadConfig = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const cfg = await api.getChatbotConfigForOwner(brandId);
      setBrandName(cfg.brandName || "");
      setGreeting(cfg.greeting || "");
      setAccentColor(cfg.accentColor || "#f59e0b");
      setAvatarStyle(cfg.avatarStyle || "initials");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  const loadSessions = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.getChatbotSessions(brandId);
      setSessions(res.sessions || []);
      setSessionsLoaded(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setSessionsLoaded(false);
    setSessions([]);
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (tab === "conversations" && !sessionsLoaded) loadSessions();
  }, [tab, sessionsLoaded, loadSessions]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      await api.saveChatbotConfig({ brandId, greeting, accentColor, avatarStyle });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function copyEmbed() {
    navigator.clipboard
      .writeText(embedCode)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setError("Couldn't copy to clipboard — please copy manually."));
  }

  if (!brandId) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-8 text-center text-gray-400">
        Select or create a brand to set up your website chatbot.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Website Chatbot</h1>
        <p className="mt-1 text-sm text-gray-400">
          Add an AI assistant to your website that answers visitor questions,
          qualifies leads, and captures contact details automatically.
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "border-b-2 border-amber-500 text-amber-400"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      {loading && <Spinner />}

      {tab === "setup" && !loading && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <div className="space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                Customize
              </h2>

              <label className="block">
                <span className="text-sm font-medium text-gray-300">Greeting message</span>
                <textarea
                  value={greeting}
                  onChange={(e) => setGreeting(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Hi! 👋 How can I help you today?"
                  className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
                />
                <span className="mt-1 block text-xs text-gray-500">
                  Shown as the first message when a visitor opens the chat.
                </span>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-gray-300">Accent color</span>
                <div className="mt-1 flex items-center gap-3">
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded border border-gray-700 bg-gray-950"
                  />
                  <input
                    type="text"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="w-32 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </label>

              <div>
                <span className="text-sm font-medium text-gray-300">Avatar style</span>
                <div className="mt-2 flex gap-2">
                  {AVATAR_STYLES.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => setAvatarStyle(s.key)}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                        avatarStyle === s.key
                          ? "border-amber-500 bg-amber-500/10 text-amber-300"
                          : "border-gray-700 text-gray-300 hover:border-gray-600"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-amber-400 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
                {saved && <span className="text-sm text-emerald-400">Saved ✓</span>}
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                Embed on your website
              </h2>
              <p className="text-sm text-gray-400">
                Paste this snippet just before the closing{" "}
                <code className="rounded bg-gray-800 px-1 text-amber-300">&lt;/body&gt;</code>{" "}
                tag on any page. The chat bubble appears in the bottom-right corner.
              </p>
              <pre className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-950 p-3 text-xs text-gray-300">
                <code>{embedCode}</code>
              </pre>
              <button
                onClick={copyEmbed}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200 transition hover:border-amber-500 hover:text-amber-300"
              >
                {copied ? "Copied ✓" : "Copy embed code"}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
              Live preview
            </h2>
            <LivePreview
              brandName={brandName}
              greeting={greeting}
              accentColor={accentColor}
              avatarStyle={avatarStyle}
            />
          </div>
        </div>
      )}

      {tab === "conversations" && !loading && (
        <div className="space-y-3">
          {sessions.length === 0 ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-8 text-center text-gray-400">
              No conversations yet. Once visitors chat with your widget, they'll
              show up here.
            </div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.sessionId}
                className="rounded-xl border border-gray-800 bg-gray-900"
              >
                <button
                  onClick={() =>
                    setExpanded(expanded === s.sessionId ? null : s.sessionId)
                  }
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">
                        {s.lead?.name || s.lead?.email || "Anonymous visitor"}
                      </span>
                      <Badge value={s.temperature} />
                    </div>
                    <div className="mt-0.5 truncate text-xs text-gray-500">
                      {s.lead?.email || s.lead?.phone || "No contact captured"} ·{" "}
                      {fmtDate(s.lastActiveAt)} · {s.transcript.length} messages
                    </div>
                  </div>
                  <span className="shrink-0 text-gray-500">
                    {expanded === s.sessionId ? "▲" : "▼"}
                  </span>
                </button>

                {expanded === s.sessionId && (
                  <div className="space-y-2 border-t border-gray-800 bg-gray-950 px-5 py-4">
                    {s.transcript.length === 0 ? (
                      <p className="text-sm text-gray-500">No messages.</p>
                    ) : (
                      s.transcript.map((m, i) => (
                        <div
                          key={i}
                          className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                            m.role === "user"
                              ? "ml-auto bg-amber-500/15 text-amber-100"
                              : "bg-gray-800 text-gray-200"
                          }`}
                        >
                          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-gray-500">
                            {m.role === "user" ? "Visitor" : "Assistant"}
                          </span>
                          {m.content}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
