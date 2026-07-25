/**
 * Sage V2 P1 — the consolidated weekly Sage briefing (SAGE_V2_WEEKLY_BRIEFING
 * flag, default OFF) and the "flying blind" context stats.
 *
 * ONE customer-facing weekly output that absorbs the overlapping Monday
 * reports: it aggregates the rows the existing Monday stack already wrote
 * (analytics, Customer Intelligence, ROI snapshot, Autopilot batch, competitor
 * ad report, feedback report) into a single sectioned briefing. Deterministic —
 * NO new AI calls; sections whose source report is missing are recorded
 * honestly as unavailable, never fabricated.
 *
 * Customer-facing wording comes from config/briefingCopy.js which is DRAFT
 * placeholder copy pending Creative-Director approval; nothing renders while
 * the flag is off.
 */

const db = require("../config/db");
const { getSwitch } = require("../config/aiControls");
const { WEEKLY_BRIEFING_COPY, FLYING_BLIND_COPY } = require("../config/briefingCopy");
const { getFlyingBlindStats } = require("../utils/companyContext");

function sendError(res, err, message) {
  console.error(`${message}:`, err.message);
  const status = err.statusCode || 500;
  return res.status(status).json({ error: message });
}

async function getOwnedBrand(userId, brandId) {
  if (!brandId) return null;
  const { rows } = await db.query(
    "SELECT * FROM brands WHERE brand_id = $1 AND user_id = $2",
    [brandId, userId],
  );
  return rows[0] || null;
}

