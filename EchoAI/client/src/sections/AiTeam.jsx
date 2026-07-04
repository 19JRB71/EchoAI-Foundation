import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import Spinner from "../components/Spinner.jsx";
import FacebookWizard from "../components/FacebookWizard.jsx";

// AI Marketing Team — the eight named AI team members as cards. Each card shows a
// live status, what they're working on right now, and this week's results (all
// real activity from /api/agents). Clicking a card opens a detail modal with the
// member's recent activity log; "Open workspace" jumps to the underlying tool.

const STATUS = {
  active: { label: "Active", color: "#22c55e" },
  working: { label: "Working", color: "#f59e0b" },
  attention: { label: "Needs you", color: "#ef4444" },
};

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.working;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ color: s.color, backgroundColor: `${s.color}18`, border: `1px solid ${s.color}44` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
      {s.label}
    </span>
  );
}

function Avatar({ agent, size = 44 }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-extrabold text-black"
      style={{ backgroundColor: agent.color, width: size, height: size, fontSize: size * 0.4 }}
    >
      {agent.name[0]}
    </span>
  );
}

function when(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function AgentDetailModal({ agentId, onClose, onNavigate, onConnectFacebook, canOpenSection }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const res = await api.getAgentDetail(agentId);
        if (active) setData(res);
      } catch (err) {
        if (active) setError(err.message || "Couldn't load details.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [agentId]);

  const agent = data && data.agent;
  const activity = (data && data.activity) || [];
  const needsFacebook = agent && agent.id === "atlas" && agent.status === "attention";

  return (
    <div className="fixed inset-0 z-[1050] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-700 bg-gray-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner label="Loading…" />
          </div>
        ) : error ? (
          <div className="text-sm text-red-300">{error}</div>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <Avatar agent={agent} size={52} />
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-gray-100">{agent.name}</h3>
                    <StatusBadge status={agent.status} />
                  </div>
                  <div className="text-sm text-gray-400">{agent.title}</div>
                </div>
              </div>
              <button onClick={onClose} className="text-gray-500 hover:text-gray-300" aria-label="Close">
                ✕
              </button>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-gray-300">{agent.blurb}</p>

            <div className="mt-4 rounded-xl border border-gray-800 bg-gray-900/60 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Right now</div>
              <div className="mt-1 text-sm text-gray-100">{agent.currentTask}</div>
            </div>

            {/* Weekly results */}
            {Array.isArray(agent.weekly) && agent.weekly.length > 0 && (
              <div className="mt-4 grid grid-cols-3 gap-2">
                {agent.weekly.map((w) => (
                  <div key={w.label} className="rounded-xl border border-gray-800 bg-gray-900/60 p-3 text-center">
                    <div className="text-lg font-extrabold" style={{ color: agent.color }}>
                      {w.value}
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-400">{w.label}</div>
                  </div>
                ))}
              </div>
            )}

            {needsFacebook && (
              <button
                onClick={onConnectFacebook}
                className="mt-4 w-full rounded-lg py-2.5 text-sm font-bold text-white"
                style={{ backgroundColor: "#1877f2" }}
              >
                Connect Facebook so Atlas can run ads
              </button>
            )}

            {/* Activity log */}
            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Recent activity</div>
              {activity.length === 0 ? (
                <p className="text-sm text-gray-500">No activity yet — results will appear here as {agent.name} works.</p>
              ) : (
                <ul className="space-y-2">
                  {activity.map((a, i) => (
                    <li key={i} className="rounded-lg border border-gray-800 bg-gray-900/40 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-gray-200">{a.title}</span>
                        <span className="shrink-0 text-[11px] text-gray-500">{when(a.ts)}</span>
                      </div>
                      {a.meta ? <div className="mt-0.5 truncate text-xs text-gray-400">{a.meta}</div> : null}
                      {a.detail ? <div className="mt-1 line-clamp-2 text-xs text-gray-500">{a.detail}</div> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {!canOpenSection || canOpenSection(agent.section) ? (
              <button
                onClick={() => onNavigate && onNavigate(agent.section)}
                className="mt-5 w-full rounded-lg border border-gray-700 py-2.5 text-sm font-semibold text-teal-300 hover:bg-gray-800"
              >
                Open {agent.name}'s workspace →
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export default function AiTeam({ onNavigate, canOpenSection }) {
  const [agents, setAgents] = useState([]);
  const [brandName, setBrandName] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
  const [showFbWizard, setShowFbWizard] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.getAgents();
      setAgents(res.agents || []);
      setBrandName(res.brandName || null);
    } catch (err) {
      setError(err.message || "Couldn't load your team.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner label="Gathering your team…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-6 text-sm text-red-300">
        {error}
        <button onClick={load} className="ml-3 font-semibold text-red-200 underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-100">Your AI Marketing Team</h2>
        <p className="mt-1 text-sm text-gray-400">
          {brandName ? `${brandName} · ` : ""}Eight specialists working around the clock. Click any team member to see what they're doing.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => (
          <div
            key={a.id}
            className="flex flex-col rounded-2xl border border-gray-800 bg-gray-900/60 p-5 transition hover:border-gray-600"
            style={{ borderTop: `3px solid ${a.color}` }}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <Avatar agent={a} />
                <div>
                  <div className="font-bold text-gray-100">{a.name}</div>
                  <div className="text-xs text-gray-400">{a.title}</div>
                </div>
              </div>
              <StatusBadge status={a.status} />
            </div>

            <p className="mt-3 text-sm leading-relaxed text-gray-400">{a.blurb}</p>

            <div className="mt-3 rounded-lg bg-gray-950/60 p-2.5 text-xs text-gray-300">
              <span className="text-gray-500">Now: </span>
              {a.currentTask}
            </div>

            {Array.isArray(a.weekly) && a.weekly.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {a.weekly.map((w) => (
                  <span key={w.label} className="rounded-full bg-gray-800 px-2 py-0.5 text-[11px] text-gray-300">
                    {w.label}: <span className="font-semibold text-gray-100">{w.value}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="mt-4 flex gap-2 pt-1">
              <button
                onClick={() => setOpenId(a.id)}
                className="flex-1 rounded-lg border border-gray-700 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-800"
              >
                Details
              </button>
              {!canOpenSection || canOpenSection(a.section) ? (
                <button
                  onClick={() => onNavigate && onNavigate(a.section)}
                  className="flex-1 rounded-lg py-2 text-xs font-bold text-black"
                  style={{ backgroundColor: a.color }}
                >
                  Open
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {openId && (
        <AgentDetailModal
          agentId={openId}
          onClose={() => setOpenId(null)}
          onNavigate={onNavigate}
          canOpenSection={canOpenSection}
          onConnectFacebook={() => {
            setOpenId(null);
            setShowFbWizard(true);
          }}
        />
      )}

      {showFbWizard && <FacebookWizard onClose={() => setShowFbWizard(false)} />}
    </div>
  );
}
