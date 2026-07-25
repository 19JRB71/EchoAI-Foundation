/**
 * Sage V2 Phase 6 — honest deterministic forecasts (§5).
 *
 * Range forecasts (low / expected / high) from the brand's OWN weekly
 * analytics history: trailing mean + linear trend projection, band = observed
 * week-to-week variance (stddev of residuals). No AI generates or adjusts any
 * number.
 *
 * Hard minimum-history rule: a metric needs ≥ MIN_WEEKS (8) weekly data
 * points, else the answer is { sufficient:false, weeks_available,
 * weeks_needed } — nothing stored, nothing invented.
 *
 * Every stored forecast carries basis JSONB: { method, weeks_of_history,
 * variance_observed, assumptions[] } so the owner can see exactly why the
 * range is what it is. Surfaces label it "Estimated range from your own
 * history" (Phase 1 ROI-label convention).
 */

const db = require("../config/db");
const { getSwitch } = require("../config/aiControls");

const MIN_WEEKS = 8;
const HISTORY_WEEKS = 26;
const HORIZON_WEEKS = 4;
const METRICS = [
  { key: "leads", column: "total_leads", nonNegative: true },
  { key: "spend", column: "total_spend", nonNegative: true },
  { key: "cost_per_lead", column: "cost_per_lead", nonNegative: true },
  { key: "conversions", column: "conversions", nonNegative: true },
];

function round2(v) {
  return Math.round(v * 100) / 100;
}

/**
 * Pure forecast over a chronological series (oldest → newest) of numbers.
 * Least-squares linear trend; expected = projection HORIZON_WEEKS ahead of
 * the last point (average over the horizon midpoint); band = stddev of
 * residuals. Exported for tests.
 * Returns { sufficient:false, ... } below MIN_WEEKS.
 */
function forecastSeries(series, { nonNegative = true, horizonWeeks = HORIZON_WEEKS } = {}) {
  const vals = series.filter((v) => Number.isFinite(Number(v))).map(Number);
  if (vals.length < MIN_WEEKS) {
    return { sufficient: false, weeks_available: vals.length, weeks_needed: MIN_WEEKS };
  }
  const n = vals.length;
  const xs = vals.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = vals.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - meanX) ** 2;
    sxy += (xs[i] - meanX) * (vals[i] - meanY);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = meanY - slope * meanX;

  // Residual stddev = observed week-to-week variance around the trend.
  let ssr = 0;
  for (let i = 0; i < n; i++) {
    ssr += (vals[i] - (intercept + slope * xs[i])) ** 2;
  }
  const residualStd = Math.sqrt(ssr / Math.max(1, n - 2));

  // Project to the midpoint of the horizon window ahead of the last week.
  const targetX = n - 1 + (horizonWeeks + 1) / 2;
  let expected = intercept + slope * targetX;
  if (nonNegative) expected = Math.max(0, expected);
  let low = expected - residualStd;
  let high = expected + residualStd;
  if (nonNegative) low = Math.max(0, low);
  // Invariant the DB CHECK also enforces: low ≤ expected ≤ high.
  low = Math.min(low, expected);
  high = Math.max(high, expected);

  return {
    sufficient: true,
    low: round2(low),
    expected: round2(expected),
    high: round2(high),
    basis: {
      method: "trailing_linear_trend_v1",
      weeks_of_history: n,
      variance_observed: round2(residualStd),
      assumptions: [
        "Assumes recent weekly trend continues; no seasonality modeled in v1.",
        "Range is the observed week-to-week variance around your own trend.",
        `Projection covers the next ${horizonWeeks} weeks.`,
      ],
    },
  };
}

/**
 * Compute (and cache when sufficient) forecasts for all metrics.
 * Returns { enabled:false } when dark.
 */
async function getForecasts(brandId) {
  if (!(await getSwitch("SAGE_V2_FORECASTS"))) return { enabled: false };
  const { rows } = await db.query(
    `SELECT week_date, total_leads, total_spend, cost_per_lead, conversions
       FROM analytics
      WHERE brand_id = $1
      ORDER BY week_date ASC
      LIMIT ${HISTORY_WEEKS}`,
    [brandId],
  );

  const forecasts = {};
  for (const m of METRICS) {
    const series = rows.map((r) => (r[m.column] == null ? null : Number(r[m.column])));
    const f = forecastSeries(series, { nonNegative: m.nonNegative });
    forecasts[m.key] = { ...f, horizon_weeks: HORIZON_WEEKS };
    if (f.sufficient) {
      await db.query(
        `INSERT INTO sage_forecasts (brand_id, metric, horizon_weeks, low, expected, high, basis, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
         ON CONFLICT (brand_id, metric, horizon_weeks)
         DO UPDATE SET low = EXCLUDED.low, expected = EXCLUDED.expected,
                       high = EXCLUDED.high, basis = EXCLUDED.basis, computed_at = NOW()`,
        [brandId, m.key, HORIZON_WEEKS, f.low, f.expected, f.high, JSON.stringify(f.basis)],
      );
    }
  }
  return { enabled: true, forecasts, label: "Estimated range from your own history" };
}

module.exports = { getForecasts, forecastSeries, MIN_WEEKS, HORIZON_WEEKS };
