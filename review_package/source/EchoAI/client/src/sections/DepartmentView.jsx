import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import Spinner from "../components/Spinner.jsx";
import DepartmentGoals from "../components/DepartmentGoals.jsx";
import { agentMeta, departmentTools } from "../lib/departments.js";

// Departments whose dashboards surface a goals panel (mirror backend
// DEPARTMENT_CATEGORIES keys that map to an agent id).
const GOAL_DEPARTMENTS = new Set(["atlas", "nova", "pulse"]);

// Department View — a single team member's landing page. Shows the member's
// header (avatar, name, title, live status, current task) pulled from
// /api/agents/:id, then a grid of clickable tool cards. Each card opens an
// EXISTING feature section (or triggers an App-level action) unchanged.

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

export default function DepartmentView({ agentId, selectedBrandId, onOpenTool, onAction, canOpenSection }) {
  const meta = agentMeta(agentId);
  const [agent, setAgent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.getAgentDetail(agentId);
      setAgent(res.agent || null);
    } catch (err) {
      setError(err.message || "Couldn't load this team member.");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  const color = (agent && agent.color) || (meta && meta.color) || "#14B8A6";
  const name = (agent && agent.name) || (meta && meta.name) || "Team member";
  const title = (agent && agent.title) || (meta && meta.title) || "";
  const tools = departmentTools(agentId).filter(
    (t) => t.action || !canOpenSection || canOpenSection(t.section),
  );

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner label={`Opening ${name}'s department…`} />
      </div>
    );
  }

  return (
    <div>
      {/* Department header */}
      <div
        className="mb-6 overflow-hidden rounded-2xl border border-gray-800 bg-gray-900/60 p-5"
        style={{ borderTop: `3px solid ${color}` }}
      >
        <div className="flex flex-wrap items-center gap-4">
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl font-extrabold text-black"
            style={{ backgroundColor: color }}
          >
            {name[0]}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-bold text-gray-100">{name}</h2>
              {agent && <StatusBadge status={agent.status} />}
            </div>
            <div className="text-sm text-gray-400">{title}</div>
          </div>
        </div>
        {agent && agent.currentTask && (
          <div className="mt-4 rounded-xl border border-gray-800 bg-gray-950/60 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Right now</div>
            <div className="mt-1 text-sm text-gray-100">{agent.currentTask}</div>
          </div>
        )}
        {error && (
          <div className="mt-4 text-xs text-amber-300">
            {error}{" "}
            <button onClick={load} className="font-semibold underline">Retry</button>
          </div>
        )}
      </div>

      {/* Department goals dashboard (atlas/nova/pulse) */}
      {GOAL_DEPARTMENTS.has(agentId) && selectedBrandId && (
        <DepartmentGoals
          brandId={selectedBrandId}
          department={agentId}
          title={`${name}'s Goals`}
          onManage={() => onOpenTool && onOpenTool({ section: "settings" })}
        />
      )}

      {/* Tool cards */}
      <div className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-300">
        {name}'s department
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tools.map((tool) => (
          <button
            key={tool.label}
            onClick={() => (tool.action ? onAction && onAction(tool.action) : onOpenTool && onOpenTool(tool))}
            className="group flex flex-col rounded-2xl border border-gray-800 bg-gray-900/60 p-5 text-left transition hover:border-gray-600"
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-gray-100">{tool.label}</span>
              <span className="text-gray-600 transition group-hover:translate-x-0.5" style={{ color }}>→</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-gray-400">{tool.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
