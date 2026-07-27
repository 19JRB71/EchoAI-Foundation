// Client mirror of the display-relevant parts of backend `config/goals.js`
// (Prompt 67 — Target Goals). Keep BRAND_TYPES, category labels, status buckets
// and formatting in sync with the backend. The backend remains the source of
// truth for what metrics/targets are valid; this file only drives rendering.

export const BRAND_TYPES = {
  standard: {
    label: "Standard Business",
    description: "Ads, leads, content, and appointments.",
  },
  affiliate: {
    label: "Affiliate / Referral",
    description: "Referral-driven — track referrals and commission.",
  },
  ecommerce: {
    label: "E-commerce",
    description: "Online store — ads, revenue, leads, and content.",
  },
  service: {
    label: "Service / Appointments",
    description: "Booking-driven — emphasize appointments and leads.",
  },
  restaurant: {
    label: "Restaurant / Hospitality",
    description: "Reservations, foot traffic, and content.",
  },
  political: {
    label: "Political Campaign",
    description: "Voter outreach, volunteers, donations, and campaign content.",
  },
  real_estate: {
    label: "Real Estate Agent",
    description: "Listings, buyer/seller leads, days on market, and GCI.",
  },
};

export const BRAND_TYPE_KEYS = Object.keys(BRAND_TYPES);
export const DEFAULT_BRAND_TYPE = "standard";

export function brandTypeLabel(type) {
  return (BRAND_TYPES[type] || BRAND_TYPES[DEFAULT_BRAND_TYPE]).label;
}

// Progress buckets (mirror backend classifyProgress). Each has a label + colors.
export const GOAL_STATUS = {
  exceeding: { label: "Exceeding", color: "#10B981", bg: "rgba(16,185,129,0.15)" },
  hit: { label: "Hit", color: "#22C55E", bg: "rgba(34,197,94,0.15)" },
  on_track: { label: "On Track", color: "#0EA5E9", bg: "rgba(14,165,233,0.15)" },
  at_risk: { label: "At Risk", color: "#F97316", bg: "rgba(249,115,22,0.15)" },
  no_data: { label: "No Data Yet", color: "#6B7280", bg: "rgba(107,114,128,0.15)" },
};

export function statusMeta(status) {
  return GOAL_STATUS[status] || GOAL_STATUS.no_data;
}

// Friendly label + color for a logged goal-alert kind (see the daily sweep).
// Shared by the Mission Control feed and the Settings 30-day alert history.
export const GOAL_ALERT_META = {
  exceeding: { label: "Exceeding", color: "#22c55e" },
  hit: { label: "Goal hit", color: "#22c55e" },
  at_risk_urgent: { label: "Urgently behind", color: "#ef4444" },
  at_risk_early: { label: "Behind pace", color: "#f59e0b" },
  swing_up: { label: "Big jump", color: "#38bdf8" },
  swing_down: { label: "Dropped", color: "#f97316" },
};

export function goalAlertMeta(kind) {
  return GOAL_ALERT_META[kind] || { label: "Update", color: "#9ca3af" };
}

// Score coloring for the 0–100 achievement score.
export function scoreColor(score) {
  if (score == null) return "#6B7280";
  if (score >= 90) return "#10B981";
  if (score >= 70) return "#0EA5E9";
  if (score >= 50) return "#F97316";
  return "#EF4444";
}

// Format a metric value for its unit. Currency and ratio get symbols/suffixes.
export function formatValue(value, unit) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  if (unit === "currency") {
    return n >= 1000
      ? `$${Math.round(n).toLocaleString()}`
      : `$${(Math.round(n * 100) / 100).toLocaleString()}`;
  }
  if (unit === "ratio") return `${Math.round(n * 100) / 100}x`;
  if (unit === "percent") return `${Math.round(n * 10) / 10}%`;
  return Math.round(n).toLocaleString();
}

export function formatPercent(percent) {
  if (percent == null || Number.isNaN(Number(percent))) return "—";
  return `${Math.round(Number(percent))}%`;
}

// A "good" trend depends on direction: for decrease goals (CPL) down is good.
export function trendIsGood(trend, direction) {
  if (trend === "flat") return null;
  if (direction === "decrease") return trend === "down";
  return trend === "up";
}

export function trendArrow(trend) {
  if (trend === "up") return "▲";
  if (trend === "down") return "▼";
  return "—";
}
