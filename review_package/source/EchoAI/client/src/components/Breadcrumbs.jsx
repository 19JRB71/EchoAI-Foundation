// Breadcrumb trail for the department-based navigation: Home > Agent > Tool.
// Each crumb except the last (the current view) is a clickable button.

export default function Breadcrumbs({ crumbs = [] }) {
  if (!crumbs.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={`${c.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-gray-600">/</span>}
            {last || !c.onClick ? (
              <span className={last ? "font-semibold text-gray-200" : "text-gray-400"}>
                {c.label}
              </span>
            ) : (
              <button
                onClick={c.onClick}
                className="text-gray-400 transition hover:text-teal-300"
              >
                {c.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
