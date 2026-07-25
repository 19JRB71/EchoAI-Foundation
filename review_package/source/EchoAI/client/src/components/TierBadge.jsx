// Small colored pill showing the current plan tier next to the user's name in
// the top bar. Starter→blue, Professional→purple, Enterprise→gold, admin→teal.

import { PLAN_META, TIER_COLORS, DEFAULT_ACCENT } from "../lib/tiers.js";

export default function TierBadge({ tier, isAdmin = false, className = "" }) {
  let label;
  let color;
  if (isAdmin) {
    label = "Admin";
    color = DEFAULT_ACCENT;
  } else {
    const meta = PLAN_META[tier];
    label = meta ? meta.name : tier || "—";
    color = TIER_COLORS[tier] || DEFAULT_ACCENT;
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}
      style={{
        color,
        backgroundColor: `${color}22`,
        border: `1px solid ${color}55`,
      }}
    >
      {label}
    </span>
  );
}
