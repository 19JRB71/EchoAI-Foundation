import { AGENTS_META } from "../lib/departments.js";

// Zorecho Core — the centerpiece of Mission Control V2. Chassis version: a
// calm, always-alive pulsing core with the agent roster arranged around it and
// the Talk to Echo button beneath (replaces the old voice panel per approved
// decision #9). The cinematic FX pass is a later, separately-approved stage.

const STATUS = {
  active: { label: "Active", color: "#22c55e" },
  working: { label: "Working", color: "#f59e0b" },
  attention: { label: "Needs you", color: "#ef4444" },
};

function AgentChip({ agent, align, onOpenDepartment }) {
  const meta = AGENTS_META.find((m) => m.id === agent.id) || {};
  const color = meta.color || agent.color || "#14B8A6";
  const s = STATUS[agent.status] || STATUS.working;
  return (
    <button
      onClick={() => onOpenDepartment && onOpenDepartment(agent.id)}
      className={`group flex w-full items-center gap-3 rounded-xl border border-cyan-950/80 bg-[#060d1f]/90 px-3 py-2.5 text-left transition-colors hover:border-cyan-700/60 ${
        align === "right" ? "flex-row-reverse text-right" : ""
      }`}
      style={{ boxShadow: `inset 0 0 24px rgba(6,20,45,0.6)` }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
        style={{ backgroundColor: `${color}1f`, color, border: `1px solid ${color}55` }}
      >
        {agent.name ? agent.name[0] : "?"}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`flex items-center gap-1.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
          <span className="truncate text-sm font-semibold text-gray-100">{agent.name}</span>
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: s.color, boxShadow: `0 0 6px ${s.color}` }}
            title={s.label}
          />
        </span>
        <span className="block truncate text-[11px] text-gray-500">{agent.title}</span>
      </span>
    </button>
  );
}

export default function CoreHero({ agents, onOpenDepartment, onTalkToEcho, statusLine }) {
  const roster = Array.isArray(agents) ? agents : [];
  const left = roster.filter((a) => ["echo", "scout", "atlas", "nova"].includes(a.id));
  const right = roster.filter((a) => !["echo", "scout", "atlas", "nova"].includes(a.id));

  return (
    <div className="relative overflow-hidden rounded-2xl border border-cyan-950/70 bg-gradient-to-b from-[#050b1d] to-[#03060f] p-5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div className="flex flex-col gap-2.5">
          {left.map((a) => (
            <AgentChip key={a.id} agent={a} align="left" onOpenDepartment={onOpenDepartment} />
          ))}
        </div>

        <div className="flex flex-col items-center px-2 py-4 sm:px-6">
          <div className="relative flex h-44 w-44 items-center justify-center sm:h-52 sm:w-52">
            <div className="mcv2-core-ring absolute inset-0 rounded-full border border-cyan-500/30" />
            <div className="mcv2-core-ring-slow absolute inset-3 rounded-full border border-cyan-400/20" />
            <div
              className="mcv2-core absolute inset-7 rounded-full"
              style={{
                background:
                  "radial-gradient(circle at 50% 45%, rgba(34,211,238,0.35), rgba(14,116,144,0.18) 55%, rgba(3,10,25,0.9) 100%)",
                boxShadow: "0 0 60px rgba(34,211,238,0.25), inset 0 0 40px rgba(34,211,238,0.15)",
              }}
            />
            <div className="relative flex items-end gap-1" aria-hidden="true">
              {[14, 26, 40, 30, 46, 30, 40, 26, 14].map((h, i) => (
                <span
                  key={i}
                  className="mcv2-core-bar w-1.5 rounded-full bg-cyan-300"
                  style={{ height: `${h}px`, animationDelay: `${i * 0.18}s` }}
                />
              ))}
            </div>
          </div>
          <div className="mt-3 text-center">
            <div className="text-sm font-bold tracking-[0.25em] text-cyan-200">ZORECHO CORE</div>
            <div className="mt-1 flex items-center justify-center gap-1.5 text-[11px] text-gray-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" style={{ boxShadow: "0 0 6px #34d399" }} />
              {statusLine}
            </div>
          </div>
          <button
            onClick={onTalkToEcho}
            className="mt-4 flex items-center gap-2.5 rounded-xl border border-cyan-500/50 bg-cyan-500/10 px-5 py-2.5 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/20"
            style={{ boxShadow: "0 0 24px rgba(34,211,238,0.12)" }}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
            <span>
              Talk to Echo
              <span className="block text-[10px] font-normal text-cyan-300/70">Click to speak with your AI</span>
            </span>
          </button>
        </div>

        <div className="flex flex-col gap-2.5">
          {right.map((a) => (
            <AgentChip key={a.id} agent={a} align="right" onOpenDepartment={onOpenDepartment} />
          ))}
        </div>
      </div>
    </div>
  );
}
