// Zorecho Badge — translucent tinted chips. Color always means something:
// blue = informational, cyan = Zorecho/system, green = healthy, amber = needs
// attention, red = critical, neutral = inactive. `color` accepts a hex for
// agent-colored badges.

const TONES = {
  blue: "bg-blue-500/10 text-blue-300 ring-blue-400/20",
  cyan: "bg-cyan-400/10 text-cyan-300 ring-cyan-300/20",
  success: "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20",
  warn: "bg-amber-500/10 text-amber-300 ring-amber-400/20",
  danger: "bg-red-500/10 text-red-300 ring-red-400/20",
  neutral: "bg-slate-500/10 text-slate-400 ring-slate-400/15",
};

export default function Badge({
  tone = "neutral",
  color = null,
  className = "",
  children,
}) {
  const style = color
    ? {
        backgroundColor: `${color}1a`,
        color,
        boxShadow: `inset 0 0 0 1px ${color}33`,
      }
    : undefined;
  return (
    <span
      className={[
        "font-inter inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        color ? "" : `ring-1 ring-inset ${TONES[tone] || TONES.neutral}`,
        className,
      ].join(" ")}
      style={style}
    >
      {children}
    </span>
  );
}
