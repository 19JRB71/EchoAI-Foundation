import { AGENTS_META } from "../lib/departments.js";
import { useEchoConversation } from "../voice/EchoConversationContext.jsx";
import { useVoice } from "../voice/VoiceContext.jsx";

// Zorecho Core — the centerpiece of Mission Control V2, matching the approved
// concept: a glowing waveform core with curved, agent-colored connector lines
// running to each agent chip (4 left, up to 5 right), the ZORECHO CORE caption
// with a real status line, and the Echo mute/unmute button beneath.

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
    paths.push({ d: `M 26,${y} C 35,${y} 40,50 49,50`, color: meta.color || "#22d3ee", key: `l-${a.id}` });
  });
  right.forEach((a, i) => {
    const meta = AGENTS_META.find((m) => m.id === a.id) || {};
    const y = yFor(right.length, i);
    paths.push({ d: `M 74,${y} C 65,${y} 60,50 51,50`, color: meta.color || "#22d3ee", key: `r-${a.id}` });
  });
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {paths.map((p, idx) => (
        <g key={p.key}>
          <path d={p.d} fill="none" stroke={p.color} strokeWidth="1.1" opacity="0.12" />
          <path d={p.d} fill="none" stroke={p.color} strokeWidth="0.35" opacity="0.75" className="mcv2-line" />
          {/* Traveling light pulse — a subtle spark flowing along the line
              toward the core, staggered per line so they never sync up. */}
          <circle r="0.85" fill={p.color} opacity="0" className="mcv2-line-pulse">
            <animateMotion
              dur={`${3.8 + (idx % 3) * 0.6}s`}
              begin={`${idx * 0.65}s`}
              repeatCount="indefinite"
              path={p.d}
            />
            <animate
              attributeName="opacity"
              values="0;0.85;0.85;0"
              keyTimes="0;0.15;0.85;1"
              dur={`${3.8 + (idx % 3) * 0.6}s`}
              begin={`${idx * 0.65}s`}
              repeatCount="indefinite"
            />
          </circle>
        </g>
      ))}
    </svg>
  );
}

// Map the real voice-engine state onto the Core's visual state. Echo talks
// through two real paths — the hands-free conversation engine (convState) and
// the voice queue (voice.playing, e.g. briefings and alerts) — the core must
// pulse for BOTH. No engine at all → calm idle breathing.
function coreStateOf(conv, voice) {
  if (conv?.convState === "speaking") return "speaking";
  if (voice?.playing && !voice?.muted) return "speaking";
  if (conv?.convState === "processing") return "thinking";
  if (conv?.convState === "active") return "listening";
  return "idle";
}

