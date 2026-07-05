/**
 * Portfolio data layer — the Multi-Business Chief of Staff's single source of
 * truth for everything that spans MORE THAN ONE of an owner's businesses.
 *
 * CRITICAL INVARIANT: the demo brand (brands.is_demo = true — "Premier Auto
 * Group", migration 053) must NEVER appear in any portfolio total, health score,
 * card, briefing, or cross-business report. Every brand list here is produced by
 * realBrands()/queries that filter `is_demo = false`, so the exclusion happens at
 * the data-gathering layer, before anything reaches the AI or the UI.
 *
 * Health scores are computed DETERMINISTICALLY from real cross-channel activity
 * (not AI) so the daily snapshot job can never fail with a 502 and the 1-10 score
 * is reproducible. AI is used only for the weekly cross-business intelligence
 * report (see prompts/crossBusinessPrompt.js).
 */

const db = require("../config/db");
const { getPlan, computeMonthlyTotal } = require("../config/plans");

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/** Most recent Monday on or before the given date, as YYYY-MM-DD (UTC). */
function weekDateFor(date = new Date()) {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/**
 * The owner's REAL businesses (demo excluded), oldest first. This is the ONLY
 * approved way to enumerate brands for any multi-business feature.
 */
async function realBrands(userId) {
  const { rows } = await db.query(
    `SELECT brand_id, brand_name
     FROM brands
     WHERE user_id = $1 AND is_demo = false
     ORDER BY created_at ASC`,
    [userId],
  );
  return rows;
}

/** Distinct owner user_ids that have at least one real (non-demo) brand. */
async function ownersWithRealBrands() {
  const { rows } = await db.query(
    `SELECT DISTINCT user_id FROM brands WHERE is_demo = false`,
  );
  return rows.map((r) => r.user_id);
}

function statusForScore(score) {
  if (score >= 7) return "green";
  if (score >= 4) return "yellow";
  return "red";
}

/**
 * Deterministic 1-10 health score for one brand from its real activity. Returns
 * the overall score, its color status, and the sub-scores + raw signals behind
 * it (persisted as `factors` so drivers can be diffed day over day).
 */
async function computeHealthForBrand(brandId) {
  const now = new Date();
  const since7 = new Date(now.getTime() - 7 * 86400000).toISOString();
  const since14 = new Date(now.getTime() - 14 * 86400000).toISOString();

  const [leadsRow, campaignsRow, analyticsRow] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE created_at >= $2)::int AS last_7d,
              COUNT(*) FILTER (WHERE created_at >= $3 AND created_at < $2)::int AS prev_7d,
              COUNT(*) FILTER (WHERE temperature = 'hot')::int AS hot,
              COUNT(*) FILTER (WHERE conversion_status NOT IN ('converted','lost'))::int AS open,
              COUNT(*) FILTER (WHERE conversion_status = 'converted')::int AS converted
       FROM leads WHERE brand_id = $1`,
      [brandId, since7, since14],
    ),
    db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active
       FROM campaigns WHERE brand_id = $1`,
      [brandId],
    ),
    db.query(
      `SELECT COALESCE(AVG(return_on_ad_spend), 0)::numeric AS avg_roas,
              COUNT(*)::int AS weeks
       FROM analytics
       WHERE brand_id = $1 AND week_date >= (CURRENT_DATE - INTERVAL '28 days')`,
      [brandId],
    ),
  ]);

  const l = leadsRow.rows[0];
  const activeCampaigns = campaignsRow.rows[0].active;
  const avgRoas = Number(analyticsRow.rows[0].avg_roas) || 0;
  const roasWeeks = analyticsRow.rows[0].weeks;

  // Lead momentum (0-10): this week's volume, nudged by the week-over-week trend.
  let leadMomentum = clamp((l.last_7d / 15) * 10, 0, 10);
  if (l.prev_7d > 0) {
    if (l.last_7d > l.prev_7d) leadMomentum = clamp(leadMomentum + 1, 0, 10);
    else if (l.last_7d < l.prev_7d) leadMomentum = clamp(leadMomentum - 1, 0, 10);
  }

  // Conversion (0-10): lifetime converted / total, scaled (50%+ = full marks).
  const conversionRate = l.total > 0 ? l.converted / l.total : 0;
  const conversion = clamp(conversionRate * 20, 0, 10);

  // Campaign activity (0-10): are ads actually running?
  const campaignActivity = activeCampaigns > 0 ? clamp(4 + activeCampaigns * 2, 0, 10) : 1;

  // Pipeline heat (0-10): share of open leads that are hot. Neutral when empty.
  const pipelineHeat = l.open > 0 ? clamp((l.hot / l.open) * 10, 0, 10) : 5;

  // ROAS (0-10): ad return, scaled (4x = full marks). Neutral when no analytics.
  const roas = roasWeeks > 0 ? clamp((avgRoas / 4) * 10, 0, 10) : 5;

  const weighted =
    leadMomentum * 0.25 +
    conversion * 0.2 +
    campaignActivity * 0.15 +
    pipelineHeat * 0.15 +
    roas * 0.25;

  const score = round1(clamp(weighted, 1, 10));

  const factors = {
    leadMomentum: round2(leadMomentum),
    conversion: round2(conversion),
    campaignActivity: round2(campaignActivity),
    pipelineHeat: round2(pipelineHeat),
    roas: round2(roas),
    signals: {
      leadsLast7d: l.last_7d,
      leadsPrev7d: l.prev_7d,
      hotLeads: l.hot,
      openLeads: l.open,
      convertedLifetime: l.converted,
      conversionRatePct: round2(conversionRate * 100),
      activeCampaigns,
      avgRoas28d: round2(avgRoas),
    },
  };

  return { score, status: statusForScore(score), factors };
}

