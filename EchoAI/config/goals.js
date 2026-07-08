/**
 * Target Goals registry — the single source of truth for the KPI/goal system
 * (Prompt 67). Defines every measurable metric a brand can set a goal on, the
 * goal categories, the brand-type → category mapping, and the shared math for
 * "% to goal" and the 0–100 achievement score.
 *
 * The client mirrors the display-relevant parts of this in
 * `client/src/lib/goals.js` — keep the two in sync.
 *
 * Design notes:
 *  - `direction`: 'increase' means higher is better (leads, revenue, ROAS);
 *    'decrease' means lower is better (cost per lead).
 *  - `aggregation`: 'cumulative' metrics accumulate over the month (counts,
 *    revenue) so they get a month-to-date current value + a linear projected
 *    end-of-month; 'latest' metrics are rate snapshots (CPL, ROAS) whose current
 *    value is the most recent measured value and whose projection is flat.
 *  - `department`: which agent department dashboard surfaces this goal.
 *  - No metric fabricates data: every metric maps to a real table. Metrics with
 *    no data yet simply report a current value of 0 (or null for latest rates).
 */

// Goal categories (denormalized onto brand_goals.category for cheap filtering).
const CATEGORIES = {
  lead: "Leads",
  campaign: "Campaigns",
  revenue: "Revenue",
  content: "Content",
  appointment: "Appointments",
  affiliate: "Affiliate",
  voter: "Voter Outreach",
  realty: "Real Estate",
};

// Every metric a goal can target. Keyed by metric_key.
const GOAL_METRICS = {
  new_leads: {
    label: "New Leads",
    category: "lead",
    unit: "count",
    direction: "increase",
    aggregation: "cumulative",
    department: "pulse",
    description: "Total new leads captured this month.",
  },
  hot_leads: {
    label: "Hot Leads",
    category: "lead",
    unit: "count",
    direction: "increase",
    aggregation: "cumulative",
    department: "pulse",
    description: "Leads scored hot this month.",
  },
  converted_leads: {
    label: "Converted Leads",
    category: "lead",
    unit: "count",
    direction: "increase",
    aggregation: "cumulative",
    department: "pulse",
    description: "Leads marked converted this month.",
  },
  cost_per_lead: {
    label: "Cost Per Lead",
    category: "campaign",
    unit: "currency",
    direction: "decrease",
    aggregation: "latest",
    department: "atlas",
    description: "Most recent weekly cost per lead across campaigns.",
  },
  roas: {
    label: "Return on Ad Spend",
    category: "campaign",
    unit: "ratio",
    direction: "increase",
    aggregation: "latest",
    department: "atlas",
    description: "Most recent weekly return on ad spend.",
  },
  revenue: {
    label: "Revenue",
    category: "revenue",
    unit: "currency",
    direction: "increase",
    aggregation: "cumulative",
    department: "atlas",
    description: "Revenue recorded this month (from ROI tracking).",
  },
  posts_published: {
    label: "Posts Published",
    category: "content",
    unit: "count",
    direction: "increase",
    aggregation: "cumulative",
    department: "nova",
    description: "Social posts published this month.",
  },
  appointments_booked: {
    label: "Appointments Booked",
    category: "appointment",
    unit: "count",
    direction: "increase",
    aggregation: "cumulative",
    department: "pulse",
    description: "Appointments booked this month.",
  },
  appointments_completed: {
    label: "Appointments Completed",
    category: "appointment",
    unit: "count",
    direction: "increase",
    aggregation: "cumulative",
    department: "pulse",
    description: "Appointments that took place this month.",
  },
  referrals: {
    label: "New Referrals",
    category: "affiliate",
    unit: "count",
    direction: "increase",
    aggregation: "cumulative",
    department: "atlas",
    description: "New affiliate referrals this month.",
  },
  commission: {
    label: "Affiliate Commission",
    category: "affiliate",
    unit: "currency",
    direction: "increase",
    aggregation: "cumulative",
    department: "atlas",
    description: "Affiliate commission earned this month.",
  },
  // Affiliate ad-efficiency metrics. Affiliate brands drive traffic to an offer,
  // so Atlas steers their optimization by click-through rate and cost per
  // acquisition (not cost-per-lead / ROAS). Both are 'latest' weekly rates.
  ctr: {
    label: "Click-Through Rate",
    category: "affiliate",
    unit: "percent",
    direction: "increase",
    aggregation: "latest",
    department: "atlas",
    description: "Most recent weekly ad click-through rate.",
  },
  cpa: {
    label: "Cost Per Acquisition",
    category: "affiliate",
    unit: "currency",
    direction: "decrease",
    aggregation: "latest",
    department: "atlas",
    description: "Most recent weekly cost per acquisition (spend ÷ conversions).",
  },
  // Political-campaign metrics. All sourced from the Voter CRM tables
  // (supporters, campaign_events) — nothing fabricated.
  voters_contacted: {
    label: "Voters Reached",
    category: "voter",
    unit: "count",
    direction: "increase",
    aggregation: "cumulative",
    department: "pulse",
    description: "New voter contacts added to the Voter CRM this month.",
  },
  volunteers_recruited: {
    label: "Volunteers Recruited",
    category: "voter",
    unit: "count",
    direction: "increase",
    aggregation: "cumulative",
    department: "pulse",
    description: "New volunteers added this month.",
  },
  donations_raised: {
    label: "Donations Raised",
    category: "voter",
    unit: "currency",
    direction: "increase",
    aggregation: "cumulative",
    department: "pulse",
    description: "Donation dollars recorded for supporters added this month.",
  },
  event_attendance: {
    label: "Event Attendance",
    category: "voter",
    unit: "count",
    direction: "increase",
    aggregation: "cumulative",
    department: "pulse",
    description: "Total attendance recorded at campaign events this month.",
  },
  // Real-estate metrics. All sourced from the Property CRM tables
  // (property_listings, property_leads) — nothing fabricated.
  new_listings: {
    label: "New Listings",
    category: "realty",
    unit: "count",
    direction: "increase",
    aggregation: "cumulative",
    department: "pulse",
    description: "New listings added this month.",
  },
  buyer_closings: {
    label: "Buyer Closings",
    category: "realty",
    unit: "count",
    direction: "increase",
    aggregation: "cumulative",
    department: "pulse",
    description: "Buyer leads marked converted (closed) this month.",
  },
  avg_days_on_market: {
    label: "Avg Days on Market",
    category: "realty",
    unit: "count",
    direction: "decrease",
    aggregation: "latest",
    department: "pulse",
    description: "Average days on market across listings sold in the last 90 days.",
  },
  lead_response_minutes: {
    label: "Lead Response Time (min)",
    category: "realty",
    unit: "count",
    direction: "decrease",
    aggregation: "latest",
    department: "pulse",
    description:
      "Average minutes from a property lead arriving to first contact (last 30 days).",
  },
  monthly_gci: {
    label: "Gross Commission Income",
    category: "realty",
    unit: "currency",
    direction: "increase",
    aggregation: "cumulative",
    department: "pulse",
    description: "Commission income recorded on listings sold this month.",
  },
};

