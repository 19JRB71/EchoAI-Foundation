import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ZorechoCore from "../components/ui/ZorechoCore.jsx";
import { AGENTS_META } from "../lib/departments.js";
import { DEMO_STEPS, BRIEFING_ROWS, stepDurationMs } from "./heroDemoScript.js";

// Zorecho landing hero — "entrance to Zorecho Headquarters". The Core is the
// unmistakable focal point: enlarged, wrapped in layered rings, bloom, and
// ambient particles, with the nine agents connected around it. The example
// briefing builds dynamically as Echo speaks. Reuses the SAME ZorechoCore
// component as Mission Control (no visual fork). Nothing autoplays: the demo
// starts only on click, using pre-generated static audio files.

const LEFT_AGENTS = ["echo", "scout", "atlas", "nova"];
const RIGHT_AGENTS = ["pulse", "voice", "forge", "sentinel", "sage"];

// Middle nav items link to the live marketing site — dedicated pages don't
// exist yet, so none of these are dead ends. Sign In and the CTAs use the
// real login (/dashboard) and demo-booking (/#demo) routes.
const NAV_ITEMS = [
  { label: "Product", href: "/" },
  { label: "AI Agents", href: "/" },
  { label: "Solutions", href: "/" },
  { label: "Pricing", href: "/" },
  { label: "Resources", href: "/" },
  { label: "About", href: "/" },
];

