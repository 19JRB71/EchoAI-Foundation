// Client mirror of the server notification priority classification
// (Zorecho/config/notificationPriority.js). Keep the event map in sync with the
// server; the server is authoritative and stamps each notification with a
// `priority`, but this mirror lets the client derive/order defensively and owns
// the visual styling (colors + labels) for the badge and panel.

export const PRIORITY_RANK = { red: 0, yellow: 1, green: 2 };

export const EVENT_PRIORITY = {
  hot_lead: "red",
  autonomous_hot_lead: "red",
  budget_low: "red",
  competitor_ad_threat: "red",

  sage_urgent: "yellow",
  goal_alert: "yellow",
  rep_completed: "yellow",
  email_alert: "yellow",
  followup_due: "yellow",
  appointment_15m: "yellow",
  appointment_5m: "yellow",
  task_alert: "yellow",
  task_checkin: "yellow",
  personal_reminder: "yellow",

  sentinel_fixed: "green",
  day_summary: "green",
  morning_briefing: "green",
};

// Visual styling + human labels per priority, used by the badge and panel.
export const PRIORITY_META = {
  red: {
    label: "Urgent",
    dot: "bg-red-500",
    ring: "ring-red-500",
    text: "text-red-300",
    chip: "bg-red-500/15 text-red-300 border border-red-500/40",
    header: "text-red-400",
  },
  yellow: {
    label: "Important",
    dot: "bg-amber-400",
    ring: "ring-amber-400",
    text: "text-amber-300",
    chip: "bg-amber-400/15 text-amber-200 border border-amber-400/40",
    header: "text-amber-300",
  },
  green: {
    label: "Informational",
    dot: "bg-emerald-500",
    ring: "ring-emerald-500",
    text: "text-emerald-300",
    chip: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40",
    header: "text-emerald-400",
  },
};

export const PRIORITY_ORDER = ["red", "yellow", "green"];

export function priorityForEvent(eventType, payload) {
  const override = payload && typeof payload === "object" ? payload.priority : null;
  if (override && Object.prototype.hasOwnProperty.call(PRIORITY_RANK, override)) {
    return override;
  }
  return EVENT_PRIORITY[eventType] || "yellow";
}

const ZERO_COUNTS = { red: 0, yellow: 0, green: 0, total: 0 };

// Sum two {red,yellow,green,total} count buckets (either may be null). Used to
// fold the general (non-brand) bucket into the active brand's tab badge so no
// notification is ever hidden.
export function mergeCounts(a, b) {
  const x = a || ZERO_COUNTS;
  const y = b || ZERO_COUNTS;
  return {
    red: (x.red || 0) + (y.red || 0),
    yellow: (x.yellow || 0) + (y.yellow || 0),
    green: (x.green || 0) + (y.green || 0),
    total: (x.total || 0) + (y.total || 0),
  };
}

// Stable ordering for a list of notification rows: red → yellow → green, then
// newest first within a tier.
export function sortByPriority(rows) {
  return [...rows].sort((a, b) => {
    const ra = PRIORITY_RANK[a.priority] ?? 1;
    const rb = PRIORITY_RANK[b.priority] ?? 1;
    if (ra !== rb) return ra - rb;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

// The color of the whole badge = its single highest-priority pending item.
export function topPriority(counts) {
  if (!counts) return null;
  if (counts.red > 0) return "red";
  if (counts.yellow > 0) return "yellow";
  if (counts.green > 0) return "green";
  return null;
}
