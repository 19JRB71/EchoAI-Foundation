/**
 * Goal metrics engine — computes the real, current value of every goal metric
 * from the live tables, builds a full progress object per goal (percent, trend,
 * projected end-of-month, status), and snapshots daily so trend + history exist.
 *
 * No metric fabricates data. Cumulative metrics report the month-to-date total
 * from their source table; 'latest' rate metrics report the most recent measured
 * value (or null when nothing has been measured yet).
 */

const db = require("../config/db");
const {
  getMetric,
  computePercent,
  clampScore,
  classifyProgress,
} = require("../config/goals");

/** UTC month window + day counters used for month-to-date + EOM projection. */
function monthWindow(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const dayOfMonth = now.getUTCDate(); // 1..daysInMonth (days elapsed incl. today)
  return { startIso: start.toISOString(), daysInMonth, dayOfMonth };
}

/**
 * Per-metric SQL. Each returns a single numeric `value`. `$1` = brandId,
 * `$2` = month-start ISO (used by cumulative metrics; ignored by 'latest' ones).
 */
const METRIC_SQL = {
  new_leads: `SELECT COUNT(*)::float AS value FROM leads
              WHERE brand_id = $1 AND created_at >= $2`,
  hot_leads: `SELECT COUNT(*)::float AS value FROM leads
              WHERE brand_id = $1 AND temperature = 'hot' AND created_at >= $2`,
  converted_leads: `SELECT COUNT(*)::float AS value FROM leads
              WHERE brand_id = $1 AND conversion_status = 'converted' AND created_at >= $2`,
  cost_per_lead: `SELECT cost_per_lead::float AS value FROM analytics
              WHERE brand_id = $1 AND cost_per_lead IS NOT NULL
              ORDER BY week_date DESC LIMIT 1`,
  roas: `SELECT return_on_ad_spend::float AS value FROM analytics
              WHERE brand_id = $1 AND return_on_ad_spend IS NOT NULL
              ORDER BY week_date DESC LIMIT 1`,
  revenue: `SELECT COALESCE(SUM(total_revenue), 0)::float AS value
              FROM roi_advanced_snapshots
              WHERE brand_id = $1 AND period_end >= $2`,
  posts_published: `SELECT COUNT(*)::float AS value FROM social_posts
              WHERE brand_id = $1 AND status = 'published' AND published_time >= $2`,
  appointments_booked: `SELECT COUNT(*)::float AS value FROM appointments
              WHERE brand_id = $1 AND created_at >= $2`,
  appointments_completed: `SELECT COUNT(*)::float AS value FROM appointments
              WHERE brand_id = $1 AND status = 'completed'
                AND start_time >= $2 AND start_time <= NOW()`,
  referrals: `SELECT COUNT(*)::float AS value
              FROM referrals r
              JOIN affiliates a ON a.affiliate_id = r.affiliate_id
              JOIN brands b ON b.user_id = a.user_id
              WHERE b.brand_id = $1 AND r.created_at >= $2`,
  commission: `SELECT COALESCE(SUM(r.commission_amount), 0)::float AS value
              FROM referrals r
              JOIN affiliates a ON a.affiliate_id = r.affiliate_id
              JOIN brands b ON b.user_id = a.user_id
              WHERE b.brand_id = $1 AND r.created_at >= $2`,
  ctr: `SELECT ctr::float AS value FROM analytics
              WHERE brand_id = $1 AND ctr IS NOT NULL
              ORDER BY week_date DESC LIMIT 1`,
  cpa: `SELECT (total_spend / conversions)::float AS value FROM analytics
              WHERE brand_id = $1 AND conversions > 0
              ORDER BY week_date DESC LIMIT 1`,
  // Political-campaign metrics (Voter CRM tables).
  voters_contacted: `SELECT COUNT(*)::float AS value FROM supporters
              WHERE brand_id = $1 AND supporter_type = 'voter' AND created_at >= $2`,
  volunteers_recruited: `SELECT COUNT(*)::float AS value FROM supporters
              WHERE brand_id = $1 AND supporter_type = 'volunteer' AND created_at >= $2`,
  donations_raised: `SELECT COALESCE(SUM(donation_amount), 0)::float AS value FROM supporters
              WHERE brand_id = $1 AND donation_amount IS NOT NULL AND created_at >= $2`,
  event_attendance: `SELECT COALESCE(SUM(attendance), 0)::float AS value FROM campaign_events
              WHERE brand_id = $1 AND attendance IS NOT NULL
                AND event_date >= $2::date AND event_date <= NOW()::date`,
  // Real-estate metrics (Property CRM tables).
  new_listings: `SELECT COUNT(*)::float AS value FROM property_listings
              WHERE brand_id = $1 AND created_at >= $2`,
  buyer_closings: `SELECT COUNT(*)::float AS value FROM property_leads
              WHERE brand_id = $1 AND lead_kind = 'buyer'
                AND converted_at IS NOT NULL AND converted_at >= $2`,
  avg_days_on_market: `SELECT AVG(GREATEST(sold_date - listed_date, 0))::float AS value
              FROM property_listings
              WHERE brand_id = $1 AND status = 'sold' AND sold_date IS NOT NULL
                AND sold_date >= (NOW()::date - INTERVAL '90 days')`,
  lead_response_minutes: `SELECT AVG(EXTRACT(EPOCH FROM (first_contact_at - created_at)) / 60)::float AS value
              FROM property_leads
              WHERE brand_id = $1 AND first_contact_at IS NOT NULL
                AND created_at >= (NOW() - INTERVAL '30 days')`,
  monthly_gci: `SELECT COALESCE(SUM(gci_amount), 0)::float AS value FROM property_listings
              WHERE brand_id = $1 AND status = 'sold' AND gci_amount IS NOT NULL
                AND sold_date >= $2::date`,
};

