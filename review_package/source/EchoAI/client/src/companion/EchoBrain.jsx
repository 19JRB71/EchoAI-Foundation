import { useState, useEffect, useCallback } from "react";
import { api } from "../api";

// Echo's Brain — a slide-over inside the Echo companion with two capabilities:
//   Memory      — ask Echo to recall anything about a lead/customer/campaign
//                 (AI-grounded on real records) + a timeline of what Echo saw.
//   Autonomous  — configure Autonomous Growth Mode guardrails (budget cap,
//                 approval threshold, brand voice, geo) and review the actions
//                 Echo has proposed/taken within them.
// Nothing is mocked: recall calls the AI over real records; settings persist.

const TEAL = "#14b8a6";

function fmt(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

const RISK_COLOR = { low: "#22c55e", medium: "#f59e0b", high: "#ef4444" };
const STATUS_COLOR = { proposed: "#a78bfa", approved: "#22c55e", executed: "#38bdf8", declined: "#94a3b8", failed: "#ef4444" };

export function MemoryTab() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadTimeline = useCallback(async () => {
    try {
      const res = await api.getEchoMemory();
      setEvents(res.events || []);
    } catch {
      /* timeline is best-effort */
    }
  }, []);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  async function handleRecall() {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError("");
    setAnswer("");
    try {
      const res = await api.recallEchoMemory(q);
      setAnswer(res.answer || "No answer.");
    } catch (e) {
      setError(e.message || "Couldn't recall that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.tabBody}>
      <div style={styles.hint}>Ask about a lead, customer, call or campaign — Echo remembers.</div>
      <div style={styles.searchRow}>
        <input
          style={styles.input}
          placeholder="e.g. What did Sarah want?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRecall();
          }}
          disabled={busy}
        />
        <button style={styles.primaryBtn} onClick={handleRecall} disabled={busy || !query.trim()}>
          {busy ? "…" : "Recall"}
        </button>
      </div>
      {error ? <div style={styles.error}>{error}</div> : null}
      {answer ? <div style={styles.answer}>{answer}</div> : null}

      <div style={styles.sectionLabel}>Recent memory</div>
      {events.length === 0 ? (
        <div style={styles.empty}>Nothing recorded yet. Echo logs key moments as your team works.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {events.map((ev) => (
            <div key={ev.id} style={styles.eventCard}>
              <div style={styles.eventTitle}>{ev.title}</div>
              {ev.detail ? <div style={styles.eventDetail}>{ev.detail}</div> : null}
              <div style={styles.eventMeta}>{fmt(ev.occurredAt)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AutonomousTab({ readOnly = false }) {
  const [settings, setSettings] = useState(null);
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [actingId, setActingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, a] = await Promise.all([api.getEchoGrowth(), api.getEchoGrowthActions().catch(() => ({ actions: [] }))]);
      setSettings(s.settings || {});
      setActions(a.actions || []);
    } catch (e) {
      setError(e.message || "Couldn't load Autonomous Growth.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function update(patch) {
    setSettings((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }

  async function save() {
    if (saving || !settings) return;
    setSaving(true);
    setError("");
    try {
      const res = await api.updateEchoGrowth({
        enabled: !!settings.enabled,
        monthlyBudgetCap: settings.monthlyBudgetCap === "" ? null : settings.monthlyBudgetCap,
        approvalThreshold: settings.approvalThreshold === "" ? null : settings.approvalThreshold,
        brandVoiceRules: settings.brandVoiceRules || "",
        geoTargeting: settings.geoTargeting || "",
      });
      setSettings(res.settings || settings);
      setSaved(true);
    } catch (e) {
      setError(e.message || "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function act(id, kind) {
    if (actingId) return;
    setActingId(id);
    setError("");
    try {
      if (kind === "approve") await api.approveEchoGrowthAction(id);
      else await api.declineEchoGrowthAction(id);
      setActions((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: kind === "approve" ? "approved" : "declined" } : a)),
      );
    } catch (e) {
      setError(e.message || "Couldn't update that action.");
    } finally {
      setActingId(null);
    }
  }

  if (loading) return <div style={styles.tabBody}><div style={styles.empty}>Loading…</div></div>;

  return (
    <div style={styles.tabBody}>
      <div style={styles.hint}>
        Let Echo act on its own within limits you set. Anything above your approval threshold still waits for your OK.
      </div>

      <label style={styles.toggleRow}>
        <span style={{ fontWeight: 600 }}>Autonomous Growth Mode</span>
        <input
          type="checkbox"
          checked={!!(settings && settings.enabled)}
          onChange={(e) => update({ enabled: e.target.checked })}
          disabled={readOnly}
        />
      </label>

      <div style={styles.field}>
        <span style={styles.fieldLabel}>Monthly budget cap ($)</span>
        <input
          type="number"
          min="0"
          style={styles.input}
          value={settings.monthlyBudgetCap ?? ""}
          onChange={(e) => update({ monthlyBudgetCap: e.target.value === "" ? "" : Number(e.target.value) })}
          placeholder="e.g. 2000"
          disabled={readOnly}
        />
      </div>

      <div style={styles.field}>
        <span style={styles.fieldLabel}>Ask me before spending more than ($)</span>
        <input
          type="number"
          min="0"
          style={styles.input}
          value={settings.approvalThreshold ?? ""}
          onChange={(e) => update({ approvalThreshold: e.target.value === "" ? "" : Number(e.target.value) })}
          placeholder="e.g. 200"
          disabled={readOnly}
        />
      </div>

      <div style={styles.field}>
        <span style={styles.fieldLabel}>Brand voice rules</span>
        <textarea
          style={{ ...styles.input, minHeight: 60, resize: "vertical" }}
          value={settings.brandVoiceRules ?? ""}
          onChange={(e) => update({ brandVoiceRules: e.target.value })}
          placeholder="Tone, phrases to use/avoid, dos & don'ts…"
          disabled={readOnly}
        />
      </div>

      <div style={styles.field}>
        <span style={styles.fieldLabel}>Geo targeting</span>
        <input
          style={styles.input}
          value={settings.geoTargeting ?? ""}
          onChange={(e) => update({ geoTargeting: e.target.value })}
          placeholder="e.g. Austin, TX + 25mi"
          disabled={readOnly}
        />
      </div>

      {error ? <div style={styles.error}>{error}</div> : null}
      {readOnly ? (
        <div style={styles.empty}>
          These guardrails are managed by the account owner. You can review Echo's
          proposals and actions below.
        </div>
      ) : (
        <button style={styles.primaryBtn} onClick={save} disabled={saving}>
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save guardrails"}
        </button>
      )}

      <div style={styles.sectionLabel}>Echo's proposals & actions</div>
      {actions.length === 0 ? (
        <div style={styles.empty}>No actions yet. When enabled, Echo's proposals and moves show up here.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {actions.map((a) => (
            <div key={a.id} style={styles.eventCard}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={styles.eventTitle}>{a.title}</span>
                <span style={{ ...styles.pill, color: STATUS_COLOR[a.status] || "#94a3b8", borderColor: `${STATUS_COLOR[a.status] || "#94a3b8"}55` }}>
                  {a.status}
                </span>
              </div>
              {a.detail ? <div style={styles.eventDetail}>{a.detail}</div> : null}
              <div style={styles.eventMeta}>
                <span style={{ color: RISK_COLOR[a.risk] || "#94a3b8" }}>{a.risk || "low"} risk</span>
                {a.createdAt ? ` · ${fmt(a.createdAt)}` : ""}
              </div>
              {!readOnly && a.status === "proposed" ? (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    style={styles.approveBtn}
                    onClick={() => act(a.id, "approve")}
                    disabled={actingId === a.id}
                  >
                    {actingId === a.id ? "…" : "Approve"}
                  </button>
                  <button
                    style={styles.declineBtn}
                    onClick={() => act(a.id, "decline")}
                    disabled={actingId === a.id}
                  >
                    Decline
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EchoBrain({ onClose }) {
  const [tab, setTab] = useState("memory");
  return (
    <div style={styles.overlay}>
      <div style={styles.header}>
        <div style={styles.tabs}>
          <button
            style={{ ...styles.tab, ...(tab === "memory" ? styles.tabActive : {}) }}
            onClick={() => setTab("memory")}
          >
            🧠 Memory
          </button>
          <button
            style={{ ...styles.tab, ...(tab === "autonomous" ? styles.tabActive : {}) }}
            onClick={() => setTab("autonomous")}
          >
            ⚡ Autonomous
          </button>
        </div>
        <button style={styles.closeBtn} onClick={onClose} aria-label="Back to chat">
          ✕
        </button>
      </div>
      <div style={styles.scroll}>{tab === "memory" ? <MemoryTab /> : <AutonomousTab />}</div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "absolute",
    inset: 0,
    background: "#0b1220",
    display: "flex",
    flexDirection: "column",
    zIndex: 5,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    borderBottom: "1px solid #1e293b",
    gap: 8,
  },
  tabs: { display: "flex", gap: 6 },
  tab: {
    background: "transparent",
    color: "#94a3b8",
    border: "1px solid #1e293b",
    borderRadius: 999,
    padding: "5px 12px",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  tabActive: { color: "#04211d", background: TEAL, borderColor: TEAL },
  closeBtn: {
    background: "transparent",
    color: "#94a3b8",
    border: "none",
    fontSize: 16,
    cursor: "pointer",
    padding: "0 4px",
  },
  scroll: { flex: 1, overflowY: "auto" },
  tabBody: { padding: 14, display: "flex", flexDirection: "column", gap: 10 },
  hint: { fontSize: 12.5, color: "#94a3b8", lineHeight: 1.4 },
  searchRow: { display: "flex", gap: 6 },
  input: {
    flex: 1,
    background: "#111c30",
    color: "#e2e8f0",
    border: "1px solid #334155",
    borderRadius: 8,
    padding: "9px 12px",
    fontSize: 13,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  primaryBtn: {
    background: TEAL,
    color: "#04211d",
    border: "none",
    borderRadius: 8,
    padding: "9px 14px",
    fontWeight: 800,
    cursor: "pointer",
    fontSize: 13,
    whiteSpace: "nowrap",
  },
  approveBtn: {
    background: "#22c55e",
    color: "#04211d",
    border: "none",
    borderRadius: 7,
    padding: "6px 14px",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 12,
  },
  declineBtn: {
    background: "transparent",
    color: "#94a3b8",
    border: "1px solid #33415a",
    borderRadius: 7,
    padding: "6px 14px",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 12,
  },
  answer: {
    background: "#111c30",
    border: "1px solid #22304a",
    borderRadius: 10,
    padding: 12,
    fontSize: 13.5,
    lineHeight: 1.5,
    color: "#e2e8f0",
  },
  sectionLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "#64748b",
    fontWeight: 700,
    marginTop: 6,
  },
  empty: { fontSize: 12.5, color: "#64748b" },
  eventCard: { background: "#0d1526", border: "1px solid #1e293b", borderRadius: 10, padding: 10 },
  eventTitle: { fontSize: 13, fontWeight: 600, color: "#e2e8f0" },
  eventDetail: { fontSize: 12, color: "#cbd5e1", marginTop: 3, lineHeight: 1.4 },
  eventMeta: { fontSize: 11, color: "#64748b", marginTop: 4 },
  pill: {
    fontSize: 10.5,
    fontWeight: 700,
    border: "1px solid",
    borderRadius: 999,
    padding: "1px 8px",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    height: "fit-content",
  },
  toggleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "#0d1526",
    border: "1px solid #1e293b",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 13.5,
    color: "#e2e8f0",
    cursor: "pointer",
  },
  field: { display: "flex", flexDirection: "column", gap: 5 },
  fieldLabel: { fontSize: 12, color: "#94a3b8", fontWeight: 600 },
  error: {
    color: "#fca5a5",
    background: "#3f1d1d",
    fontSize: 12,
    padding: "8px 12px",
    borderRadius: 8,
  },
};