export default function CoreHero({ agents, onOpenDepartment, statusLine, healthy = true }) {
  const roster = Array.isArray(agents) ? agents : [];
  const left = roster.filter((a) => ["echo", "scout", "atlas", "nova"].includes(a.id));
  const right = roster.filter((a) => !["echo", "scout", "atlas", "nova"].includes(a.id));
  const conv = useEchoConversation();
  const voice = useVoice();
  const coreState = coreStateOf(conv, voice);

  // The button under the Core is a single mute/unmute toggle: muting cuts any
  // speech that is playing (voice.toggleMute → stopAll) AND stops the
  // hands-free mic (conv.toggleMic); unmuting restores both. Speaker mute is
  // the source of truth for the muted look — if Echo won't talk, he's muted.
  const echoMuted = voice ? Boolean(voice.muted) : Boolean(conv?.muted);
  function toggleEchoMuted() {
    if (echoMuted) {
      if (voice?.muted) voice.toggleMute();
      // Resume listening only for owners who already opted into hands-free —
      // never surface the permission prompt from a simple unmute.
      if (conv?.supported && conv?.micEnabled && conv?.muted) conv.toggleMic();
    } else {
      if (voice && !voice.muted) voice.toggleMute(); // also stops live audio
      if (conv?.supported && conv?.micEnabled && !conv?.muted) conv.toggleMic();
    }
  }

  return (
    <div className={`mcv2-hero mcv2-${coreState} relative overflow-hidden rounded-2xl border border-cyan-950/70 bg-gradient-to-b from-[#050b1d] to-[#03060f] p-4 sm:p-6`}>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(14,60,110,0.22), transparent 62%)" }}
        aria-hidden="true"
      />
      <div className="relative">
        <div className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-4">
          <Connectors left={left} right={right} />
          <div className="relative z-10 flex flex-col justify-center gap-2.5">
            {left.map((a) => (
              <AgentChip key={a.id} agent={a} align="left" onOpenDepartment={onOpenDepartment} />
            ))}
          </div>

          <div className="relative z-10 flex flex-col items-center px-1 sm:px-3 xl:px-8">
            <div className="relative flex h-[18.5rem] w-[18.5rem] items-center justify-center sm:h-[23rem] sm:w-[23rem]">
              <div className="mcv2-core-ring absolute inset-0 rounded-full border-2 border-cyan-500/40" style={{ boxShadow: "0 0 70px rgba(34,211,238,0.32), inset 0 0 45px rgba(34,211,238,0.1)" }} />
              <div className="mcv2-core-ring-slow absolute inset-4 rounded-full border border-cyan-400/25" />
              {/* Thinking state — subtle orbiting particles around the core */}
              {coreState === "thinking" && (
                <div className="mcv2-orbit pointer-events-none absolute inset-2" aria-hidden="true">
                  {[0, 120, 240].map((deg) => (
                    <span
                      key={deg}
                      className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-cyan-300"
                      style={{
                        transform: `rotate(${deg}deg) translateX(calc(50% + 8.4rem))`,
                        boxShadow: "0 0 8px rgba(103,232,249,0.9)",
                      }}
                    />
                  ))}
                </div>
              )}
              {/* Speaking state — a subtle light pulse emitted from the center */}
              {coreState === "speaking" && (
                <div
                  className="mcv2-core-emit pointer-events-none absolute inset-10 rounded-full border border-cyan-300/50"
                  aria-hidden="true"
                />
              )}
              <div
                className="mcv2-core absolute inset-8 rounded-full"
                style={{
                  background:
                    "radial-gradient(circle at 50% 45%, rgba(34,211,238,0.4), rgba(14,116,144,0.2) 55%, rgba(3,10,25,0.95) 100%)",
                  boxShadow: "0 0 100px rgba(34,211,238,0.32), inset 0 0 60px rgba(34,211,238,0.18)",
                }}
              />
              <div className="relative flex items-end gap-1" aria-hidden="true">
                {[12, 24, 40, 55, 42, 62, 42, 55, 40, 24, 12].map((h, i) => (
                  <span
                    key={i}
                    className="mcv2-core-bar w-2 rounded-full"
                    style={{
                      height: `${h}px`,
                      animationDelay: `${i * 0.14}s`,
                      background: "linear-gradient(to top, #0891b2, #67e8f9)",
                      boxShadow: "0 0 12px rgba(103,232,249,0.55)",
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="mt-4 text-center">
              <div className="text-[18px] font-bold tracking-[0.32em] text-gray-100" style={{ textShadow: "0 0 26px rgba(34,211,238,0.4)" }}>ZORECHO CORE</div>
              <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-cyan-400/90">
                {coreState === "speaking"
                  ? "Echo Speaking"
                  : coreState === "thinking"
                    ? "Echo Thinking"
                    : coreState === "listening"
                      ? "Echo Listening"
                      : "AI Workforce Operational"}
              </div>
              <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] text-gray-400">
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

        <div className="mt-9 flex justify-center">
          <button
            onClick={toggleEchoMuted}
            title={echoMuted ? "Unmute Echo" : "Mute Echo (stops talking and listening)"}
            aria-label={echoMuted ? "Unmute Echo" : "Mute Echo"}
            aria-pressed={echoMuted}
            className={`flex items-center gap-3 rounded-2xl border px-7 py-3 text-sm font-semibold transition-colors ${
              echoMuted
                ? "border-gray-600/60 bg-gray-500/10 text-gray-300 hover:bg-gray-500/20"
                : "border-cyan-400/60 bg-cyan-500/10 text-cyan-50 hover:bg-cyan-500/20"
            }`}
            style={
              echoMuted
                ? undefined
                : { boxShadow: "0 0 30px rgba(34,211,238,0.18), inset 0 0 20px rgba(34,211,238,0.06)" }
            }
            data-testid="talk-to-echo"
          >
            <svg
              className={`h-5 w-5 ${echoMuted ? "text-gray-400" : "text-cyan-300"}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              {echoMuted && (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4l16 16" data-testid="core-echo-mic-slash" />
              )}
            </svg>
            <span className="text-left">
              {echoMuted ? "Echo Muted" : "Mute Echo"}
              <span className={`block text-[10px] font-normal ${echoMuted ? "text-gray-400/80" : "text-cyan-300/70"}`}>
                {echoMuted ? "Click to unmute — Echo will talk and listen again" : "Click to mute — stops talking and listening"}
              </span>
            </span>
            {!echoMuted && (
              <span className="ml-1 flex items-end gap-0.5" aria-hidden="true">
                {[6, 10, 14, 10, 6].map((h, i) => (
                  <span key={i} className="w-0.5 rounded-full bg-cyan-400/80" style={{ height: `${h}px` }} />
                ))}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