/**
 * Measures the current value of a single metric for a brand. Returns a number
 * for cumulative metrics (0 when there's no data) and a number-or-null for
 * 'latest' rate metrics (null = never measured).
 */
async function measureMetric(brandId, metricKey, win = monthWindow()) {
  const sql = METRIC_SQL[metricKey];
  const meta = getMetric(metricKey);
  if (!sql || !meta) return null;
  // 'latest' rate metrics only reference $1; passing an unused $2 makes
  // Postgres reject the bind ("supplies 2 parameters, but requires 1").
  // Bind exactly as many params as the SQL's highest $n placeholder.
  let arity = 0;
  for (const m of sql.matchAll(/\$(\d+)/g)) {
    arity = Math.max(arity, Number(m[1]));
  }
  const params = [brandId, win.startIso].slice(0, arity);
  const { rows } = await db.query(sql, params);
  const raw = rows[0] ? rows[0].value : null;
  if (raw == null) {
    // 'latest' rate metrics legitimately have no reading yet → null.
    return meta.aggregation === "latest" ? null : 0;
  }
  return Number(raw);
}

/** Linear month-to-date projection for cumulative metrics. */
function projectEom(currentValue, meta, win) {
  if (meta.aggregation !== "cumulative") return currentValue; // rate = flat
  if (currentValue == null) return null;
  if (win.dayOfMonth <= 0) return currentValue;
  return (currentValue / win.dayOfMonth) * win.daysInMonth;
}

/**
 * Builds the full progress object for one goal row (from brand_goals). Reads the
 * prior snapshot (yesterday-or-earlier) to compute the trend arrow.
 */