// Brand types decide which categories (and therefore which metrics) are offered.
const BRAND_TYPES = {
  standard: {
    label: "Standard Business",
    description: "Ads, leads, content, and appointments.",
    categories: ["lead", "campaign", "revenue", "content", "appointment"],
  },
  affiliate: {
    label: "Affiliate / Referral",
    description: "Referral-driven — track referrals and commission.",
    categories: ["lead", "content", "affiliate", "revenue"],
  },
  ecommerce: {
    label: "E-commerce",
    description: "Online store — ads, revenue, leads, and content.",
    categories: ["lead", "campaign", "revenue", "content"],
  },
  service: {
    label: "Service / Appointments",
    description: "Booking-driven — emphasize appointments and leads.",
    categories: ["lead", "appointment", "revenue", "content"],
  },
  restaurant: {
    label: "Restaurant / Hospitality",
    description: "Reservations, foot traffic, and content.",
    categories: ["lead", "appointment", "content", "revenue"],
  },
  political: {
    label: "Political Campaign",
    description: "Voter outreach, volunteers, donations, and campaign content.",
    categories: ["voter", "campaign", "content", "appointment"],
  },
  real_estate: {
    label: "Real Estate Agent",
    description: "Listings, buyer/seller leads, days on market, and GCI.",
    categories: ["realty", "lead", "campaign", "content", "appointment"],
  },
};

const DEFAULT_BRAND_TYPE = "standard";

// Which goal categories each department dashboard surfaces.
const DEPARTMENT_CATEGORIES = {
  atlas: ["campaign"],
  nova: ["content"],
  pulse: ["lead", "appointment"],
  roi: ["revenue"],
};

function isValidBrandType(type) {
  return Object.prototype.hasOwnProperty.call(BRAND_TYPES, type);
}

function getMetric(metricKey) {
  return GOAL_METRICS[metricKey] || null;
}

function isValidMetric(metricKey) {
  return Object.prototype.hasOwnProperty.call(GOAL_METRICS, metricKey);
}

/** Categories relevant to a brand type (falls back to the standard set). */
function categoriesForBrandType(type) {
  const bt = BRAND_TYPES[type] || BRAND_TYPES[DEFAULT_BRAND_TYPE];
  return bt.categories.slice();
}

/** Metric keys offered for a brand type. */
function metricsForBrandType(type) {
  const cats = new Set(categoriesForBrandType(type));
  return Object.keys(GOAL_METRICS).filter((key) =>
    cats.has(GOAL_METRICS[key].category)
  );
}

/** True when a metric is allowed for a brand type. */
function metricAllowedForBrandType(metricKey, type) {
  const metric = GOAL_METRICS[metricKey];
  if (!metric) return false;
  return categoriesForBrandType(type).includes(metric.category);
}

