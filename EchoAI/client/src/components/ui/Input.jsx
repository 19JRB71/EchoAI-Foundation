// Zorecho form controls — recessed wells on deep black, blue focus light.
// Field wraps a label + control + optional error/hint with consistent spacing.

const CONTROL =
  "font-inter w-full rounded-z-ctrl border bg-abyss px-3.5 py-2.5 text-sm text-z-text " +
  "placeholder:text-z-faint transition-all duration-200 ease-out " +
  "focus:outline-none focus:border-z-blue focus:shadow-z-glow " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

function borderFor(error) {
  return error ? "border-red-500/50" : "border-z-line hover:border-z-line-bright";
}

export function Field({ label, hint, error, htmlFor, children, className = "" }) {
  return (
    <div className={`font-inter ${className}`}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-z-dim"
        >
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-z-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ error = false, className = "", ...props }) {
  return (
    <input className={`${CONTROL} ${borderFor(error)} ${className}`} {...props} />
  );
}

export function TextArea({ error = false, className = "", rows = 4, ...props }) {
  return (
    <textarea
      rows={rows}
      className={`${CONTROL} ${borderFor(error)} resize-y ${className}`}
      {...props}
    />
  );
}

export function Select({ error = false, className = "", children, ...props }) {
  return (
    <select
      className={`${CONTROL} ${borderFor(error)} appearance-none pr-9 bg-no-repeat bg-[right_0.75rem_center] ${className}`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
      }}
      {...props}
    >
      {children}
    </select>
  );
}
