// Colored star rating. Filled stars are amber, empties are gray. Set
// `interactive` + `onChange` to use it as an input (for manual review entry).

function Star({ filled, size }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill={filled ? "#f59e0b" : "none"}
      stroke={filled ? "#f59e0b" : "#4b5563"}
      strokeWidth="1.5"
      className="shrink-0"
    >
      <path d="M10 1.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L10 14.77l-5.2 2.73.99-5.79-4.21-4.1 5.82-.85L10 1.5z" />
    </svg>
  );
}

export default function StarRating({
  value = 0,
  size = 16,
  interactive = false,
  onChange,
}) {
  const stars = [1, 2, 3, 4, 5];
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5 stars`}>
      {stars.map((s) =>
        interactive ? (
          <button
            key={s}
            type="button"
            onClick={() => onChange?.(s)}
            className="transition hover:scale-110"
            aria-label={`${s} star${s > 1 ? "s" : ""}`}
          >
            <Star filled={s <= value} size={size} />
          </button>
        ) : (
          <Star key={s} filled={s <= value} size={size} />
        ),
      )}
    </span>
  );
}
