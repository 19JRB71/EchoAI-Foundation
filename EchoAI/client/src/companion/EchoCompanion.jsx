import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api";

// Echo — the persistent AI companion panel. Bottom-right on desktop (collapsible),
// fullscreen on mobile. Three modes, surfaced as the header label:
//   Action    — Echo is walking the user through activation (info/preview steps)
//   Approval  — an action is previewed and awaiting Approve / Decline
//   Listening — ongoing mode: chat, voice, briefings, approval queue
//
// It reuses real backend controllers: approving a preview launches a real Facebook
// campaign / activates a real content calendar. Nothing here is mocked.

const TEAL = "#14b8a6";
const RED = "#ef4444";

function ModePill({ mode }) {
  const map = {
    action: { label: "Action mode", color: "#38bdf8" },
    approval: { label: "Approval mode", color: TEAL },
    idle: { label: "Listening", color: "#a78bfa" },
  };
  const m = map[mode] || map.idle;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: m.color,
        background: `${m.color}22`,
        border: `1px solid ${m.color}55`,
        borderRadius: 999,
        padding: "2px 8px",
        letterSpacing: 0.2,
      }}
    >
      {m.label}
    </span>
  );
}

function CampaignCard({ card }) {
  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>{card.title || "Ad Campaign"}</div>
      {card.headline ? (
        <div style={styles.cardHeadline}>{card.headline}</div>
      ) : null}
      {card.body ? <div style={styles.cardBody}>{card.body}</div> : null}
      <div style={styles.cardMetaWrap}>
        {card.audience ? (
          <div style={styles.metaRow}>
            <span style={styles.metaLabel}>Audience</span>
            <span style={styles.metaVal}>{card.audience}</span>
          </div>
        ) : null}
        {card.visual ? (
          <div style={styles.metaRow}>
            <span style={styles.metaLabel}>Visual</span>
            <span style={styles.metaVal}>{card.visual}</span>
          </div>
        ) : null}
        <div style={styles.metaRow}>
          <span style={styles.metaLabel}>Budget</span>
          <span style={styles.metaVal}>${card.budget}/day</span>
        </div>
        {card.cta ? (
          <div style={styles.metaRow}>
            <span style={styles.metaLabel}>Button</span>
            <span style={styles.metaVal}>{card.cta}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CalendarCard({ card }) {
  const posts = Array.isArray(card.posts) ? card.posts : [];
  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>{card.title || "Content Calendar"}</div>
      <div style={styles.cardBody}>{card.count} post(s) scheduled to auto-publish.</div>
      <div style={styles.cardMetaWrap}>
        {posts.slice(0, 3).map((p, i) => (
          <div key={i} style={styles.metaRow}>
            <span style={styles.metaLabel}>{p.platform}</span>
            <span style={styles.metaVal}>
              {(p.content || "").slice(0, 90) || "Scheduled post"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BriefingCard({ card }) {
  const s = (card && card.stats) || {};
  const items = [
    ["Campaigns", s.campaigns],
    ["Posts scheduled", s.scheduledPosts],
    ["New leads (7d)", s.newLeads],
    ["Awaiting approval", s.pending],
  ];
  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>Daily briefing</div>
      <div style={styles.statsGrid}>
        {items.map(([label, val]) => (
          <div key={label} style={styles.statBox}>
            <div style={styles.statNum}>{val ?? 0}</div>
            <div style={styles.statLabel}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Bubble({ msg, onConnectFacebook, connecting }) {
  const isEcho = msg.role === "echo";
  return (
    <div style={{ ...styles.bubbleRow, justifyContent: isEcho ? "flex-start" : "flex-end" }}>
      <div style={isEcho ? styles.echoBubble : styles.userBubble}>
        {msg.text ? <div>{msg.text}</div> : null}
        {msg.card && msg.card.kind === "campaign" ? <CampaignCard card={msg.card} /> : null}
        {msg.card && msg.card.kind === "calendar" ? <CalendarCard card={msg.card} /> : null}
        {msg.card && msg.card.kind === "briefing" ? <BriefingCard card={msg.card} /> : null}
        {msg.type === "connection" && msg.connect === "facebook" ? (
          <button
            type="button"
            style={styles.fbButton}
            onClick={onConnectFacebook}
            disabled={connecting}
          >
            {connecting ? "Opening Facebook…" : "Connect Facebook"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function EchoCompanion({ autoOpen = false }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState([]);
  const [mode, setMode] = useState("idle");
  const [activationStatus, setActivationStatus] = useState("pending");
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [unread, setUnread] = useState(0);

  const scrollRef = useRef(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const advancingRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }, []);

  // Drive the activation loop: keep calling advance while the server says there's
  // more to do and nothing is waiting on the user (info steps chain themselves).
  const runActivation = useCallback(async () => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    try {
      let guard = 0;
      // eslint-disable-next-line no-constant-condition
      while (guard < 12) {
        guard += 1;
        const res = await api.advanceEcho();
        if (res.message) setMessages((prev) => [...prev, res.message]);
        if (res.pendingAction) {
          setPending(res.pendingAction);
          setMode("approval");
        }
        scrollToBottom();
        if (!res.more) break;
      }
    } catch (e) {
      setError(e.message || "Echo hit a snag.");
    } finally {
      advancingRef.current = false;
    }
  }, [scrollToBottom]);

  const load = useCallback(async () => {
    try {
      const state = await api.getEchoState();
      setMessages(state.messages || []);
      setMode(state.mode || "idle");
      setActivationStatus(state.activationStatus || "pending");
      setPending(state.pendingAction || null);
      return state;
    } catch (e) {
      setError(e.message || "Failed to load Echo.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + resume-after-Facebook-connect detection.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const state = await load();
      if (cancelled || !state) return;

      const params = new URLSearchParams(window.location.search);
      const fb = params.get("fb");
      if (fb) {
        // Clean the URL so a refresh doesn't re-trigger.
        params.delete("fb");
        params.delete("fb_message");
        const qs = params.toString();
        window.history.replaceState(
          {},
          "",
          window.location.pathname + (qs ? `?${qs}` : ""),
        );
        setOpen(true);
        if (fb === "connected") {
          // Resume the activation journey now that Facebook is linked.
          runActivation();
        } else {
          setError("Facebook connection didn't complete. You can try again below.");
        }
        return;
      }

      // Auto-open whenever activation is still incomplete (not just on the very
      // first visit) so Echo keeps guiding the user until they're fully live.
      if (autoOpen || state.activationStatus !== "active") {
        setOpen(true);
        // Only drive the loop forward when nothing is already awaiting approval.
        if (state.activationStatus !== "active" && !state.pendingAction) {
          runActivation();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (open) {
      setUnread(0);
      scrollToBottom();
    }
  }, [open, messages, scrollToBottom]);

  useEffect(() => {
    if (!open && messages.length) setUnread((u) => u + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const handleConnectFacebook = useCallback(async () => {
    setConnecting(true);
    setError("");
    try {
      const { authUrl } = await api.startFacebookOAuth();
      if (authUrl) {
        window.location.href = authUrl;
      } else {
        throw new Error("Couldn't start Facebook connection.");
      }
    } catch (e) {
      setError(e.message || "Couldn't start Facebook connection.");
      setConnecting(false);
    }
  }, []);

  const handleApprove = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.approveEcho();
      if (res.message) setMessages((prev) => [...prev, res.message]);
      setPending(null);
      setMode("action");
      scrollToBottom();
      if (res.more) await runActivation();
      else await load();
    } catch (e) {
      setError(e.message || "Couldn't run that action.");
    } finally {
      setBusy(false);
    }
  }, [busy, runActivation, load, scrollToBottom]);

  const handleDecline = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.declineEcho();
      if (res.message) setMessages((prev) => [...prev, res.message]);
      setPending(null);
      setMode("action");
      scrollToBottom();
      if (res.more) await runActivation();
      else await load();
    } catch (e) {
      setError(e.message || "Couldn't update that.");
    } finally {
      setBusy(false);
    }
  }, [busy, runActivation, load, scrollToBottom]);

  const handleSend = useCallback(
    async (text) => {
      const value = (text ?? input).trim();
      if (!value || busy) return;
      setBusy(true);
      setError("");
      setInput("");
      // Optimistic user bubble.
      const optimistic = { id: `local-${Date.now()}`, role: "user", type: "text", text: value };
      setMessages((prev) => [...prev, optimistic]);
      scrollToBottom();
      try {
        const res = await api.sendEchoMessage(value);
        setMessages((prev) => {
          const withoutOptimistic = prev.filter((m) => m.id !== optimistic.id);
          const next = [...withoutOptimistic];
          if (res.userMessage) next.push(res.userMessage);
          if (res.message) next.push(res.message);
          return next;
        });
        scrollToBottom();
      } catch (e) {
        setError(e.message || "Echo couldn't reply.");
      } finally {
        setBusy(false);
      }
    },
    [input, busy, scrollToBottom],
  );

  const handleBriefing = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.getEchoBriefing();
      if (res.message) setMessages((prev) => [...prev, res.message]);
      scrollToBottom();
    } catch (e) {
      setError(e.message || "Couldn't build your briefing.");
    } finally {
      setBusy(false);
    }
  }, [busy, scrollToBottom]);

  const toggleRecording = useCallback(async () => {
    if (recording) {
      if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop();
      return;
    }
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size === 0) return;
        setBusy(true);
        try {
          const { text } = await api.transcribeEchoAudio(blob);
          if (text && text.trim()) await handleSend(text.trim());
        } catch (e) {
          setError(e.message || "Couldn't transcribe that. Try typing instead.");
        } finally {
          setBusy(false);
        }
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (e) {
      setError("Microphone unavailable. You can type your message instead.");
    }
  }, [recording, handleSend]);

  // Collapsed floating button.
  if (!open) {
    return (
      <button type="button" style={styles.fab} onClick={() => setOpen(true)} aria-label="Open Echo">
        <span style={styles.fabDot} />
        <span style={styles.fabText}>Echo</span>
        {unread > 0 ? <span style={styles.fabBadge}>{unread}</span> : null}
      </button>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={styles.logoDot} />
          <div>
            <div style={styles.headerTitle}>Echo</div>
            <ModePill mode={mode} />
          </div>
        </div>
        <button type="button" style={styles.iconBtn} onClick={() => setOpen(false)} aria-label="Minimize">
          –
        </button>
      </div>

      <div style={styles.body} ref={scrollRef}>
        {loading ? (
          <div style={styles.loading}>Waking Echo up…</div>
        ) : messages.length === 0 ? (
          <div style={styles.loading}>Echo is ready. Ask a question or run your daily briefing.</div>
        ) : (
          messages.map((m) => (
            <Bubble
              key={m.id}
              msg={m}
              onConnectFacebook={handleConnectFacebook}
              connecting={connecting}
            />
          ))
        )}
        {busy ? <div style={styles.typing}>Echo is working…</div> : null}
      </div>

      {pending ? (
        <div style={styles.approvalBar}>
          <div style={styles.approvalHint}>{pending.text || "Approve to continue."}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              style={{ ...styles.approveBtn, opacity: busy ? 0.6 : 1 }}
              onClick={handleApprove}
              disabled={busy}
            >
              ✓ Approve &amp; Launch
            </button>
            <button
              type="button"
              style={{ ...styles.declineBtn, opacity: busy ? 0.6 : 1 }}
              onClick={handleDecline}
              disabled={busy}
            >
              ✕ Not now
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div style={styles.error}>{error}</div> : null}

      <div style={styles.footer}>
        <button
          type="button"
          style={styles.briefBtn}
          onClick={handleBriefing}
          disabled={busy}
          title="Daily briefing"
        >
          ☀ Briefing
        </button>
        <button
          type="button"
          style={{ ...styles.micBtn, background: recording ? RED : "#1f2937" }}
          onClick={toggleRecording}
          disabled={busy && !recording}
          title={recording ? "Stop recording" : "Speak to Echo"}
        >
          {recording ? "● Stop" : "🎤"}
        </button>
        <input
          style={styles.input}
          placeholder="Message Echo…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={busy}
        />
        <button
          type="button"
          style={styles.sendBtn}
          onClick={() => handleSend()}
          disabled={busy || !input.trim()}
        >
          ➤
        </button>
      </div>
    </div>
  );
}

const isMobile = typeof window !== "undefined" && window.innerWidth < 640;

const styles = {
  fab: {
    position: "fixed",
    bottom: 20,
    right: 20,
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#0f172a",
    color: "#f8fafc",
    border: "1px solid #1e293b",
    borderRadius: 999,
    padding: "10px 16px",
    cursor: "pointer",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
    fontWeight: 600,
  },
  fabDot: { width: 10, height: 10, borderRadius: 999, background: TEAL, boxShadow: `0 0 10px ${TEAL}` },
  fabText: { fontSize: 14 },
  fabBadge: {
    background: RED,
    color: "#fff",
    borderRadius: 999,
    fontSize: 11,
    padding: "1px 6px",
    fontWeight: 700,
  },
  panel: {
    position: "fixed",
    zIndex: 1000,
    background: "#0b1220",
    color: "#e2e8f0",
    border: "1px solid #1e293b",
    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
    display: "flex",
    flexDirection: "column",
    ...(isMobile
      ? { inset: 0, borderRadius: 0 }
      : { bottom: 20, right: 20, width: 380, height: 560, borderRadius: 16 }),
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    borderBottom: "1px solid #1e293b",
  },
  logoDot: {
    width: 30,
    height: 30,
    borderRadius: 999,
    background: `radial-gradient(circle at 30% 30%, ${TEAL}, #0f766e)`,
    boxShadow: `0 0 14px ${TEAL}88`,
  },
  headerTitle: { fontWeight: 700, fontSize: 15, lineHeight: 1.1 },
  iconBtn: {
    background: "transparent",
    color: "#94a3b8",
    border: "none",
    fontSize: 22,
    cursor: "pointer",
    lineHeight: 1,
    padding: "0 6px",
  },
  body: { flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 },
  loading: { color: "#64748b", fontSize: 13, textAlign: "center", marginTop: 20 },
  typing: { color: "#64748b", fontSize: 12, fontStyle: "italic" },
  bubbleRow: { display: "flex", width: "100%" },
  echoBubble: {
    background: "#111c30",
    border: "1px solid #1e293b",
    borderRadius: "14px 14px 14px 4px",
    padding: "10px 12px",
    maxWidth: "88%",
    fontSize: 13.5,
    lineHeight: 1.45,
  },
  userBubble: {
    background: TEAL,
    color: "#04211d",
    borderRadius: "14px 14px 4px 14px",
    padding: "10px 12px",
    maxWidth: "88%",
    fontSize: 13.5,
    lineHeight: 1.45,
    fontWeight: 500,
  },
  card: {
    marginTop: 8,
    background: "#0b1220",
    border: "1px solid #22304a",
    borderRadius: 12,
    padding: 12,
  },
  cardTitle: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "#7dd3fc", fontWeight: 700 },
  cardHeadline: { fontSize: 15, fontWeight: 700, marginTop: 6, color: "#f8fafc" },
  cardBody: { fontSize: 13, marginTop: 4, color: "#cbd5e1" },
  cardMetaWrap: { marginTop: 8, display: "flex", flexDirection: "column", gap: 6 },
  metaRow: { display: "flex", gap: 8, fontSize: 12 },
  metaLabel: { color: "#64748b", minWidth: 74, flexShrink: 0 },
  metaVal: { color: "#cbd5e1" },
  statsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 },
  statBox: { background: "#111c30", border: "1px solid #22304a", borderRadius: 10, padding: 8, textAlign: "center" },
  statNum: { fontSize: 20, fontWeight: 800, color: TEAL },
  statLabel: { fontSize: 10.5, color: "#94a3b8", marginTop: 2 },
  fbButton: {
    marginTop: 10,
    background: "#1877f2",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "9px 14px",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 13,
  },
  approvalBar: {
    borderTop: "1px solid #1e293b",
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    background: "#0d1526",
  },
  approvalHint: { fontSize: 12.5, color: "#cbd5e1" },
  approveBtn: {
    flex: 1,
    background: TEAL,
    color: "#04211d",
    border: "none",
    borderRadius: 10,
    padding: "10px 12px",
    fontWeight: 800,
    cursor: "pointer",
    fontSize: 13,
  },
  declineBtn: {
    background: "transparent",
    color: RED,
    border: `1px solid ${RED}`,
    borderRadius: 10,
    padding: "10px 12px",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 13,
  },
  error: {
    color: "#fca5a5",
    background: "#3f1d1d",
    fontSize: 12,
    padding: "8px 12px",
    margin: "0 12px",
    borderRadius: 8,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: 10,
    borderTop: "1px solid #1e293b",
  },
  briefBtn: {
    background: "#1f2937",
    color: "#e2e8f0",
    border: "1px solid #334155",
    borderRadius: 8,
    padding: "8px 8px",
    fontSize: 12,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  micBtn: {
    color: "#e2e8f0",
    border: "1px solid #334155",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 13,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  input: {
    flex: 1,
    background: "#111c30",
    color: "#e2e8f0",
    border: "1px solid #334155",
    borderRadius: 8,
    padding: "9px 12px",
    fontSize: 13,
    outline: "none",
  },
  sendBtn: {
    background: TEAL,
    color: "#04211d",
    border: "none",
    borderRadius: 8,
    padding: "9px 12px",
    fontWeight: 800,
    cursor: "pointer",
  },
};
