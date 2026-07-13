import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ZorechoCore from "../components/ui/ZorechoCore.jsx";
import { AGENTS_META } from "../lib/departments.js";
import { DEMO_STEPS, stepDurationMs } from "./heroDemoScript.js";

// Zorecho landing hero — "Meet Your AI Company." with an interactive Echo
// demo on the right. Reuses the SAME ZorechoCore component as Mission Control
// (no visual fork). Nothing autoplays: the demo starts only on click, using
// pre-generated static audio files (see heroDemoScript.js).

const LEFT_AGENTS = ["echo", "scout", "atlas", "nova"];
const RIGHT_AGENTS = ["pulse", "voice", "forge", "sentinel", "sage"];

function agentMeta(id) {
  return AGENTS_META.find((a) => a.id === id) || null;
}

function MiniChip({ id, lit, active, align }) {
  const meta = agentMeta(id);
  if (!meta) return null;
  const color = meta.color;
  return (
    <div
      className={`relative z-10 flex w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-all duration-500 ${
        align === "right" ? "flex-row-reverse text-right" : ""
      }`}
      style={{
        borderColor: lit ? `${color}66` : "rgba(148,163,184,0.15)",
        backgroundColor: "rgba(6,13,31,0.92)",
        boxShadow: active
          ? `0 0 22px ${color}55`
          : lit
            ? `0 0 14px ${color}22`
            : "none",
        opacity: lit ? 1 : 0.45,
      }}
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold transition-colors duration-500"
        style={{
          backgroundColor: lit ? `${color}22` : "rgba(148,163,184,0.08)",
          color: lit ? color : "#64748b",
          border: `1px solid ${lit ? `${color}55` : "rgba(148,163,184,0.15)"}`,
        }}
      >
        {meta.name[0]}
      </span>
      <span className="min-w-0">
        <span
          className="block truncate text-[11px] font-semibold transition-colors duration-500"
          style={{ color: lit ? "#e2e8f0" : "#64748b" }}
        >
          {meta.name}
        </span>
        <span className="hidden truncate text-[9px] text-slate-500 lg:block">
          {meta.title}
        </span>
      </span>
    </div>
  );
}