/**
 * Percent toward a goal (0..∞, uncapped so overachievement is visible).
 * Returns null when there is no measurable basis (e.g. a 'decrease' rate goal
 * with no current data). For a 'decrease' goal, hitting-or-below target is 100%+.
 */
function computePercent(current, target, direction) {
  const t = Number(target);
  const c = Number(current);
  if (!Number.isFinite(c) || !Number.isFinite(t)) return null;

  if (direction === "decrease") {
    // Lower is better. No current reading (0/none) → not measurable yet.
    if (c <= 0) return null;
    if (t <= 0) return 0;
    return (t / c) * 100;
  }
  // increase: higher is better.
  if (t <= 0) return c > 0 ? 100 : 0;
  return (c / t) * 100;
}

/** Clamp a percent into the 0–100 range used for the achievement score. */
function clampScore(percent) {
  if (percent == null || !Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, percent));
}

// Progress buckets used for alerts + UI coloring.
const STATUS_HIT = "hit"; // >= 100%
const STATUS_EXCEEDING = "exceeding"; // >= 115%
const STATUS_ON_TRACK = "on_track"; // projected to hit
const STATUS_AT_RISK = "at_risk"; // behind pace
const STATUS_NO_DATA = "no_data";

/**
 * Classify a goal's progress from its percent-to-goal and projected percent.
 * `projectedPercent` is percent-to-goal computed from the projected EOM value;
 * for 'latest' rate goals pass the same as `percent`.
 */
function classifyProgress(percent, projectedPercent) {
  if (percent == null) return STATUS_NO_DATA;
  if (percent >= 115) return STATUS_EXCEEDING;
  if (percent >= 100) return STATUS_HIT;
  const proj = projectedPercent == null ? percent : projectedPercent;
  if (proj >= 90) return STATUS_ON_TRACK;
  return STATUS_AT_RISK;
}

/** Round a raw suggested target to a clean, human-friendly number by unit. */
function roundNiceTarget(n, unit) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  if (unit === "ratio" || unit === "percent") {
    return Math.round(v * 10) / 10; // one decimal (ROAS, CTR)
  }
  // currency + count share the same "nice number" ladder.
  if (v >= 100) return Math.round(v / 10) * 10;
  if (v >= 20) return Math.round(v / 5) * 5;
  return Math.round(v);
}

/**
 * When a goal has been met, suggest a more ambitious target for next cycle so
 * Echo can challenge the owner to aim higher. Returns a rounded number (the new
 * target) or null when a raise isn't warranted — the goal isn't met yet, there's
 * no measurable reading, or the ambitious target wouldn't be meaningfully
 * different from the current one.
 *
 * `progress` is a goal progress object (see utils/goalMetrics.buildGoalProgress):
 * { direction, aggregation, unit, currentValue, targetValue, projectedEom,
 * percentToGoal }.
 */
function suggestRaisedTarget(progress) {
  if (!progress) return null;
  const target = Number(progress.targetValue);
  const current = Number(progress.currentValue);
  const pct = progress.percentToGoal == null ? null : Number(progress.percentToGoal);
  if (!Number.isFinite(target) || target <= 0) return null;
  if (!Number.isFinite(current)) return null;
  // Only challenge higher once the goal is actually met (>= 100% of target).
  if (pct == null || !Number.isFinite(pct) || pct < 100) return null;

  const direction = progress.direction === "decrease" ? "decrease" : "increase";

  if (direction === "increase") {
    // Basis: the month-to-date pace (projected end-of-month) for cumulative
    // metrics captures "at this rate you'll reach X" — the natural next target.
    // Rate metrics (no projection) stretch up from the current beat.
    const projected =
      progress.aggregation === "cumulative" && Number.isFinite(Number(progress.projectedEom))
        ? Number(progress.projectedEom)
        : current;
    const basis = Math.max(projected, current, target);
    // Aim at least 10% above the old target; never suggest a lower number.
    const raised = Math.max(basis, target * 1.1);
    const nice = roundNiceTarget(raised, progress.unit);
    return nice != null && nice > target ? nice : null;
  }

  // decrease (lower is better): a more ambitious target is a lower one. Tighten
  // ~10% below the current (already at/below target) reading.
  if (current <= 0) return null;
  const tightened = Math.min(current, target) * 0.9;
  const nice = roundNiceTarget(tightened, progress.unit);
  return nice != null && nice > 0 && nice < target ? nice : null;
}

module.exports = {
  CATEGORIES,
  GOAL_METRICS,
  BRAND_TYPES,
  DEFAULT_BRAND_TYPE,
  DEPARTMENT_CATEGORIES,
  isValidBrandType,
  getMetric,
  isValidMetric,
  categoriesForBrandType,
  metricsForBrandType,
  metricAllowedForBrandType,
  computePercent,
  clampScore,
  classifyProgress,
  roundNiceTarget,
  suggestRaisedTarget,
  STATUS_HIT,
  STATUS_EXCEEDING,
  STATUS_ON_TRACK,
  STATUS_AT_RISK,
  STATUS_NO_DATA,
};
