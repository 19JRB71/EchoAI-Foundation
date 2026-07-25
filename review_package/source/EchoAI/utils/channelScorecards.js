/**
 * Sage V2 Phase 6 — deterministic channel scorecards (§4).
 *
 * Pure arithmetic over the brand's own `analytics` weekly rows plus lead /
 * Phase 3 outcome counts per channel (first_touch). NO AI anywhere in this
 * path — the blueprint explicitly removed scorecard commentary.
 *
 * Honesty rules:
 *  - A metric that cannot be computed is null WITH a reason code, never 0.
 *  - `analytics` has no per-channel spend, so per-channel spend/cost-per-lead
 *    are null with reason 'no_per_channel_spend_data' — only the 'all'
 *    channel carries spend metrics. Nothing is apportioned or invented.
 *  - Every scorecard carries source_row_counts (weeks/leads backing it).
 *  - Week-over-week delta terms reuse the Phase 5 Change Diagnostics
 *    decomposition (one "why" engine, not two).
 *
 * Delivery: computed on read, cached in sage_channel_scorecards (short-lived,
 * recomputable at any time). Not a new weekly report (W6 preserved).
 */

const db = require("../config/db");
const { getSwitch } = require("../config/aiControls");
const { decomposeWeeks, weekStartOf } = require("./changeDiagnostics");
const { coverageForBrand } = require("./leadOutcome");

const CACHE_TTL_MINUTES = 60;
const TRAILING_WEEKS = 4;