/** ISO week id (e.g. "2026-W29") and the Monday date of that week, in UTC. */
function isoWeekOf(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() - (day - 1)); // back to Monday
  const monday = new Date(d);
  const thursday = new Date(d);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
  return {
    isoWeek: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`,
    monday,
  };
}

const num = (v) => (v == null ? null : Number(v));

/**
 * Build (or rebuild is NOT allowed — claim is per ISO week) the consolidated
 * briefing for one brand. Called by the Monday stack after every source report
 * has run. Atomic claim on (brand_id, iso_week): overlapping ticks can't
 * double-build. No-op when the flag is off.
 */
async function buildWeeklyBriefingForBrand(brand) {
  if (!(await getSwitch("SAGE_V2_WEEKLY_BRIEFING"))) return null;
  const { isoWeek, monday } = isoWeekOf();
  const claim = await db.query(
    `INSERT INTO sage_weekly_briefings (brand_id, iso_week, status)
     VALUES ($1, $2, 'generating')
     ON CONFLICT (brand_id, iso_week) DO NOTHING
     RETURNING briefing_id`,
    [brand.brand_id, isoWeek],
  );
  if (!claim.rows.length) return null; // already built/building this week
  const briefingId = claim.rows[0].briefing_id;

  try {
    const since = new Date(monday);
    since.setUTCDate(since.getUTCDate() - 7); // include reports covering the prior week
    const brandId = brand.brand_id;

    // Every source read is best-effort against rows the Monday stack already
    // wrote; a missing row means "unavailable", never an error.
    const [analytics, intel, roi, autopilot, competitors, feedback] = await Promise.all([
      db.query(
        `SELECT total_spend, total_leads, cost_per_lead, conversions,
                return_on_ad_spend, week_date
           FROM analytics WHERE brand_id = $1 AND week_date >= $2
          ORDER BY week_date DESC LIMIT 1`,
        [brandId, since],
      ),
      db.query(
        `SELECT trajectory_score, ai_analysis, recommendations
           FROM customer_intelligence WHERE brand_id = $1 AND week_date >= $2
          ORDER BY week_date DESC LIMIT 1`,
        [brandId, since],
      ),
      db.query(
        `SELECT total_spend, total_revenue, total_leads, roi_percentage, ai_analysis
           FROM roi_advanced_snapshots WHERE brand_id = $1 AND period_end >= $2
          ORDER BY period_end DESC LIMIT 1`,
        [brandId, since],
      ),
      db.query(
        `SELECT status, created_at FROM autopilot_batches
          WHERE brand_id = $1 ORDER BY week_start DESC LIMIT 1`,
        [brandId],
      ),
      db.query(
        `SELECT summary, recommendations FROM competitor_ad_reports
          WHERE brand_id = $1 AND week_date >= $2
          ORDER BY week_date DESC LIMIT 1`,
        [brandId, since],
      ),
      db.query(
        `SELECT total_responses, average_sentiment, full_report
           FROM feedback_reports WHERE brand_id = $1 AND created_at >= $2
          ORDER BY created_at DESC LIMIT 1`,
        [brandId, since],
      ),
    ]);

    const C = WEEKLY_BRIEFING_COPY.sections;
    const staleCutoff = new Date(monday);
    staleCutoff.setUTCDate(staleCutoff.getUTCDate() - 8);

    const a = analytics.rows[0];
    const hasPerf = !!a;
    const i = intel.rows[0];
    const r = roi.rows[0];
    const ap = autopilot.rows[0];
    const apFresh = ap && new Date(ap.created_at) >= staleCutoff;
    const co = competitors.rows[0];
    const fb = feedback.rows[0];

    const sections = [
      {
        key: "performance",
        title: C.performance.title,
        available: !!hasPerf,
        body: hasPerf ? null : C.performance.empty,
        data: hasPerf
          ? {
              totalSpend: num(a.total_spend),
              totalLeads: num(a.total_leads),
              costPerLead: num(a.cost_per_lead),
              conversions: num(a.conversions),
              returnOnAdSpend: num(a.return_on_ad_spend),
            }
          : null,
      },
      {
        key: "intelligence",
        title: C.intelligence.title,
        available: !!i,
        body: i ? i.ai_analysis : C.intelligence.empty,
        data: i
          ? { trajectoryScore: i.trajectory_score, recommendations: i.recommendations }
          : null,
      },
      {
        key: "roi",
        title: C.roi.title,
        available: !!r,
        body: r ? r.ai_analysis : C.roi.empty,
        data: r
          ? {
              totalSpend: num(r.total_spend),
              totalRevenue: num(r.total_revenue),
              totalLeads: num(r.total_leads),
              roiPercentage: num(r.roi_percentage),
              estimated: true, // ROI includes modeled costs — always labeled
            }
          : null,
      },
      {
        key: "autopilot",
        title: C.autopilot.title,
        available: !!apFresh,
        body: apFresh ? null : C.autopilot.empty,
        data: apFresh ? { status: ap.status } : null,
      },
      {
        key: "competitors",
        title: C.competitors.title,
        available: !!co,
        body: co ? co.summary : C.competitors.empty,
        data: co ? { recommendations: co.recommendations } : null,
      },
      {
        key: "feedback",
        title: C.feedback.title,
        available: !!fb,
        body: fb ? fb.full_report : C.feedback.empty,
        data: fb
          ? { totalResponses: fb.total_responses, averageSentiment: num(fb.average_sentiment) }
          : null,
      },
    ];

    const sources = Object.fromEntries(sections.map((s) => [s.key, s.available]));

    await db.query(
      `UPDATE sage_weekly_briefings
          SET status = 'ready', sections = $2::jsonb, sources = $3::jsonb,
              generated_at = NOW()
        WHERE briefing_id = $1 AND status = 'generating'`,
      [briefingId, JSON.stringify(sections), JSON.stringify(sources)],
    );
    return briefingId;
  } catch (err) {
    await db
      .query(
        `UPDATE sage_weekly_briefings SET status = 'failed'
          WHERE briefing_id = $1 AND status = 'generating'`,
        [briefingId],
      )
      .catch(() => {});
    throw err;
  }
}

/** GET /api/sage/briefing/weekly?brandId= — latest consolidated briefing. */
async function getWeeklyBriefing(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const enabled = await getSwitch("SAGE_V2_WEEKLY_BRIEFING");
    if (!enabled) return res.json({ enabled: false, briefing: null });
    const { rows } = await db.query(
      `SELECT briefing_id, iso_week, status, sections, sources, generated_at
         FROM sage_weekly_briefings
        WHERE brand_id = $1 AND status = 'ready'
        ORDER BY created_at DESC LIMIT 1`,
      [brand.brand_id],
    );
    return res.json({
      enabled: true,
      copy: { title: WEEKLY_BRIEFING_COPY.title, intro: WEEKLY_BRIEFING_COPY.intro, unavailableNote: WEEKLY_BRIEFING_COPY.unavailableNote },
      briefing: rows[0] || null,
    });
  } catch (err) {
    return sendError(res, err, "Failed to load the weekly briefing");
  }
}

/** GET /api/sage/context-stats?brandId= — flying-blind indicator for the Sage page. */
async function getContextStats(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const enabled = await getSwitch("SAGE_V2_CONTEXT");
    const truth = await db.query(
      `SELECT 1 FROM company_truth_reports WHERE brand_id = $1 AND status = 'approved'`,
      [brand.brand_id],
    );
    const stats = enabled ? await getFlyingBlindStats(brand.brand_id) : null;
    return res.json({
      enabled,
      hasApprovedTruth: truth.rows.length > 0,
      flyingBlindCount: stats ? stats.flyingBlindCount : 0,
      lastFlyingBlindAt: stats ? stats.lastFlyingBlindAt : null,
      copy: { banner: FLYING_BLIND_COPY.banner },
    });
  } catch (err) {
    return sendError(res, err, "Failed to load context stats");
  }
}

module.exports = {
  buildWeeklyBriefingForBrand,
  getWeeklyBriefing,
  getContextStats,
  isoWeekOf,
};
