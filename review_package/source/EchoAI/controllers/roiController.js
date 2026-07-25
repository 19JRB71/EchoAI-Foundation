const db = require("../config/db");
const { ROI_MODEL } = require("../config/roiModel");
const { getPlan } = require("../config/plans");
const { generateRoiReport } = require("../prompts/roiReportPrompt");

/** Loads a brand only if it belongs to the authenticated user. */
async function getOwnedBrand(userId, brandId) {
  const result = await db.query(
    `SELECT brand_id, brand_name, brand_personality, voice_description,
            target_audience
     FROM brands
     WHERE brand_id = $1 AND user_id = $2`,
    [brandId, userId],
  );
  return result.rows[0] || null;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Resolves the customer's monthly plan price (for the ROI ratio). */
async function getMonthlyPrice(userId) {
  const result = await db.query(
    `SELECT subscription_tier FROM subscriptions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );
  const tier = result.rows[0]?.subscription_tier || "free";
  const plan = getPlan(tier);
  const monthlyPrice = plan ? plan.monthlyPrice : 0;
  return {
    tier,
    monthlyPrice: monthlyPrice > 0 ? monthlyPrice : ROI_MODEL.fallbackMonthlyPrice,
  };
}

/**
 * Pulls real data from across the platform and computes a complete ROI
 * breakdown for a brand. Returns the breakdown object (no HTTP concerns).
 */
async function computeRoi(userId, brand) {
  const brandId = brand.brand_id;
  const m = ROI_MODEL;

  const [leadRow, campaignRow, socialRow, emailRow, analyticsRows] =
    await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE temperature = 'hot')::int AS hot
         FROM leads WHERE brand_id = $1`,
        [brandId],
      ),
      db.query(
        `SELECT COUNT(*)::int AS count,
                COALESCE(SUM(budget), 0)::numeric AS ad_spend,
                AVG(cost_per_lead)::numeric AS avg_cpl
         FROM campaigns WHERE brand_id = $1`,
        [brandId],
      ),
      db.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'published')::int AS published
         FROM social_posts WHERE brand_id = $1`,
        [brandId],
      ),
      db.query(
        `SELECT COUNT(*)::int AS sent,
                COUNT(*) FILTER (WHERE es.opened_at IS NOT NULL)::int AS opened,
                COUNT(*) FILTER (WHERE es.clicked_at IS NOT NULL)::int AS clicked
         FROM email_sends es
         JOIN email_campaigns ec ON es.campaign_id = ec.campaign_id
         WHERE ec.brand_id = $1`,
        [brandId],
      ),
      db.query(
        `SELECT week_date, cost_per_lead, total_spend
         FROM analytics WHERE brand_id = $1 ORDER BY week_date ASC`,
        [brandId],
      ),
    ]);

  const totalLeads = leadRow.rows[0].total;
  const hotLeads = leadRow.rows[0].hot;
  const warmLeads = Math.max(totalLeads - hotLeads, 0);

  const campaignsRun = campaignRow.rows[0].count;
  let adSpendManaged = Number(campaignRow.rows[0].ad_spend) || 0;
  const avgCostPerLead =
    campaignRow.rows[0].avg_cpl != null
      ? round2(campaignRow.rows[0].avg_cpl)
      : null;

  const postsPublished = socialRow.rows[0].published;

  const emailsSent = emailRow.rows[0].sent;
  const emailsOpened = emailRow.rows[0].opened;
  const emailsClicked = emailRow.rows[0].clicked;

  // Cost-per-lead improvement: earliest vs latest weekly figure from analytics.
  const cplSeries = analyticsRows.rows
    .map((r) => (r.cost_per_lead != null ? Number(r.cost_per_lead) : null))
    .filter((v) => v != null && v > 0);
  let costPerLeadImprovementPct = null;
  if (cplSeries.length >= 2) {
    const first = cplSeries[0];
    const last = cplSeries[cplSeries.length - 1];
    costPerLeadImprovementPct = round2(((first - last) / first) * 100);
  }
  // If no campaign budgets recorded, fall back to actual analytics spend.
  if (adSpendManaged === 0) {
    adSpendManaged = analyticsRows.rows.reduce(
      (sum, r) => sum + (Number(r.total_spend) || 0),
      0,
    );
  }

  // ---- Derived value figures (industry-average model) ----
  const estimatedLeadValue =
    warmLeads * m.leadValue + hotLeads * m.hotLeadValue;

  const socialHours = postsPublished * m.hoursPerSocialPost;
  const emailHours = emailsSent * m.hoursPerEmail;
  const campaignHours = campaignsRun * m.hoursPerCampaign;
  const leadHours = totalLeads * m.hoursPerLead;
  const hoursSaved = socialHours + emailHours + campaignHours + leadHours;

  const moneySaved = hoursSaved * m.hourlyRate;
  const estimatedReach = postsPublished * m.reachPerPost;

  const totalValueGenerated = estimatedLeadValue + moneySaved;

  const { tier, monthlyPrice } = await getMonthlyPrice(userId);
  const roiPercent =
    monthlyPrice > 0
      ? round2(((totalValueGenerated - monthlyPrice) / monthlyPrice) * 100)
      : null;

  const openRate = emailsSent > 0 ? round2((emailsOpened / emailsSent) * 100) : null;
  const clickRate =
    emailsSent > 0 ? round2((emailsClicked / emailsSent) * 100) : null;

  return {
    brandId,
    brandName: brand.brand_name,
    generatedAt: new Date().toISOString(),
    headline: {
      totalValueGenerated: round2(totalValueGenerated),
      hoursSaved: round2(hoursSaved),
      moneySaved: round2(moneySaved),
      roiPercent,
    },
    leads: {
      total: totalLeads,
      hot: hotLeads,
      warm: warmLeads,
      estimatedValue: round2(estimatedLeadValue),
    },
    campaigns: {
      count: campaignsRun,
      adSpendManaged: round2(adSpendManaged),
      avgCostPerLead,
      costPerLeadImprovementPct,
    },
    social: {
      postsPublished,
      estimatedReach,
      hoursSaved: round2(socialHours),
    },
    email: {
      sent: emailsSent,
      opened: emailsOpened,
      clicked: emailsClicked,
      openRate,
      clickRate,
      hoursSaved: round2(emailHours),
    },
    automation: {
      hoursSaved: round2(hoursSaved),
      moneySaved: round2(moneySaved),
      breakdown: [
        { task: "Lead qualification & follow-up", hours: round2(leadHours) },
        { task: "Social content creation", hours: round2(socialHours) },
        { task: "Email marketing", hours: round2(emailHours) },
        { task: "Campaign management", hours: round2(campaignHours) },
      ],
    },
    subscription: { tier, monthlyPrice },
    assumptions: { ...m },
  };
}

/** Monday (UTC) of the ISO week containing d. Matches Postgres date_trunc('week'). */
function mondayOf(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // 0 = Monday
  x.setUTCDate(x.getUTCDate() - dow);
  return x;
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Builds 12 weekly ROI snapshots from real platform data, persists them to
 * roi_snapshots (upsert), and returns them oldest-first.
 */
async function computeAndStoreHistory(brandId) {
  const m = ROI_MODEL;
  const weeks = [];
  const thisMonday = mondayOf(new Date());
  for (let i = 11; i >= 0; i--) {
    const d = new Date(thisMonday);
    d.setUTCDate(d.getUTCDate() - i * 7);
    weeks.push(ymd(d));
  }
  const rangeStart = weeks[0];

  const [leadRows, socialRows, emailRows, spendRows] = await Promise.all([
    db.query(
      `SELECT date_trunc('week', created_at)::date AS week, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE temperature = 'hot')::int AS hot
       FROM leads
       WHERE brand_id = $1 AND created_at >= $2::date
       GROUP BY 1`,
      [brandId, rangeStart],
    ),
    db.query(
      `SELECT date_trunc('week', published_time)::date AS week, COUNT(*)::int AS published
       FROM social_posts
       WHERE brand_id = $1 AND status = 'published' AND published_time >= $2::date
       GROUP BY 1`,
      [brandId, rangeStart],
    ),
    db.query(
      `SELECT date_trunc('week', es.sent_at)::date AS week, COUNT(*)::int AS sent
       FROM email_sends es
       JOIN email_campaigns ec ON es.campaign_id = ec.campaign_id
       WHERE ec.brand_id = $1 AND es.sent_at >= $2::date
       GROUP BY 1`,
      [brandId, rangeStart],
    ),
    db.query(
      `SELECT week_date::date AS week, total_spend, cost_per_lead
       FROM analytics
       WHERE brand_id = $1 AND week_date >= $2::date`,
      [brandId, rangeStart],
    ),
  ]);

  const byWeek = (rows) => {
    const map = new Map();
    for (const r of rows) map.set(ymd(new Date(r.week)), r);
    return map;
  };
  const leadMap = byWeek(leadRows.rows);
  const socialMap = byWeek(socialRows.rows);
  const emailMap = byWeek(emailRows.rows);
  const spendMap = byWeek(spendRows.rows);

  const history = [];
  for (const week of weeks) {
    const lr = leadMap.get(week);
    const total = lr ? lr.total : 0;
    const hot = lr ? lr.hot : 0;
    const warm = Math.max(total - hot, 0);
    const published = socialMap.get(week)?.published || 0;
    const sent = emailMap.get(week)?.sent || 0;
    const spendRow = spendMap.get(week);
    const adSpend = spendRow ? Number(spendRow.total_spend) || 0 : 0;
    const costPerLead =
      spendRow && spendRow.cost_per_lead != null
        ? round2(spendRow.cost_per_lead)
        : null;

    const estimatedLeadValue = warm * m.leadValue + hot * m.hotLeadValue;
    const hoursSaved =
      published * m.hoursPerSocialPost +
      sent * m.hoursPerEmail +
      total * m.hoursPerLead;
    const moneySaved = hoursSaved * m.hourlyRate;
    const totalRoi = estimatedLeadValue + moneySaved;

    history.push({
      weekDate: week,
      totalLeads: total,
      hotLeads: hot,
      estimatedLeadValue: round2(estimatedLeadValue),
      adSpendManaged: round2(adSpend),
      costPerLead,
      hoursSaved: round2(hoursSaved),
      moneySaved: round2(moneySaved),
      totalRoiEstimate: round2(totalRoi),
    });
  }

  // Persist (upsert) every week so the history table mirrors the latest data.
  for (const w of history) {
    await db.query(
      `INSERT INTO roi_snapshots
         (brand_id, week_date, total_leads, hot_leads, estimated_lead_value,
          ad_spend_managed, cost_per_lead, hours_saved, money_saved, total_roi_estimate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (brand_id, week_date)
       DO UPDATE SET total_leads = EXCLUDED.total_leads,
                     hot_leads = EXCLUDED.hot_leads,
                     estimated_lead_value = EXCLUDED.estimated_lead_value,
                     ad_spend_managed = EXCLUDED.ad_spend_managed,
                     cost_per_lead = EXCLUDED.cost_per_lead,
                     hours_saved = EXCLUDED.hours_saved,
                     money_saved = EXCLUDED.money_saved,
                     total_roi_estimate = EXCLUDED.total_roi_estimate`,
      [
        brandId,
        w.weekDate,
        w.totalLeads,
        w.hotLeads,
        w.estimatedLeadValue,
        w.adSpendManaged,
        w.costPerLead,
        w.hoursSaved,
        w.moneySaved,
        w.totalRoiEstimate,
      ],
    );
  }

  return history;
}

/**
 * GET /api/roi/:brandId
 * Returns the full ROI breakdown computed from real platform data.
 */
async function getRoi(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const roi = await computeRoi(userId, brand);
    return res.json({ roi });
  } catch (err) {
    console.error("Calculate ROI error:", err.message);
    return res.status(500).json({ error: "Failed to calculate ROI" });
  }
}

/**
 * GET /api/roi/:brandId/history
 * Returns the last 12 weeks of ROI snapshots (oldest first).
 */
async function getRoiHistory(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const history = await computeAndStoreHistory(brandId);
    return res.json({ brandId, count: history.length, history });
  } catch (err) {
    console.error("Get ROI history error:", err.message);
    return res.status(500).json({ error: "Failed to load ROI history" });
  }
}

/**
 * POST /api/roi/:brandId/report
 * Generates a personalized AI monthly ROI report grounded in the real breakdown.
 */
async function generateReport(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const roi = await computeRoi(userId, brand);
    const history = await computeAndStoreHistory(brandId);
    const report = await generateRoiReport(brand, roi, history);

    return res.json({ brandId, report, roi });
  } catch (err) {
    console.error("Generate ROI report error:", err.message);
    if (typeof err.status === "number" && err.status >= 400) {
      return res.status(502).json({
        error:
          "The AI provider could not generate your ROI report right now. Please try again shortly.",
      });
    }
    return res.status(500).json({ error: "Failed to generate ROI report" });
  }
}

module.exports = {
  computeRoi,
  computeAndStoreHistory,
  getRoi,
  getRoiHistory,
  generateReport,
};