function agentMeta(id) {
  return AGENTS_META.find((a) => a.id === id) || null;
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

/* ————— Navigation ————— */

function HeroNav() {
  return (
    <header className="border-b border-white/5 bg-black/60 backdrop-blur">
      <div className="mx-auto flex max-w-[88rem] items-center justify-between gap-4 px-6 py-4">
        <img
          src="/zorecho-wordmark.png"
          alt="Zorecho"
          className="h-6 w-auto shrink-0 sm:h-7"
        />
        <nav
          className="hidden items-center gap-7 lg:flex"
          aria-label="Zorecho site"
        >
          {NAV_ITEMS.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="text-sm font-medium text-slate-300 transition hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-3">
          <Link
            to="/dashboard"
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-white/25 hover:text-white"
          >
            Sign In
          </Link>
          <a
            href="/#demo"
            className="hidden rounded-lg bg-gradient-to-r from-cyan-400 to-teal-400 px-4 py-2 text-sm font-bold text-black transition hover:brightness-110 sm:inline-block"
          >
            Start Your AI Company
          </a>
        </div>
      </div>
    </header>
  );
}

/* ————— Echo speech line (open, connected to the Core — not a heavy box) ————— */

function EchoSpeech({ started, playing, text }) {
  return (
    <div
      className="relative mx-auto w-full max-w-lg rounded-2xl border border-cyan-400/20 bg-white/[0.03] px-5 py-3.5 backdrop-blur-sm transition-shadow duration-700"
      style={{
        boxShadow: playing
          ? "0 0 40px rgba(34,211,238,0.16)"
          : "0 0 20px rgba(34,211,238,0.06)",
      }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold transition-shadow duration-700"
          style={{
            backgroundColor: "rgba(20,184,166,0.18)",
            color: "#2dd4bf",
            border: "1px solid rgba(20,184,166,0.5)",
            boxShadow: playing ? "0 0 14px rgba(45,212,191,0.6)" : "none",
          }}
        >
          E
        </span>
        <span className="text-xs font-bold tracking-widest text-white">
          ECHO
        </span>
        <span className="text-[10px] text-slate-400">AI Assistant</span>
        <span className="ml-auto flex items-end gap-[2px]" aria-hidden="true">
          {[5, 9, 7, 11, 6].map((h, i) => (
            <span
              key={i}
              className="w-[2.5px] rounded-full bg-cyan-400/90"
              style={{ height: playing ? h : 3, transition: "height 0.4s" }}
            />
          ))}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-100">
        {started
          ? `\u201C${text}\u201D`
          : "Hello. I\u2019m Echo. Press \u201CWatch Echo Work\u201D and I\u2019ll walk you through an example morning briefing."}
      </p>
      {/* Tail pointing to the Core */}
      <span
        aria-hidden="true"
        className="absolute -bottom-[7px] left-1/2 h-3.5 w-3.5 -translate-x-1/2 rotate-45 border-b border-r border-cyan-400/20 bg-[#04091a]"
      />
    </div>
  );
}

/* ————— Agent nodes — permanent department colors, open styling ————— */

function AgentChip({ id, lit, active, align }) {
  const meta = agentMeta(id);
  if (!meta) return null;
  const color = meta.color;
  const gradientDir = align === "right" ? "270deg" : "90deg";
  return (
    <div
      className={`relative z-10 flex w-full min-w-0 items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-all duration-500 ${
        align === "right" ? "flex-row-reverse text-right" : ""
      }`}
      style={{
        borderColor: active ? `${color}CC` : lit ? `${color}88` : `${color}3D`,
        background: `linear-gradient(${gradientDir}, ${color}${lit ? "1F" : "12"}, rgba(4,9,26,0.35) 65%)`,
        boxShadow: active
          ? `0 0 30px ${color}66`
          : lit
            ? `0 0 18px ${color}33`
            : `0 0 10px ${color}14`,
        opacity: lit ? 1 : 0.85,
      }}
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold transition-all duration-500"
        style={{
          backgroundColor: `${color}${lit ? "2E" : "1A"}`,
          color: lit ? color : `${color}B3`,
          border: `1px solid ${color}${lit ? "88" : "4D"}`,
          boxShadow: lit ? `0 0 12px ${color}44` : "none",
        }}
      >
        {meta.name[0]}
      </span>
      <span className="min-w-0">
        <span
          className="block text-[13px] font-bold leading-tight transition-colors duration-500"
          style={{ color: lit ? "#ffffff" : "#cbd5e1" }}
        >
          {meta.name}
        </span>
        <span className="block text-[10px] leading-tight text-slate-400">
          {meta.title}
        </span>
        <span
          className={`mt-0.5 flex items-center gap-1 text-[9px] font-semibold text-emerald-400 ${
            align === "right" ? "justify-end" : ""
          }`}
        >
          <span className="h-1 w-1 rounded-full bg-emerald-400" aria-hidden="true" />
          Online
        </span>
      </span>
    </div>
  );
}

/* ————— Connector lines ————— */

function Connectors({ litAgents, activeAgent }) {
  const reduceMotion = prefersReducedMotion();
  const yFor = (count, i) => (count <= 1 ? 50 : 8 + (i / (count - 1)) * 84);
  const paths = [];
  LEFT_AGENTS.forEach((id, i) => {
    const meta = agentMeta(id);
    paths.push({
      d: `M 21,${yFor(LEFT_AGENTS.length, i)} C 34,${yFor(LEFT_AGENTS.length, i)} 39,50 48,50`,
      color: meta ? meta.color : "#22d3ee",
      id,
    });
  });
  RIGHT_AGENTS.forEach((id, i) => {
    const meta = agentMeta(id);
    paths.push({
      d: `M 79,${yFor(RIGHT_AGENTS.length, i)} C 66,${yFor(RIGHT_AGENTS.length, i)} 61,50 52,50`,
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
              strokeWidth="1.2"
              opacity={lit ? 0.3 : 0.12}
              style={{ transition: "opacity 0.6s" }}
            />
            <path
              d={p.d}
              fill="none"
              stroke={p.color}
              strokeWidth="0.4"
              opacity={lit ? 0.95 : 0.45}
              style={{ transition: "opacity 0.6s" }}
            />
            {active && !reduceMotion && (
              <circle r="1" fill={p.color} className="z-anim">
                <animateMotion dur="1.6s" repeatCount="indefinite" path={p.d} />
              </circle>
            )}
            {active && reduceMotion && (
              <path d={p.d} fill="none" stroke={p.color} strokeWidth="0.7" opacity="1" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ————— Ambient particles drifting around the Core (idle life) ————— */

const AMBIENT = [
  { r: "46%", dur: 14, delay: 0, s: 3 },
  { r: "54%", dur: 18, delay: -6, s: 2 },
  { r: "50%", dur: 22, delay: -11, s: 2 },
  { r: "58%", dur: 16, delay: -3, s: 2 },
  { r: "43%", dur: 20, delay: -9, s: 3 },
  { r: "62%", dur: 26, delay: -14, s: 2 },
  { r: "48%", dur: 19, delay: -7, s: 2 },
  { r: "56%", dur: 24, delay: -17, s: 3 },
];

function AmbientParticles() {
  if (prefersReducedMotion()) return null;
  return (
    <>
      {AMBIENT.map((p, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="z-anim pointer-events-none absolute left-1/2 top-1/2 rounded-full"
          style={{
            width: p.s,
            height: p.s,
            marginLeft: -p.s / 2,
            marginTop: -p.s / 2,
            backgroundColor: "#67e8f9",
            boxShadow: "0 0 8px rgba(34,211,238,0.8)",
            opacity: 0.5,
            "--z-orbit-r": p.r,
            animation: `z-orbit ${p.dur}s linear infinite`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </>
  );
}

/* ————— Layered rings + bloom that make the Core the hero ————— */

function CoreAura({ playing }) {
  return (
    <>
      {/* Deep atmospheric bloom */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-24 rounded-full transition-opacity duration-1000 sm:-inset-32"
        style={{
          background:
            "radial-gradient(circle, rgba(34,211,238,0.22) 0%, rgba(59,130,246,0.12) 40%, transparent 72%)",
          opacity: playing ? 1 : 0.65,
        }}
      />
      {/* Breathing inner halo */}
      <div
        aria-hidden="true"
        className="z-anim animate-z-breathe pointer-events-none absolute -inset-10 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(34,211,238,0.25) 0%, transparent 68%)",
          opacity: playing ? 1 : 0.6,
          transition: "opacity 0.8s",
        }}
      />
      {/* Concentric rings */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-5 rounded-full border transition-all duration-1000"
        style={{
          borderColor: playing
            ? "rgba(34,211,238,0.45)"
            : "rgba(34,211,238,0.28)",
          boxShadow: playing ? "0 0 24px rgba(34,211,238,0.25)" : "none",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-12 rounded-full border transition-all duration-1000 sm:-inset-14"
        style={{
          borderColor: playing
            ? "rgba(59,130,246,0.35)"
            : "rgba(59,130,246,0.20)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-20 hidden rounded-full border sm:block sm:-inset-24"
        style={{ borderColor: "rgba(34,211,238,0.10)" }}
      />
    </>
  );
}

/* ————— Example briefing panel — builds dynamically as Echo speaks ————— */

function BriefingRow({ row, active }) {
  const meta = agentMeta(row.agentId);
  const color = meta ? meta.color : "#22d3ee";
  return (
    <div
      className="z-anim flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-shadow duration-500"
      style={{
        borderColor: `${color}44`,
        backgroundColor: "rgba(255,255,255,0.03)",
        boxShadow: active ? `0 0 20px ${color}44` : "none",
        animation: "z-fade-up 0.55s ease-out both",
      }}
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
        style={{
          backgroundColor: `${color}1f`,
          color,
          border: `1px solid ${color}55`,
        }}
      >
        {meta ? meta.name[0] : "?"}
      </span>
      <span className="min-w-0">
        <span className="block text-base font-bold leading-tight text-white">
          {row.value}{" "}
          <span className="text-xs font-semibold text-slate-300">
            {row.label}
          </span>
        </span>
        <span className="block text-[10px] leading-tight text-slate-500">
          {row.sub}
        </span>
      </span>
    </div>
  );
}

function BriefingPanel({ litRows, activeRow, started, done }) {
  const visibleRows = BRIEFING_ROWS.filter((row) => litRows.has(row.id));
  return (
    <aside className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-300">
        Example Morning Briefing
      </p>

      {visibleRows.length === 0 ? (
        <div className="mt-3 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 px-4 py-10 text-center">
          <span
            className="z-anim h-2 w-2 rounded-full bg-cyan-400"
            style={{ animation: "z-presence 2.4s ease-in-out infinite" }}
            aria-hidden="true"
          />
          <p className="mt-3 text-sm text-slate-400">
            {started
              ? "Echo is preparing the briefing\u2026"
              : "Press \u201CWatch Echo Work\u201D and Echo will build this example briefing live."}
          </p>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {visibleRows.map((row) => (
            <BriefingRow key={row.id} row={row} active={activeRow === row.id} />
          ))}
        </div>
      )}

      {done && (
        <div
          className="z-anim mt-4 border-t border-white/5 pt-3"
          style={{ animation: "z-fade-up 0.55s ease-out both" }}
        >
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-300">
            Echo Summary
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            Your AI company is online and ready. Would you like to see Mission
            Control?
          </p>
          <Link
            to="/dashboard"
            className="mt-3 block rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 px-4 py-2.5 text-center text-sm font-bold text-black transition hover:brightness-110"
          >
            See Mission Control →
          </Link>
        </div>
      )}

      <p className="mt-4 text-center text-[10px] font-medium uppercase tracking-wider text-amber-300/80">
        Example Zorecho Morning Briefing — Sample data
      </p>
    </aside>
  );
}

/* ————— Demo control buttons ————— */

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

/* ————— Neutral trust strip (no invented social proof) ————— */

function BenefitIcon({ kind }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "#67e8f9",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  if (kind === "building") {
    return (
      <svg {...common}>
        <rect x="5" y="3" width="14" height="18" rx="1" />
        <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" />
      </svg>
    );
  }
  if (kind === "map") {
    return (
      <svg {...common}>
        <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
        <path d="M9 4v14M15 6v14" />
      </svg>
    );
  }
  if (kind === "shield") {
    return (
      <svg {...common}>
        <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" />
        <path d="m9.5 12 2 2 3.5-4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 2.5" />
    </svg>
  );
}

const BENEFITS = [
  { icon: "building", title: "All Types of Businesses", sub: "From solo owners to teams" },
  { icon: "map", title: "Every Industry Served", sub: "Services, retail, real estate & more" },
  { icon: "shield", title: "Secure and Private", sub: "Your data stays yours" },
  { icon: "clock", title: "24/7 AI Workforce", sub: "Working while you sleep" },
];

function BenefitStrip() {
  return (
    <div className="relative border-t border-white/5 bg-white/[0.02]">
      <div className="mx-auto grid max-w-[88rem] gap-6 px-6 py-8 sm:grid-cols-2 lg:grid-cols-[1.2fr_repeat(4,minmax(0,1fr))] lg:items-center">
        <div>
          <p className="text-sm font-bold uppercase tracking-wider text-white">
            Trusted by businesses across the U.S.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Built to help businesses grow, connect, and operate more
            efficiently with AI.
          </p>
        </div>
        {BENEFITS.map((b) => (
          <div key={b.title} className="flex items-center gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/5"
              aria-hidden="true"
            >
              <BenefitIcon kind={b.icon} />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-bold leading-tight text-slate-200">
                {b.title}
              </span>
              <span className="block text-[10px] leading-tight text-slate-500">
                {b.sub}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ————— Responsive Core size ————— */

function useCoreSize() {
  const [size, setSize] = useState(() => {
    if (typeof window === "undefined") return 300;
    if (window.matchMedia("(max-width: 639px)").matches) return 210;
    if (window.matchMedia("(max-width: 1279px)").matches) return 280;
    return 330;
  });
  useEffect(() => {
    const compute = () => {
      if (window.matchMedia("(max-width: 639px)").matches) setSize(210);
      else if (window.matchMedia("(max-width: 1279px)").matches) setSize(280);
      else setSize(330);
    };
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);
  return size;
}

/* ————— Hero ————— */

export default function HeroDemo() {
  // idle → playing ⇄ paused → done (skip/finish); replay returns to playing.
  const [status, setStatus] = useState("idle");
  const [stepIdx, setStepIdx] = useState(-1);
  const [muted, setMuted] = useState(false);
  const [litAgents, setLitAgents] = useState(() => new Set());
  const [litRows, setLitRows] = useState(() => new Set());
  const [pulse, setPulse] = useState(null);
  const coreSize = useCoreSize();

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
      if (step.rowId) {
        setLitRows((prev) => {
          const next = new Set(prev);
          next.add(step.rowId);
          return next;
        });
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
    setLitRows(new Set());
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
    setLitRows(new Set(BRIEFING_ROWS.map((r) => r.id)));
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
  const activeRow = playing && step ? step.rowId : null;
  const coreState = playing ? "speaking" : "idle";

  return (
    <section className="relative overflow-hidden bg-[#02040a]">
      <HeroNav />

      {/* Atmospheric lighting — soft blue glow concentrated behind the Core */}
      <div
        className="pointer-events-none absolute left-1/2 top-16 h-[42rem] w-[72rem] -translate-x-1/2 rounded-full blur-3xl transition-opacity duration-1000"
        style={{
          background:
            "radial-gradient(ellipse, rgba(34,211,238,0.10) 0%, rgba(59,130,246,0.07) 45%, transparent 75%)",
          opacity: playing ? 1 : 0.75,
        }}
      />
      <div className="pointer-events-none absolute -left-32 top-64 h-96 w-96 rounded-full bg-blue-600/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 top-40 h-96 w-96 rounded-full bg-purple-600/10 blur-3xl" />

      <div className="relative mx-auto grid max-w-[88rem] grid-cols-1 items-start gap-10 px-6 pb-20 pt-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.8fr)] lg:gap-8 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.8fr)_minmax(0,0.8fr)]">
        {/* ————— Left: copy + CTAs ————— */}
        <div className="pt-4 text-center lg:pt-14 lg:text-left">
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-cyan-300">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" aria-hidden="true" />
            Introducing Echo
          </span>
          <h1 className="mt-6 text-5xl font-black leading-[1.02] tracking-tight sm:text-6xl xl:text-[4rem]">
            Meet Your{" "}
            <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
              AI Company.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-md text-base leading-relaxed text-slate-300 lg:mx-0">
            A connected AI workforce for marketing, lead follow-up, customer
            calls, content, research, and business intelligence—working around
            the clock.
          </p>
          <p className="mt-5 text-sm font-semibold text-teal-300">
            Always working.{" "}
            <span className="text-cyan-300">Always improving.</span>{" "}
            <span className="text-blue-300">Always yours.</span>
          </p>
          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-center lg:justify-start">
            <a
              href="/#demo"
              className="inline-block whitespace-nowrap rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 px-6 py-3.5 text-base font-bold text-black shadow-lg shadow-cyan-500/25 transition hover:brightness-110"
            >
              Start Your AI Company →
            </a>
            <button
              type="button"
              onClick={() => (started ? replay() : start())}
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl border border-white/15 bg-white/5 px-6 py-3.5 text-base font-semibold text-white transition hover:border-cyan-400/50 hover:bg-white/10"
            >
              <span aria-hidden="true">▶</span> Watch Echo Work
            </button>
          </div>
        </div>

        {/* ————— Center: Echo speech + the dominant living Core + agents ————— */}
        <div className="min-w-0">
          <EchoSpeech
            started={started}
            playing={playing}
            text={step ? step.text : ""}
          />

          <div className="relative mt-8" id="hero-core-stage">
            <Connectors litAgents={litAgents} activeAgent={activeAgent} />
            <div className="relative grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-3">
              {/* Left agent column (desktop) */}
              <div className="hidden min-w-0 flex-col gap-3 sm:flex">
                {LEFT_AGENTS.map((id) => (
                  <AgentChip
                    key={id}
                    id={id}
                    lit={litAgents.has(id)}
                    active={activeAgent === id}
                  />
                ))}
              </div>

              {/* The Core — dominant focal point */}
              <div className="flex flex-col items-center px-4 py-6 sm:px-10 sm:py-10">
                <div className="relative">
                  <CoreAura playing={playing} />
                  <AmbientParticles />
                  <ZorechoCore state={coreState} pulse={pulse} size={coreSize} />
                </div>
                <p className="mt-8 text-center text-xs font-bold uppercase tracking-[0.35em] text-cyan-200/90">
                  Zorecho Core
                </p>
                <p className="mt-1 text-center text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-400/70">
                  AI Workforce Operational
                </p>
                <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[10px] font-semibold text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                  All systems active
                </span>
              </div>

              {/* Right agent column (desktop) */}
              <div className="hidden min-w-0 flex-col gap-3 sm:flex">
                {RIGHT_AGENTS.map((id) => (
                  <AgentChip
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
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold transition-all duration-500"
                    style={{
                      backgroundColor: lit ? `${a.color}22` : `${a.color}0F`,
                      color: lit ? a.color : `${a.color}99`,
                      border: `1px solid ${lit ? `${a.color}66` : `${a.color}33`}`,
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

          {/* Demo controls while the demo runs (pause / mute / skip).
              Starting and replaying live on the single "Watch Echo Work" CTA. */}
          <div className="mt-4 flex min-h-[2.25rem] flex-wrap items-center justify-center gap-2">
            {started && !done && (
              <>
                {playing ? (
                  <ControlButton onClick={pause} label="Pause demo">
                    ⏸ Pause
                  </ControlButton>
                ) : (
                  <ControlButton onClick={resume} label="Play demo">
                    ▶ Play
                  </ControlButton>
                )}
                <ControlButton
                  onClick={toggleMute}
                  label={muted ? "Unmute Echo" : "Mute Echo"}
                >
                  {muted ? "🔇 Unmute" : "🔊 Mute"}
                </ControlButton>
                <ControlButton onClick={skip} label="Skip demo">
                  ⏭ Skip demo
                </ControlButton>
              </>
            )}
          </div>
        </div>

        {/* ————— Right: Example Morning Briefing panel ————— */}
        <div className="min-w-0 lg:col-span-2 xl:col-span-1">
          <BriefingPanel
            litRows={litRows}
            activeRow={activeRow}
            started={started}
            done={done}
          />
        </div>
      </div>

      {/* Horizon light near the bottom of the hero */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-44"
        style={{
          background:
            "radial-gradient(ellipse 80% 100% at 50% 100%, rgba(34,211,238,0.09) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent"
      />

      <BenefitStrip />
    </section>
  );
}