async function buildGoalProgress(goal, win = monthWindow()) {
  const meta = getMetric(goal.metric_key);
  const target = Number(goal.target_value);
  const current = await measureMetric(goal.brand_id, goal.metric_key, win);

  const percent = meta ? computePercent(current, target, meta.direction) : null;
  const projected = meta ? projectEom(current, meta, win) : current;
  const projectedPercent =
    meta && meta.aggregation === "cumulative"
      ? computePercent(projected, target, meta.direction)
      : percent;
  const status = classifyProgress(percent, projectedPercent);

  // Trend vs. the most recent earlier snapshot for this goal.
  let trend = "flat";
  let previousValue = null;
  try {
    const { rows } = await db.query(
      `SELECT current_value::float AS current_value
         FROM goal_snapshots
        WHERE goal_id = $1 AND snapshot_date < CURRENT_DATE
        ORDER BY snapshot_date DESC LIMIT 1`,
      [goal.goal_id]
    );
    if (rows[0]) {
      previousValue = Number(rows[0].current_value);
      const cur = current == null ? 0 : current;
      if (cur > previousValue) trend = "up";
      else if (cur < previousValue) trend = "down";
      // For 'decrease' metrics, "down" is good — the UI interprets direction.
    }
  } catch (err) {
    console.error("Goal trend lookup failed:", err.message);
  }

  return {
    goalId: goal.goal_id,
    brandId: goal.brand_id,
    metricKey: goal.metric_key,
    category: goal.category,
    label: goal.label || (meta ? meta.label : goal.metric_key),
    unit: meta ? meta.unit : "count",
    direction: meta ? meta.direction : "increase",
    aggregation: meta ? meta.aggregation : "cumulative",
    department: meta ? meta.department : null,
    targetValue: target,
    currentValue: current,
    percentToGoal: percent == null ? null : Math.round(percent * 10) / 10,
    projectedEom:
      projected == null ? null : Math.round(projected * 100) / 100,
    projectedPercent:
      projectedPercent == null ? null : Math.round(projectedPercent * 10) / 10,
    trend,
    previousValue,
    status,
    sortOrder: goal.sort_order,
    alertsMuted: goal.alerts_muted === true,
  };
}

/**
 * Loads all active goals for a brand and returns their progress objects plus a
 * 0–100 achievement score (mean of clamped percent across measurable goals).
 */
async function computeBrandGoals(brandId, win = monthWindow()) {
  const { rows } = await db.query(
    `SELECT goal_id, brand_id, category, metric_key, label, target_value,
            period, sort_order, status, alerts_muted
       FROM brand_goals
      WHERE brand_id = $1 AND status = 'active'
      ORDER BY sort_order ASC, created_at ASC`,
    [brandId]
  );

  const goals = [];
  for (const row of rows) {
    goals.push(await buildGoalProgress(row, win));
  }

  const measurable = goals.filter((g) => g.percentToGoal != null);
  const score = measurable.length
    ? Math.round(
        measurable.reduce((sum, g) => sum + clampScore(g.percentToGoal), 0) /
          measurable.length
      )
    : null;

  return { goals, score, goalCount: goals.length };
}

/**
 * Writes today's snapshot for every active goal of a brand (idempotent upsert on
 * (goal_id, snapshot_date)). Returns the computed progress so callers (the
 * scheduler / alert monitor) can act on it without recomputing.
 */
async function snapshotBrandGoals(brandId, win = monthWindow()) {
  const { goals, score } = await computeBrandGoals(brandId, win);
  const today = new Date().toISOString().slice(0, 10);

  for (const g of goals) {
    try {
      await db.query(
        `INSERT INTO goal_snapshots
           (goal_id, brand_id, snapshot_date, current_value, target_value,
            percent_to_goal, projected_eom)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (goal_id, snapshot_date)
         DO UPDATE SET current_value = EXCLUDED.current_value,
                       target_value = EXCLUDED.target_value,
                       percent_to_goal = EXCLUDED.percent_to_goal,
                       projected_eom = EXCLUDED.projected_eom`,
        [
          g.goalId,
          brandId,
          today,
          g.currentValue == null ? 0 : g.currentValue,
          g.targetValue,
          // Preserve no-data semantics: store NULL (not 0) when the goal has no
          // measurable reading, so the briefing/alerts don't treat it as 0% (a
          // real miss). Column is nullable as of migration 061.
          g.percentToGoal == null ? null : g.percentToGoal,
          g.projectedEom,
        ]
      );
    } catch (err) {
      console.error(`Goal snapshot failed for goal ${g.goalId}:`, err.message);
    }
  }

  return { goals, score };
}

module.exports = {
  monthWindow,
  measureMetric,
  buildGoalProgress,
  computeBrandGoals,
  snapshotBrandGoals,
};
