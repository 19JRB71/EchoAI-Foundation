// Zorecho three-bar loader — the "E" of the wordmark, illuminating in
// sequence. Replaces spinners across the platform as pages migrate.

const SIZES = {
  sm: { w: "w-4", h: "h-[3px]", gap: "gap-[3px]" },
  md: { w: "w-6", h: "h-1", gap: "gap-1" },
  lg: { w: "w-10", h: "h-1.5", gap: "gap-1.5" },
};

export default function BarsLoader({ size = "md", label = null, className = "" }) {
  const s = SIZES[size] || SIZES.md;
  return (
    <div
      className={`font-inter inline-flex items-center gap-3 ${className}`}
      role="status"
      aria-label={label || "Loading"}
    >
      <span className={`flex flex-col ${s.gap}`}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`z-anim ${s.w} ${s.h} rounded-full`}
            style={{
              background: "linear-gradient(90deg, var(--z-blue), var(--z-cyan))",
              boxShadow: "0 0 8px rgba(34,211,238,0.35)",
              animation: "z-bar-seq 1.2s ease-in-out infinite",
              animationDelay: `${i * 0.18}s`,
            }}
          />
        ))}
      </span>
      {label && <span className="text-sm text-z-dim">{label}</span>}
    </div>
  );
}
