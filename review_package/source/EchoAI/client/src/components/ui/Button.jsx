// Zorecho Button — the platform's only button going forward.
//
// Variants:
//   primary   — blue light on dark glass; the one action that matters on a screen
//   secondary — quiet outline; supporting actions
//   ghost     — text-weight action; table rows, inline affordances
//   danger    — destructive actions; red is reserved for real consequences
//
// Motion: 200ms ease transitions on color/light only. Hover raises the light,
// never the element. Focus is a visible cyan ring (keyboard accessibility).

const VARIANTS = {
  primary:
    "bg-z-blue text-white border border-transparent " +
    "hover:bg-z-sky hover:shadow-z-glow " +
    "disabled:hover:bg-z-blue disabled:hover:shadow-none",
  secondary:
    "bg-transparent text-z-text border border-z-line " +
    "hover:border-z-line-bright hover:bg-white/[0.04]",
  ghost:
    "bg-transparent text-z-dim border border-transparent " +
    "hover:text-z-text hover:bg-white/[0.05]",
  danger:
    "bg-transparent text-red-400 border border-red-500/30 " +
    "hover:bg-red-500/10 hover:border-red-500/50",
};

const SIZES = {
  sm: "text-xs px-3 py-1.5 gap-1.5",
  md: "text-sm px-4 py-2 gap-2",
  lg: "text-base px-6 py-3 gap-2.5",
};

export default function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  className = "",
  children,
  ...props
}) {
  return (
    <button
      disabled={disabled || loading}
      className={[
        "font-inter inline-flex items-center justify-center rounded-z-ctrl font-semibold",
        "transition-all duration-200 ease-out select-none",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-z-cyan/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        VARIANTS[variant] || VARIANTS.primary,
        SIZES[size] || SIZES.md,
        className,
      ].join(" ")}
      {...props}
    >
      {loading && (
        <span
          className="z-anim h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white/25 border-t-white/90"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}