const FACTOR_LABELS = {
  leadMomentum: "lead momentum",
  conversion: "conversion rate",
  campaignActivity: "campaign activity",
  pipelineHeat: "pipeline heat",
  roas: "ad return (ROAS)",
};

/** Plain-English explanation of what moved the score vs the prior snapshot. */
function computeDrivers(prevRow, factors, score) {
  if (!prevRow) {
    return "First health snapshot recorded — this is the baseline to track from.";
  }
  const prevScore = Number(prevRow.health_score);
  const delta = round1(score - prevScore);
  if (Math.abs(delta) < 0.5) {
    return `Health held steady at ${score}/10 versus ${prevScore}/10 yesterday.`;
  }
  const prevFactors = (prevRow.factors && typeof prevRow.factors === "object") ? prevRow.factors : {};
  let biggestKey = null;
  let biggestChange = 0;
  for (const key of Object.keys(FACTOR_LABELS)) {
    const change = (Number(factors[key]) || 0) - (Number(prevFactors[key]) || 0);
    if (Math.abs(change) > Math.abs(biggestChange)) {
      biggestChange = change;
      biggestKey = key;
    }
  }
  const dir = delta > 0 ? "up" : "down";
  const base = `Health moved ${dir} to ${score}/10 from ${prevScore}/10.`;
  if (biggestKey && Math.abs(biggestChange) >= 0.5) {
    const moved = biggestChange > 0 ? "rose" : "fell";
    return `${base} The biggest driver was ${FACTOR_LABELS[biggestKey]}, which ${moved}.`;
  }
  return base;
}

/**
 * Computes today's health for a brand and upserts the daily snapshot, filling in
 * a plain-English `drivers` explanation relative to the prior snapshot. Returns
 * the persisted { score, status, factors, drivers }.
 */
