// ZORECHO CORE — the heart of the platform.
//
// A living orb that represents the intelligence of the whole AI company. Its
// movement always communicates system state; it is never decoration.
//
// Props:
//   state  — "idle" | "listening" | "thinking" | "speaking"
//              idle:      slow breathing, soft blue light
//              listening: outer ring brightens (cyan), bars glow softly
//              thinking:  particles circulate inside, ring rotates slowly
//              speaking:  the three bars animate as a waveform
//   health — "ok" | "warn" | "critical"
//              ok: blue glow · warn: blue with soft amber accent ·
//              critical: soft red glow (never flashing)
//   pulse  — { color, key } | null — one colored ring expands from the Core
//              when an agent completes work (re-fires when `key` changes)
//   size   — pixel diameter (default 160)
//
// Motion rules: breathing/orbits are slow and eased; rotation happens ONLY
// while thinking; reduced-motion users get a static lit Core (.z-anim).

const HEALTH = {
  ok: { ring: "rgba(59,130,246,0.55)", glow: "0 0 32px rgba(59,130,246,0.35)" },
  warn: {
    ring: "rgba(59,130,246,0.55)",
    glow: "0 0 32px rgba(59,130,246,0.28), 0 0 18px rgba(245,158,11,0.22)",
  },
  critical: {
    ring: "rgba(239,68,68,0.55)",
    glow: "0 0 32px rgba(239,68,68,0.30)",
  },
};

const PARTICLES = [
  { r: "30%", dur: 6.5, delay: 0, s: 3 },
  { r: "36%", dur: 8, delay: -2, s: 2 },
  { r: "24%", dur: 5.5, delay: -1, s: 2 },
  { r: "38%", dur: 9.5, delay: -4, s: 3 },
  { r: "28%", dur: 7.2, delay: -3, s: 2 },
  { r: "33%", dur: 8.8, delay: -5, s: 2 },
];

export default function ZorechoCore({
  state = "idle",
  health = "ok",
  pulse = null,
  size = 160,
  className = "",
}) {
  const h = HEALTH[health] || HEALTH.ok;
  const listening = state === "listening";
  const thinking = state === "thinking";
  const speaking = state === "speaking";

  const ringColor = listening ? "rgba(34,211,238,0.75)" : h.ring;
  const ringGlow = listening
    ? "0 0 36px rgba(34,211,238,0.40)"
    : h.glow;

  return (
    <div
      className={`relative inline-block ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Zorecho Core — ${state}, system ${health === "ok" ? "healthy" : health === "warn" ? "needs minor attention" : "critical"}`}
    >
      {/* One-shot agent-activity pulse ring */}
      {pulse && (
        <span
          key={pulse.key}
          aria-hidden="true"
          className="z-anim pointer-events-none absolute inset-0 rounded-full border-2"
          style={{
            borderColor: pulse.color,
            animation: "z-pulse-ring 1.2s ease-out both",
          }}
        />
      )}

      {/* Breathing wrapper (idle breathes; other states hold steady) */}
      <div
        className={`absolute inset-0 ${state === "idle" ? "z-anim animate-z-breathe" : ""}`}
      >
        {/* Outer ring */}
        <div
          className="absolute inset-0 rounded-full border-2 transition-all duration-500 ease-out"
          style={{ borderColor: ringColor, boxShadow: ringGlow }}
        />

        {/* Thinking: slow rotating light on the ring (only while thinking) */}
        {thinking && (
          <div
            aria-hidden="true"
            className="z-anim absolute inset-0 rounded-full"
            style={{
              background:
                "conic-gradient(from 0deg, transparent 0deg, rgba(34,211,238,0.35) 40deg, transparent 90deg)",
              animation: "z-ring-rotate 8s linear infinite",
              maskImage:
                "radial-gradient(circle, transparent 62%, black 66%, black 72%, transparent 76%)",
              WebkitMaskImage:
                "radial-gradient(circle, transparent 62%, black 66%, black 72%, transparent 76%)",
            }}
          />
        )}

        {/* Sphere */}
        <div
          className="absolute inset-[7%] overflow-hidden rounded-full"
          style={{
            background:
              "radial-gradient(circle at 35% 28%, #16233f 0%, #0a1122 45%, #04060c 100%)",
            boxShadow: "inset 0 0 30px rgba(59,130,246,0.15)",
          }}
        >
          {/* Thinking: circulating particles */}
          {thinking &&
            PARTICLES.map((p, i) => (
              <span
                key={i}
                aria-hidden="true"
                className="z-anim absolute left-1/2 top-1/2 rounded-full"
                style={{
                  width: p.s,
                  height: p.s,
                  marginLeft: -p.s / 2,
                  marginTop: -p.s / 2,
                  backgroundColor: "#67e8f9",
                  boxShadow: "0 0 6px rgba(34,211,238,0.8)",
                  opacity: 0.7,
                  "--z-orbit-r": p.r,
                  animation: `z-orbit ${p.dur}s linear infinite`,
                  animationDelay: `${p.delay}s`,
                }}
              />
            ))}

          {/* The three bars — the Zorecho "E" */}
          <span
            className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-start"
            style={{ gap: size * 0.05 }}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={speaking || state === "idle" ? "z-anim" : ""}
                style={{
                  display: "block",
                  width: size * (i === 1 ? 0.3 : 0.24),
                  height: Math.max(3, size * 0.045),
                  borderRadius: 999,
                  transformOrigin: "left center",
                  background:
                    "linear-gradient(90deg, var(--z-cyan), var(--z-sky))",
                  boxShadow:
                    listening || speaking
                      ? "0 0 12px rgba(34,211,238,0.65)"
                      : "0 0 8px rgba(34,211,238,0.35)",
                  opacity: thinking ? 0.55 : 1,
                  transition: "box-shadow 400ms ease, opacity 400ms ease",
                  animation: speaking
                    ? `z-bar-wave ${0.7 + i * 0.18}s ease-in-out infinite`
                    : state === "idle"
                      ? `z-bar-wave-gentle ${3.2 + i * 0.5}s ease-in-out infinite`
                      : undefined,
                  animationDelay:
                    speaking || state === "idle" ? `${i * 0.12}s` : undefined,
                }}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
