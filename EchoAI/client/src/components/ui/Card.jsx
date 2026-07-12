// Zorecho Card — soft glass surfaces on deep black.
//
//   <Card>            solid surface (default; cheap to render, use anywhere)
//   <Card glass>      glass surface (backdrop blur — cap at ~3 per screen)
//   <Card interactive> hover elevation: brighter line + deeper shadow, no jump
//   <Card accent="#14B8A6"> a 2px agent-colored light along the top edge
//
// Elevation is expressed with light (border + shadow), not movement.

export default function Card({
  glass = false,
  interactive = false,
  accent = null,
  className = "",
  children,
  ...props
}) {
  return (
    <div
      className={[
        "font-inter relative overflow-hidden rounded-z-card border border-z-line",
        glass
          ? "bg-[var(--z-glass)] backdrop-blur-md"
          : "bg-z-surface",
        interactive
          ? "transition-all duration-200 ease-out hover:border-z-line-bright hover:bg-z-raised hover:shadow-z-card cursor-pointer"
          : "",
        className,
      ].join(" ")}
      {...props}
    >
      {accent && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-0.5"
          style={{
            background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
          }}
        />
      )}
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, right = null, className = "" }) {
  return (
    <div
      className={`flex items-start justify-between gap-3 border-b border-z-line px-5 py-4 ${className}`}
    >
      <div className="min-w-0">
        <h3 className="text-sm font-semibold tracking-wide text-z-text">
          {title}
        </h3>
        {subtitle && (
          <p className="mt-0.5 text-xs text-z-faint">{subtitle}</p>
        )}
      </div>
      {right}
    </div>
  );
}

export function CardBody({ className = "", children }) {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
}
