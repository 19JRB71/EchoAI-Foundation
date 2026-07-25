// Zorecho Toast — notification surface. Rises and settles (z-fade-up),
// glass on black, an agent-colored light edge when the news comes from a
// department. Dismissal is the caller's job (this is presentation only).

import Badge from "./Badge.jsx";

export default function Toast({
  title,
  message,
  agent = null, // { name, color } — optional source department
  tone = "blue", // Badge tone when no agent color
  onClose = undefined,
  className = "",
}) {
  return (
    <div
      role="status"
      className={[
        "font-inter z-anim animate-z-fade-up pointer-events-auto relative w-80 overflow-hidden",
        "rounded-z-card border border-z-line bg-[var(--z-glass)] shadow-z-card backdrop-blur-md",
        className,
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-0.5"
        style={{ backgroundColor: agent?.color || "var(--z-blue)" }}
      />
      <div className="flex items-start gap-3 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-z-text">{title}</p>
            {agent && (
              <Badge color={agent.color} className="shrink-0">
                {agent.name}
              </Badge>
            )}
          </div>
          {message && <p className="mt-1 text-xs leading-relaxed text-z-dim">{message}</p>}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Dismiss notification"
            className="shrink-0 rounded p-1 text-z-faint transition-colors hover:text-z-text focus:outline-none focus-visible:ring-2 focus-visible:ring-z-cyan/60"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