// SMIL <animateMotion> is not covered by the .z-anim reduced-motion CSS rule,
// so the traveling spark must be gated in JS: reduced-motion users get a
// static brightened line instead of a moving particle.
function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Curved agent-colored connector lines to the Core — same visual language as
// Mission Control's CoreHero. Lines stay faint until their agent is lit; the
// currently-active agent's line carries a single traveling spark.
function Connectors({ litAgents, activeAgent }) {
  const reduceMotion = prefersReducedMotion();
  const yFor = (count, i) => (count <= 1 ? 50 : 10 + (i / (count - 1)) * 80);
  const paths = [];
  LEFT_AGENTS.forEach((id, i) => {
    const meta = agentMeta(id);
    paths.push({
      d: `M 24,${yFor(LEFT_AGENTS.length, i)} C 35,${yFor(LEFT_AGENTS.length, i)} 40,50 49,50`,
      color: meta ? meta.color : "#22d3ee",
      id,
    });
  });
  RIGHT_AGENTS.forEach((id, i) => {
    const meta = agentMeta(id);
    paths.push({
      d: `M 76,${yFor(RIGHT_AGENTS.length, i)} C 65,${yFor(RIGHT_AGENTS.length, i)} 60,50 51,50`,
      color: meta ? meta.color : "#22d3ee",
      id,
    });
  });
  return (
    <svg
      className="pointer-events-none absolute inset-0 hidden h-full w-full sm:block"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {paths.map((p) => {
        const lit = litAgents.has(p.id);
        const active = activeAgent === p.id;
        return (
          <g key={p.id}>
            <path
              d={p.d}
              fill="none"
              stroke={p.color}
              strokeWidth="1.1"
              opacity={lit ? 0.18 : 0.06}
              style={{ transition: "opacity 0.6s" }}
            />
            <path
              d={p.d}
              fill="none"
              stroke={p.color}
              strokeWidth="0.35"
              opacity={lit ? 0.8 : 0.2}
              style={{ transition: "opacity 0.6s" }}
            />
            {active && !reduceMotion && (
              <circle r="0.9" fill={p.color} className="z-anim">
                <animateMotion dur="1.6s" repeatCount="indefinite" path={p.d} />
              </circle>
            )}
            {active && reduceMotion && (
              <path d={p.d} fill="none" stroke={p.color} strokeWidth="0.6" opacity="0.95" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function ReportCard({ card }) {
  const meta = agentMeta(card.agentId);
  const color = meta ? meta.color : "#14B8A6";
  return (
    <div
      className="z-anim flex items-center gap-2.5 rounded-xl border bg-[#060d1f]/95 px-3 py-2"
      style={{
        borderColor: `${color}44`,
        boxShadow: `0 0 16px ${color}18`,
        animation: "hero-card-in 0.5s ease-out both",
      }}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold"
        style={{ backgroundColor: `${color}1f`, color, border: `1px solid ${color}55` }}
      >
        {meta ? meta.name[0] : "?"}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold leading-tight text-white">
          {card.value}
        </span>
        <span className="block text-[10px] leading-tight text-slate-400">
          {card.label}
        </span>
      </span>
    </div>
  );
}

function ControlButton({ onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-cyan-500/40 hover:text-white"
    >
      {children}
    </button>
  );
}

export default function HeroDemo() {
  // idle → playing ⇄ paused → done (skip/finish); replay returns to playing.
  const [status, setStatus] = useState("idle");
  const [stepIdx, setStepIdx] = useState(-1);
  const [muted, setMuted] = useState(false);
  const [litAgents, setLitAgents] = useState(() => new Set());
  const [cards, setCards] = useState([]);
  const [pulse, setPulse] = useState(null);

  const audioRef = useRef(null);
  const timerRef = useRef(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopAudio = () => {
    const a = audioRef.current;
    if (a) {
      a.onended = null;
      a.onerror = null;
      a.pause();
    }
  };

  const advance = useCallback((from) => {
    clearTimer();
    const next = from + 1;
    if (next >= DEMO_STEPS.length) {
      setStatus("done");
      setStepIdx(DEMO_STEPS.length - 1);
      return;
    }
    playStep(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const playStep = useCallback(
    (idx) => {
      clearTimer();
      const step = DEMO_STEPS[idx];
      setStepIdx(idx);
      setStatus("playing");
      if (step.agentId) {
        setLitAgents((prev) => {
          const next = new Set(prev);
          next.add(step.agentId);
          return next;
        });
        const meta = agentMeta(step.agentId);
        setPulse({ color: meta ? meta.color : "#14B8A6", key: `${idx}-${Date.now()}` });
      }
      if (step.card) {
        setCards((prev) =>
          prev.some((c) => c.label === step.card.label && c.agentId === step.card.agentId)
            ? prev
            : [...prev, step.card],
        );
      }

      const fallback = () => {
        clearTimer();
        timerRef.current = setTimeout(() => {
          if (statusRef.current === "playing") advance(idx);
        }, stepDurationMs(step));
      };

      let a = audioRef.current;
      if (!a) {
        a = new Audio();
        a.preload = "auto";
        audioRef.current = a;
      }
      a.onended = null;
      a.onerror = null;
      a.pause();
      a.src = step.audio;
      a.muted = mutedRef.current;
      a.onended = () => {
        if (statusRef.current === "playing") advance(idx);
      };
      a.onerror = fallback;
      const p = a.play();
      if (p && typeof p.catch === "function") p.catch(fallback);
    },
    [advance],
  );

  const start = useCallback(() => {
    setLitAgents(new Set());
    setCards([]);
    setPulse(null);
    playStep(0);
  }, [playStep]);

  const pause = () => {
    clearTimer();
    const a = audioRef.current;
    if (a) a.pause();
    setStatus("paused");
  };

  const resume = () => {
    if (stepIdx < 0) {
      start();
      return;
    }
    setStatus("playing");
    const a = audioRef.current;
    const step = DEMO_STEPS[stepIdx];
    if (a && a.src && !a.error) {
      a.onended = () => {
        if (statusRef.current === "playing") advance(stepIdx);
      };
      const p = a.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          timerRef.current = setTimeout(() => {
            if (statusRef.current === "playing") advance(stepIdx);
          }, stepDurationMs(step));
        });
      }
    } else {
      timerRef.current = setTimeout(() => {
        if (statusRef.current === "playing") advance(stepIdx);
      }, stepDurationMs(step));
    }
  };

  const skip = () => {
    clearTimer();
    stopAudio();
    setLitAgents(new Set(AGENTS_META.map((a) => a.id)));
    setCards(DEMO_STEPS.filter((s) => s.card).map((s) => s.card));
    setStepIdx(DEMO_STEPS.length - 1);
    setStatus("done");
  };

  const replay = () => {
    clearTimer();
    stopAudio();
    start();
  };

  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      if (audioRef.current) audioRef.current.muted = next;
      return next;
    });
  };

  // Cleanup on unmount: stop audio + timers so nothing keeps speaking.
  useEffect(() => {
    return () => {
      clearTimer();
      const a = audioRef.current;
      if (a) {
        a.onended = null;
        a.onerror = null;
        a.pause();
        a.src = "";
      }
    };
  }, []);

  const step = stepIdx >= 0 ? DEMO_STEPS[stepIdx] : null;
  const playing = status === "playing";
  const done = status === "done";
  const started = status !== "idle";
  const activeAgent = playing && step ? step.agentId : null;
  const coreState = playing ? "speaking" : "idle";

  return (
    <section className="relative overflow-hidden">
      <style>{`
        @keyframes hero-card-in {
          from { opacity: 0; transform: translateY(8px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <div className="pointer-events-none absolute -top-40 left-1/4 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-teal-500/15 blur-3xl" />
      <div className="pointer-events-none absolute top-24 right-0 h-72 w-72 rounded-full bg-blue-600/15 blur-3xl" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 pt-16 pb-16 sm:pt-24 lg:grid-cols-2 lg:gap-8">
        {/* ————— Left: copy + CTAs ————— */}
        <div className="text-center lg:text-left">
          <span className="inline-block rounded-full border border-teal-400/30 bg-teal-400/10 px-4 py-1.5 text-sm font-medium text-teal-300">
            One connected AI workforce
          </span>
          <h1 className="mt-6 text-4xl font-black leading-tight tracking-tight sm:text-6xl">
            Meet Your{" "}
            <span className="bg-gradient-to-r from-teal-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent">
              AI Company.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-slate-300 sm:text-xl lg:mx-0">
            Zorecho brings your marketing, sales, customer calls, follow-up,
            research, and business intelligence together in one connected AI
            workforce.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center lg:justify-start">
            <Link
              to="/dashboard"
              className="inline-block rounded-xl bg-gradient-to-r from-teal-400 to-cyan-500 px-8 py-4 text-lg font-bold text-black shadow-lg shadow-teal-500/25 transition hover:brightness-110"
            >
              Start Your AI Company
            </Link>
            <button
              type="button"
              onClick={() => (started ? replay() : start())}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-8 py-4 text-lg font-semibold text-white transition hover:border-cyan-400/50 hover:bg-white/10"
            >
              <span aria-hidden="true">▶</span> Watch Echo Work
            </button>
          </div>
        </div>

        {/* ————— Right: interactive Core demo ————— */}
        <div className="relative overflow-hidden rounded-2xl border border-cyan-950/70 bg-gradient-to-b from-[#050b1d] to-[#03060f] p-4 sm:p-6">
          {/* Honesty label — this is a scripted example, never live data. */}
          <div className="mb-4 flex items-center justify-center">
            <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-300">
              Example Zorecho Morning Briefing — sample data
            </span>
          </div>

          <div className="relative">
            <Connectors litAgents={litAgents} activeAgent={activeAgent} />
            <div className="relative grid grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_auto_1fr] sm:gap-2">
              {/* Left agent column (desktop) */}
              <div className="hidden min-w-0 flex-col gap-2 sm:flex">
                {LEFT_AGENTS.map((id) => (
                  <MiniChip
                    key={id}
                    id={id}
                    lit={litAgents.has(id)}
                    active={activeAgent === id}
                  />
                ))}
              </div>

              {/* Core */}
              <div className="flex flex-col items-center px-2 sm:px-6">
                <ZorechoCore state={coreState} pulse={pulse} size={170} />
                <p className="mt-3 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-200/70">
                  Zorecho Core
                </p>
              </div>

              {/* Right agent column (desktop) */}
              <div className="hidden min-w-0 flex-col gap-2 sm:flex">
                {RIGHT_AGENTS.map((id) => (
                  <MiniChip
                    key={id}
                    id={id}
                    lit={litAgents.has(id)}
                    active={activeAgent === id}
                    align="right"
                  />
                ))}
              </div>
            </div>

            {/* Mobile: compact agent dots under the Core */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5 sm:hidden">
              {AGENTS_META.map((a) => {
                const lit = litAgents.has(a.id);
                return (
                  <span
                    key={a.id}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold transition-all duration-500"
                    style={{
                      backgroundColor: lit ? `${a.color}22` : "rgba(148,163,184,0.08)",
                      color: lit ? a.color : "#475569",
                      border: `1px solid ${lit ? `${a.color}66` : "rgba(148,163,184,0.15)"}`,
                      boxShadow:
                        activeAgent === a.id ? `0 0 14px ${a.color}66` : "none",
                    }}
                    title={a.name}
                  >
                    {a.name[0]}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Caption of what Echo is saying (readable even when muted) */}
          <div className="mt-4 min-h-[2.5rem] text-center">
            {!started && (
              <button
                type="button"
                onClick={start}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-400 px-6 py-3 text-sm font-bold text-black shadow-lg shadow-cyan-500/25 transition hover:brightness-110"
              >
                <span aria-hidden="true">▶</span> Meet Echo
              </button>
            )}
            {started && step && (
              <p className="text-sm italic leading-relaxed text-slate-300" aria-live="polite">
                “{step.text}”
              </p>
            )}
          </div>

          {/* Report cards appear as each department is mentioned */}
          {cards.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {cards.map((c) => (
                <ReportCard key={`${c.agentId}-${c.label}`} card={c} />
              ))}
            </div>
          )}

          {/* Closing CTA */}
          {done && (
            <div className="mt-5 text-center">
              <Link
                to="/dashboard"
                className="z-anim inline-block rounded-xl bg-gradient-to-r from-teal-400 to-cyan-500 px-6 py-3 text-sm font-bold text-black shadow-lg shadow-teal-500/25 transition hover:brightness-110"
                style={{ animation: "hero-card-in 0.5s ease-out both" }}
              >
                See Mission Control
              </Link>
            </div>
          )}

          {/* Controls */}
          {started && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {playing ? (
                <ControlButton onClick={pause} label="Pause demo">
                  ⏸ Pause
                </ControlButton>
              ) : (
                !done && (
                  <ControlButton onClick={resume} label="Play demo">
                    ▶ Play
                  </ControlButton>
                )
              )}
              <ControlButton onClick={replay} label="Replay demo">
                ↺ Replay
              </ControlButton>
              <ControlButton
                onClick={toggleMute}
                label={muted ? "Unmute Echo" : "Mute Echo"}
              >
                {muted ? "🔇 Unmute" : "🔊 Mute"}
              </ControlButton>
              {!done && (
                <ControlButton onClick={skip} label="Skip demo">
                  ⏭ Skip demo
                </ControlButton>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