function num(v) {
  // null/undefined/'' must stay null — Number(null) is 0, which would
  // fabricate a zero where the source reported nothing.
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

/** Trailing mean over a list of week rows for a numeric field (nulls skipped). */
function trailingMean(rows, field) {
  const vals = rows.map((r) => num(r[field])).filter((v) => v != null);
  if (!vals.length) return null;
  return round2(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/**
 * Pure computation of the 'all' channel scorecard from analytics rows
 * (newest first). Exported for tests.
 */
function computeAllChannelMetrics(rows) {
  if (!rows.length) {
    return {
      metrics: { unavailable: true, reason: "no_analytics_history" },
      sourceRowCounts: { analytics_weeks: 0 },
    };
  }
  const [curr, prev] = rows;
  const trailing = rows.slice(0, TRAILING_WEEKS);
  const spend = num(curr.total_spend);
  const leads = num(curr.total_leads);
  const costPerLead =
    num(curr.cost_per_lead) != null
      ? num(curr.cost_per_lead)
      : leads > 0 && spend != null
        ? round2(spend / leads)
        : null;
  const { terms, coverage } = decomposeWeeks(prev || null, curr || null);
  return {
    metrics: {
      week_start: String(curr.week_date).slice(0, 10),
      spend: round2(spend),
      leads,
      cost_per_lead: costPerLead,
      cost_per_lead_reason: costPerLead == null ? "no_leads_or_spend_this_week" : null,
      conversions: num(curr.conversions),
      roas: num(curr.return_on_ad_spend),
      roas_reason: num(curr.return_on_ad_spend) == null ? "not_reported_this_week" : null,
      trailing_avg: {
        weeks: trailing.length,
        spend: trailingMean(trailing, "total_spend"),
        leads: trailingMean(trailing, "total_leads"),
        cost_per_lead: trailingMean(trailing, "cost_per_lead"),
        conversions: trailingMean(trailing, "conversions"),
      },
      week_over_week: terms || null,
      week_over_week_coverage: coverage || null,
    },
    sourceRowCounts: { analytics_weeks: rows.length },
  };
}

/**
 * Pure computation of one lead-channel scorecard. Per-channel spend is
 * honestly null — analytics carries no channel dimension.
 */
function computeChannelMetrics(channelRow) {
  return {
    metrics: {
      leads_30d: Number(channelRow.leads_30d),
      leads_prev_30d: Number(channelRow.leads_prev_30d),
      outcomes: {
        won: Number(channelRow.won),
        lost: Number(channelRow.lost),
        measured: Number(channelRow.measured),
      },
      spend: null,
      spend_reason: "no_per_channel_spend_data",
      cost_per_lead: null,
      cost_per_lead_reason: "no_per_channel_spend_data",
    },
    sourceRowCounts: { leads_60d: Number(channelRow.leads_30d) + Number(channelRow.leads_prev_30d) },
  };
}

async function gatherChannelRows(brandId) {
  const { rows } = await db.query(
    `SELECT COALESCE(first_touch, 'unattributed') AS channel,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS leads_30d,
            COUNT(*) FILTER (WHERE created_at <= NOW() - INTERVAL '30 days'
                               AND created_at > NOW() - INTERVAL '60 days')::int AS leads_prev_30d,
            COUNT(*) FILTER (WHERE outcome = 'won')::int AS won,
            COUNT(*) FILTER (WHERE outcome IN ('lost','no_show','unqualified'))::int AS lost,
            COUNT(*) FILTER (WHERE outcome IS NOT NULL)::int AS measured
       FROM leads
      WHERE brand_id = $1 AND created_at > NOW() - INTERVAL '60 days'
      GROUP BY 1
      ORDER BY leads_30d DESC
      LIMIT 12`,
    [brandId],
  );
  return rows;
}

/**
 * Compute + cache scorecards for a brand. Returns { enabled, scorecards,
 * outcomeCoverage } or { enabled:false } when the flag is dark.
 */
async function getScorecards(brandId) {
  if (!(await getSwitch("SAGE_V2_SCORECARDS"))) return { enabled: false };
  const weekStart = weekStartOf();

  // Fresh cache? Serve it (recomputable at any time; TTL keeps reads cheap).
  const cached = await db.query(
    `SELECT channel, week_start, metrics, source_row_counts, computed_at
       FROM sage_channel_scorecards
      WHERE brand_id = $1 AND week_start = $2
        AND computed_at > NOW() - ($3 || ' minutes')::interval
      ORDER BY channel`,
    [brandId, weekStart, String(CACHE_TTL_MINUTES)],
  );
  const coverage = await coverageForBrand(brandId);
  if (cached.rows.length) {
    return { enabled: true, scorecards: cached.rows, outcomeCoverage: coverage, cached: true };
  }

  const [analyticsRes, channelRows] = await Promise.all([
    db.query(
      `SELECT week_date, total_spend, total_leads, cost_per_lead, conversions, return_on_ad_spend
         FROM analytics
        WHERE brand_id = $1
        ORDER BY week_date DESC
        LIMIT 8`,
      [brandId],
    ),
    gatherChannelRows(brandId),
  ]);

  const cards = [];
  const all = computeAllChannelMetrics(analyticsRes.rows);
  cards.push({ channel: "all", ...all });
  for (const row of channelRows) {
    cards.push({ channel: row.channel, ...computeChannelMetrics(row) });
  }

  for (const card of cards) {
    await db.query(
      `INSERT INTO sage_channel_scorecards (brand_id, channel, week_start, metrics, source_row_counts, computed_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, NOW())
       ON CONFLICT (brand_id, channel, week_start)
       DO UPDATE SET metrics = EXCLUDED.metrics,
                     source_row_counts = EXCLUDED.source_row_counts,
                     computed_at = NOW()`,
      [brandId, card.channel, weekStart, JSON.stringify(card.metrics), JSON.stringify(card.sourceRowCounts)],
    );
  }

  return {
    enabled: true,
    scorecards: cards.map((c) => ({
      channel: c.channel,
      week_start: weekStart,
      metrics: c.metrics,
      source_row_counts: c.sourceRowCounts,
      computed_at: new Date().toISOString(),
    })),
    outcomeCoverage: coverage,
    cached: false,
  };
}

module.exports = {
  getScorecards,
  computeAllChannelMetrics,
  computeChannelMetrics,
  trailingMean,
  CACHE_TTL_MINUTES,
  TRAILING_WEEKS,
};
