import { AGENTS_META } from "../lib/departments.js";

// Zorecho Core — the centerpiece of Mission Control V2, matching the approved
// concept: a glowing waveform core with curved, agent-colored connector lines
// running to each agent chip (4 left, up to 5 right), the ZORECHO CORE caption
// with a real status line, and the Talk to Echo button beneath.

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
      className={`group relative z-10 flex w-full items-center gap-2.5 rounded-xl border bg-[#060d1f]/95 px-3 py-2 text-left transition-colors hover:border-cyan-600/60 ${
        align === "right" ? "flex-row-reverse text-right" : ""
      }`}
      style={{ borderColor: `${color}44`, boxShadow: `0 0 18px ${color}14, inset 0 0 20px rgba(4,12,30,0.7)` }}
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold"
        style={{ backgroundColor: `${color}1f`, color, border: `1px solid ${color}55` }}
      >
        {agent.name ? agent.name[0] : "?"}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`flex items-center gap-1.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
          <span className="truncate text-[13px] font-semibold text-gray-100">{agent.name}</span>
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: s.color, boxShadow: `0 0 6px ${s.color}` }}
            title={s.label}
          />
        </span>
        <span className="block truncate text-[10px] text-gray-500">{agent.title}</span>
      </span>
    </button>
  );
}

// Curved connector lines from each chip row to the core, agent-colored with a
// soft glow — drawn in a stretched 100x100 viewBox behind the chips.
function Connectors({ left, right }) {
  const yFor = (count, i) => {
    if (count <= 1) return 50;
    return 10 + (i / (count - 1)) * 80;
  };
  const paths = [];
  left.forEach((a, i) => {
    const meta = AGENTS_META.find((m) => m.id === a.id) || {};
    const y = yFor(left.length, i);
    paths.push({ d: `M 26,${y} C 38,${y} 39,50 49,50`, color: meta.color || "#22d3ee", key: `l-${a.id}` });
  });
  right.forEach((a, i) => {
    const meta = AGENTS_META.find((m) => m.id === a.id) || {};
    const y = yFor(right.length, i);
    paths.push({ d: `M 74,${y} C 62,${y} 61,50 51,50`, color: meta.color || "#22d3ee", key: `r-${a.id}` });
  });
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {paths.map((p) => (
        <g key={p.key}>
          <path d={p.d} fill="none" stroke={p.color} strokeWidth="1.1" opacity="0.12" />
          <path d={p.d} fill="none" stroke={p.color} strokeWidth="0.35" opacity="0.75" />
        </g>
      ))}
    </svg>
  );
}

export default function CoreHero({ agents, onOpenDepartment, onTalkToEcho, statusLine, healthy = true }) {
  const roster = Array.isArray(agents) ? agents : [];
  const left = roster.filter((a) => ["echo", "scout", "atlas", "nova"].includes(a.id));
  const right = roster.filter((a) => !["echo", "scout", "atlas", "nova"].includes(a.id));

  return (
    <div className="relative overflow-hidden rounded-2xl border border-cyan-950/70 bg-gradient-to-b from-[#050b1d] to-[#03060f] p-4 sm:p-5">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(14,60,110,0.16), transparent 60%)" }}
        aria-hidden="true"
      />
      <div className="relative">
        <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-4">
          <Connectors left={left} right={right} />
          <div className="relative z-10 flex flex-col justify-center gap-2.5">
            {left.map((a) => (
              <AgentChip key={a.id} agent={a} align="left" onOpenDepartment={onOpenDepartment} />
            ))}
          </div>

          <div className="relative z-10 flex flex-col items-center px-1 sm:px-8">
            <div className="relative flex h-48 w-48 items-center justify-center sm:h-56 sm:w-56">
              <div className="mcv2-core-ring absolute inset-0 rounded-full border-2 border-cyan-500/40" style={{ boxShadow: "0 0 40px rgba(34,211,238,0.22), inset 0 0 30px rgba(34,211,238,0.08)" }} />
              <div className="mcv2-core-ring-slow absolute inset-3 rounded-full border border-cyan-400/25" />
              <div
                className="mcv2-core absolute inset-6 rounded-full"
                style={{
                  background:
                    "radial-gradient(circle at 50% 45%, rgba(34,211,238,0.4), rgba(14,116,144,0.2) 55%, rgba(3,10,25,0.95) 100%)",
                  boxShadow: "0 0 80px rgba(34,211,238,0.3), inset 0 0 50px rgba(34,211,238,0.18)",
                }}
              />
              <div className="relative flex items-end gap-1" aria-hidden="true">
                {[10, 20, 32, 44, 34, 50, 34, 44, 32, 20, 10].map((h, i) => (
                  <span
                    key={i}
                    className="mcv2-core-bar w-1.5 rounded-full"
                    style={{
                      height: `${h}px`,
                      animationDelay: `${i * 0.14}s`,
                      background: "linear-gradient(to top, #0891b2, #67e8f9)",
                      boxShadow: "0 0 10px rgba(103,232,249,0.5)",
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="mt-3 text-center">
              <div className="text-[15px] font-bold tracking-[0.3em] text-gray-100">ZORECHO CORE</div>
              <div className="mt-1 flex items-center justify-center gap-1.5 text-[11px] text-gray-400">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{
                    backgroundColor: healthy ? "#34d399" : "#f59e0b",
                    boxShadow: `0 0 6px ${healthy ? "#34d399" : "#f59e0b"}`,
                  }}
                />
                {statusLine}
              </div>
            </div>
          </div>

          <div className="relative z-10 flex flex-col justify-center gap-2.5">
            {right.map((a) => (
              <AgentChip key={a.id} agent={a} align="right" onOpenDepartment={onOpenDepartment} />
            ))}
          </div>
        </div>

        <div className="mt-4 flex justify-center">
          <button
            onClick={onTalkToEcho}
            className="flex items-center gap-3 rounded-2xl border border-cyan-400/60 bg-cyan-500/10 px-7 py-3 text-sm font-semibold text-cyan-50 transition-colors hover:bg-cyan-500/20"
            style={{ boxShadow: "0 0 30px rgba(34,211,238,0.18), inset 0 0 20px rgba(34,211,238,0.06)" }}
            data-testid="talk-to-echo"
          >
            <svg className="h-5 w-5 text-cyan-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
            <span className="text-left">
              Talk to Echo
              <span className="block text-[10px] font-normal text-cyan-300/70">Click to speak with your AI</span>
            </span>
            <span className="ml-1 flex items-end gap-0.5" aria-hidden="true">
              {[6, 10, 14, 10, 6].map((h, i) => (
                <span key={i} className="w-0.5 rounded-full bg-cyan-400/80" style={{ height: `${h}px` }} />
              ))}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
