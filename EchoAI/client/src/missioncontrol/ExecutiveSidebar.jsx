import { AGENTS_META } from "../lib/departments.js";

// Mission Control V2 — left "AI EXECUTIVE TEAM" sidebar, matching the approved
// concept: one card per agent with monogram, name, role and the agent's REAL
// current activity line (currentTask from the live roster), a View All Agents
// link, and the Zorecho brand card at the bottom.

const STATUS_COLOR = {
  active: "#22c55e",
  working: "#f59e0b",
  attention: "#ef4444",
};

export default function ExecutiveSidebar({ agents, onOpenDepartment, onNavigate }) {
  const roster = Array.isArray(agents) ? agents : [];
  return (
    <aside className="flex w-[218px] shrink-0 flex-col border-r border-cyan-950/60 bg-[#04070f]">
      <div className="px-3 pb-2 pt-4 text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-400">
        AI Executive Team
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2.5 pb-2">
        {roster.map((a) => {
          const meta = AGENTS_META.find((m) => m.id === a.id) || {};
          const color = meta.color || "#14B8A6";
          return (
            <button
              key={a.id}
              onClick={() => onOpenDepartment && onOpenDepartment(a.id)}
              className="group flex w-full items-start gap-2.5 rounded-xl border border-cyan-950/70 bg-[#070d1c]/90 px-2.5 py-2 text-left transition-colors hover:border-cyan-700/50"
            >
              <span
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold"
                style={{ backgroundColor: `${color}1f`, color, border: `1px solid ${color}55` }}
              >
                {a.name ? a.name[0] : "?"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[12.5px] font-semibold text-gray-100">{a.name}</span>
                  <span
                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: STATUS_COLOR[a.status] || "#f59e0b",
                      boxShadow: `0 0 6px ${STATUS_COLOR[a.status] || "#f59e0b"}`,
                    }}
                  />
                </span>
                <span className="block truncate text-[10px] text-gray-500">{a.title}</span>
                {a.currentTask && (
                  <span className="mt-0.5 block truncate text-[10px] italic text-gray-600 group-hover:text-gray-500">
                    {a.currentTask}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        <button
          onClick={() => onNavigate && onNavigate("aiteam")}
          className="mt-1 w-full rounded-xl border border-cyan-950/70 bg-[#070d1c]/60 px-3 py-2 text-center text-[11px] font-semibold text-cyan-300 transition-colors hover:border-cyan-700/50 hover:text-cyan-200"
        >
          View All Agents →
        </button>
      </div>
      <div className="border-t border-cyan-950/60 px-3 py-3.5">
        <div className="relative overflow-hidden rounded-xl border border-cyan-950/70 bg-gradient-to-b from-[#071026] to-[#04070f] px-3 py-3">
          <div
            className="pointer-events-none absolute -bottom-8 -right-8 h-24 w-24 rounded-full"
            style={{ background: "radial-gradient(circle, rgba(34,211,238,0.18), transparent 70%)" }}
            aria-hidden="true"
          />
          <div className="text-sm font-extrabold tracking-[0.18em] text-gray-100">ZORECHO</div>
          <div className="mt-1 text-[10px] leading-snug text-gray-500">
            Your AI Company
            <br />
            Never Stops.
          </div>
        </div>
      </div>
    </aside>
  );
}