async function snapshotHealth(brandId) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const { score, status, factors } = await computeHealthForBrand(brandId);

  const prev = await db.query(
    `SELECT health_score, factors FROM portfolio_health_scores
     WHERE brand_id = $1 AND score_date < $2
     ORDER BY score_date DESC LIMIT 1`,
    [brandId, dateStr],
  );
  const drivers = computeDrivers(prev.rows[0] || null, factors, score);

  await db.query(
    `INSERT INTO portfolio_health_scores (brand_id, score_date, health_score, status, factors, drivers)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (brand_id, score_date)
     DO UPDATE SET health_score = EXCLUDED.health_score,
                   status       = EXCLUDED.status,
                   factors      = EXCLUDED.factors,
                   drivers      = EXCLUDED.drivers`,
    [brandId, dateStr, score, status, JSON.stringify(factors), drivers],
  );

  return { score, status, factors, drivers, scoreDate: dateStr };
}

/** The latest stored health snapshot for a brand, or null. */
async function latestHealth(brandId) {
  const { rows } = await db.query(
    `SELECT score_date, health_score, status, factors, drivers
     FROM portfolio_health_scores
     WHERE brand_id = $1
     ORDER BY score_date DESC LIMIT 1`,
    [brandId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    scoreDate: r.score_date,
    score: Number(r.health_score),
    status: r.status,
    factors: r.factors || {},
    drivers: r.drivers,
  };
}

/** This-week snapshot numbers for a brand card: new leads (7d), revenue, ad spend. */
async function brandWeekMetrics(brandId) {
  const now = new Date();
  const since7 = new Date(now.getTime() - 7 * 86400000).toISOString();
  const [leadsRow, spendRow, revenueRow] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS n FROM leads WHERE brand_id = $1 AND created_at >= $2`,
      [brandId, since7],
    ),
    db.query(
      `SELECT total_spend FROM analytics WHERE brand_id = $1
       ORDER BY week_date DESC LIMIT 1`,
      [brandId],
    ),
    db.query(
      `SELECT total_revenue FROM roi_advanced_snapshots WHERE brand_id = $1
       ORDER BY period_end DESC LIMIT 1`,
      [brandId],
    ),
  ]);
  return {
    leads: leadsRow.rows[0].n,
    adSpend: spendRow.rows[0] ? round2(spendRow.rows[0].total_spend) : 0,
    revenue: revenueRow.rows[0] ? round2(revenueRow.rows[0].total_revenue) : 0,
  };
}

/** The single most pressing item for a brand (hot lead first, then a proposal). */
async function mostUrgentForBrand(brandId) {
  const hot = await db.query(
    `SELECT COUNT(*)::int AS n FROM leads WHERE brand_id = $1 AND temperature = 'hot'
       AND conversion_status NOT IN ('converted','lost')`,
    [brandId],
  );
  if (hot.rows[0].n > 0) {
    const n = hot.rows[0].n;
    return `${n} hot lead${n === 1 ? "" : "s"} waiting for follow-up`;
  }
  const proposal = await db.query(
    `SELECT title FROM growth_actions
     WHERE brand_id = $1 AND status = 'proposed'
     ORDER BY created_at DESC LIMIT 1`,
    [brandId],
  );
  if (proposal.rows[0]) return `Approval needed: ${proposal.rows[0].title}`;
  return null;
}

/**
 * EchoAI-as-a-business card (Part 7). The owner is also building EchoAI itself, so
 * it shows up in the portfolio alongside their client businesses — but only for
 * the platform owner/admin (a normal customer's EchoAI isn't "their" business).
 * Metrics come from real platform tables (users, subscriptions).
 */
async function echoBusinessCard() {
  const now = new Date();
  const since7 = new Date(now.getTime() - 7 * 86400000).toISOString();
  const since30 = new Date(now.getTime() - 30 * 86400000).toISOString();

  const [subsRow, signupRow, churnRow] = await Promise.all([
    // One active paying subscription per user, newest first (the current tier).
    db.query(
      `SELECT DISTINCT ON (s.user_id) s.user_id, s.subscription_tier, u.team_size
       FROM subscriptions s
       JOIN users u ON u.user_id = s.user_id
       WHERE s.payment_status = 'active' AND s.subscription_tier <> 'free'
       ORDER BY s.user_id, s.created_at DESC`,
    ),
    db.query(`SELECT COUNT(*)::int AS n FROM users WHERE created_at >= $1`, [since7]),
    db.query(
      `SELECT COUNT(DISTINCT user_id)::int AS n FROM subscriptions
       WHERE payment_status = 'canceled' AND updated_at >= $1`,
      [since30],
    ),
  ]);

  let mrr = 0;
  const tierCounts = {};
  for (const s of subsRow.rows) {
    if (!getPlan(s.subscription_tier)) continue;
    mrr += computeMonthlyTotal(s.subscription_tier, s.team_size);
    tierCounts[s.subscription_tier] = (tierCounts[s.subscription_tier] || 0) + 1;
  }

  return {
    isEcho: true,
    brandId: null,
    name: "EchoAI (your platform)",
    metrics: {
      payingCustomers: subsRow.rows.length,
      mrr: round2(mrr),
      newSignups7d: signupRow.rows[0].n,
      churned30d: churnRow.rows[0].n,
      tierCounts,
    },
  };
}

/**
 * The unified portfolio overview (Parts 1 + 7): one card per real business, a
 * portfolio summary, the unified approval queue, and the unified hot-lead list —
 * all with the demo brand excluded. When `isAdmin`, EchoAI-as-a-business is
 * appended.
 */
async function gatherPortfolioOverview(userId, { isAdmin = false } = {}) {
  const brands = await realBrands(userId);

  const businesses = await Promise.all(
    brands.map(async (b) => {
      const [health, week, urgent] = await Promise.all([
        latestHealth(b.brand_id),
        brandWeekMetrics(b.brand_id),
        mostUrgentForBrand(b.brand_id),
      ]);
      return {
        isEcho: false,
        brandId: b.brand_id,
        name: b.brand_name,
        health: health ? { score: health.score, status: health.status, drivers: health.drivers } : null,
        week,
        mostUrgent: urgent,
      };
    }),
  );

  const [approvalsRes, hotLeadsRes] = await Promise.all([
    db.query(
      `SELECT ga.action_id, ga.brand_id, ga.agent, ga.kind, ga.risk, ga.title,
              ga.detail, ga.created_at, b.brand_name
       FROM growth_actions ga
       LEFT JOIN brands b ON b.brand_id = ga.brand_id
       WHERE ga.user_id = $1 AND ga.status = 'proposed'
         AND (ga.brand_id IS NULL OR b.is_demo = false)
       ORDER BY ga.created_at DESC LIMIT 50`,
      [userId],
    ),
    db.query(
      `SELECT l.lead_id, l.lead_name, l.email, l.phone, l.created_at,
              b.brand_id, b.brand_name
       FROM leads l
       JOIN brands b ON b.brand_id = l.brand_id
       WHERE b.user_id = $1 AND b.is_demo = false AND l.temperature = 'hot'
         AND l.conversion_status NOT IN ('converted','lost')
       ORDER BY l.created_at DESC LIMIT 50`,
      [userId],
    ),
  ]);

  const approvals = approvalsRes.rows.map((r) => ({
    actionId: r.action_id,
    brandId: r.brand_id,
    brandName: r.brand_name || null,
    agent: r.agent,
    kind: r.kind,
    risk: r.risk,
    title: r.title,
    detail: r.detail,
    createdAt: r.created_at,
  }));

  const hotLeads = hotLeadsRes.rows.map((r) => ({
    leadId: r.lead_id,
    brandId: r.brand_id,
    brandName: r.brand_name,
    name: r.lead_name,
    email: r.email,
    phone: r.phone,
    createdAt: r.created_at,
  }));

  const scored = businesses.filter((x) => x.health && Number.isFinite(x.health.score));
  const summary = {
    businessCount: businesses.length,
    totalLeadsWeek: businesses.reduce((s, x) => s + (x.week.leads || 0), 0),
    totalRevenueWeek: round2(businesses.reduce((s, x) => s + (x.week.revenue || 0), 0)),
    totalAdSpend: round2(businesses.reduce((s, x) => s + (x.week.adSpend || 0), 0)),
    avgHealth: scored.length
      ? round1(scored.reduce((s, x) => s + x.health.score, 0) / scored.length)
      : null,
    hotLeadCount: hotLeads.length,
    pendingApprovals: approvals.length,
  };

  const echoBusiness = isAdmin ? await echoBusinessCard() : null;

  return { businesses, summary, approvals, hotLeads, echoBusiness };
}

/**
 * Compact per-business snapshot array for the cross-business AI prompt. Real
 * brands only; includes health + week metrics + lifetime lead/conversion signal.
 */
async function portfolioBusinessesForAI(userId) {
  const brands = await realBrands(userId);
  return Promise.all(
    brands.map(async (b) => {
      const [health, week, lifetime] = await Promise.all([
        latestHealth(b.brand_id),
        brandWeekMetrics(b.brand_id),
        db.query(
          `SELECT COUNT(*)::int AS total_leads,
                  COUNT(*) FILTER (WHERE conversion_status = 'converted')::int AS converted,
                  COUNT(*) FILTER (WHERE temperature = 'hot')::int AS hot
           FROM leads WHERE brand_id = $1`,
          [b.brand_id],
        ),
      ]);
      const audience = await db.query(
        `SELECT brand_personality, target_audience FROM brands WHERE brand_id = $1`,
        [b.brand_id],
      );
      const a = audience.rows[0] || {};
      return {
        name: b.brand_name,
        healthScore: health ? health.score : null,
        healthStatus: health ? health.status : null,
        newLeads7d: week.leads,
        revenueLatest: week.revenue,
        adSpendLatest: week.adSpend,
        totalLeads: lifetime.rows[0].total_leads,
        convertedLeads: lifetime.rows[0].converted,
        hotLeads: lifetime.rows[0].hot,
        brandPersonality: a.brand_personality || null,
        targetAudience: a.target_audience || null,
      };
    }),
  );
}

/**
 * 12-week health trajectory per real business plus the portfolio average per
 * week. Uses the latest snapshot within each of the last 12 ISO weeks.
 */
async function healthTrajectory(userId) {
  const brands = await realBrands(userId);
  const perBrand = await Promise.all(
    brands.map(async (b) => {
      const { rows } = await db.query(
        `SELECT DISTINCT ON (date_trunc('week', score_date))
                date_trunc('week', score_date)::date AS week,
                health_score, status
         FROM portfolio_health_scores
         WHERE brand_id = $1 AND score_date >= (CURRENT_DATE - INTERVAL '84 days')
         ORDER BY date_trunc('week', score_date), score_date DESC`,
        [b.brand_id],
      );
      return {
        brandId: b.brand_id,
        name: b.brand_name,
        points: rows.map((r) => ({
          week: r.week,
          score: Number(r.health_score),
          status: r.status,
        })),
      };
    }),
  );

  // Portfolio average per week across whatever brands have a point that week.
  const byWeek = {};
  for (const brand of perBrand) {
    for (const p of brand.points) {
      const key = p.week instanceof Date ? p.week.toISOString().slice(0, 10) : String(p.week);
      if (!byWeek[key]) byWeek[key] = [];
      byWeek[key].push(p.score);
    }
  }
  const portfolioAverage = Object.keys(byWeek)
    .sort()
    .map((week) => ({
      week,
      score: round1(byWeek[week].reduce((s, n) => s + n, 0) / byWeek[week].length),
    }));

  return { perBrand, portfolioAverage };
}

module.exports = {
  weekDateFor,
  realBrands,
  ownersWithRealBrands,
  computeHealthForBrand,
  snapshotHealth,
  latestHealth,
  brandWeekMetrics,
  mostUrgentForBrand,
  echoBusinessCard,
  gatherPortfolioOverview,
  portfolioBusinessesForAI,
  healthTrajectory,
  statusForScore,
};
