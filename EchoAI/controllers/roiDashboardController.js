/**
 * Advanced ROI Dashboard controller (Enterprise feature).
 *
 * Pulls REAL performance data from every channel in the platform for a given
 * period and computes true dollar attribution per channel: spend, leads,
 * appointments, conversions, cost-per-lead, cost-per-conversion, attributed
 * revenue, and ROI. Also builds the lead→appointment→conversion funnel and a
 * blended totals view, and persists period snapshots so owners get a running
 * weekly history (written by the Monday scheduler).
 *
 * Attribution model (transparent, documented estimates — see config/roiModel.js):
 *  - Facebook ads: spend/leads/conversions come from the real `analytics` rows.
 *  - Phone/SMS/Email: a lead is credited to a channel when that channel has a
 *    record referencing the lead in the period; spend uses per-unit cost
 *    estimates (minutes/messages/sends).
 *  - Website: CRM leads created in the period with no phone/SMS/email touch.
 *  - Revenue = converted leads × revenuePerConversion. Channel attribution is
 *    multi-touch, so per-channel conversions can overlap; the totals are computed
 *    independently from the real CRM leads to stay honest.
 */

const db = require("../config/db");
const { ROI_MODEL } = require("../config/roiModel");
const { generateRoiAnalysis } = require("../prompts/roiAnalystPrompt");

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

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

/** ROI% = (revenue - spend) / spend * 100, or null when there is no spend. */
function roiPct(revenue, spend) {
  const s = Number(spend) || 0;
  if (s <= 0) return null;
  return round2(((Number(revenue) || 0) - s) / s * 100);
}

function perUnit(value, count) {
  const c = Number(count) || 0;
  if (c <= 0) return null;
  return round2((Number(value) || 0) / c);
}

/**
 * Resolves a date range from the request query. Supports range=7d|30d|90d and
 * range=custom with start/end (YYYY-MM-DD). Defaults to the last 30 days.
 */
function resolveRange(query = {}) {
  const now = new Date();
  let start;
  let end = now;
  const range = query.range || "30d";

  if (range === "custom" && query.start && query.end) {
    start = new Date(query.start);
    end = new Date(query.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      start = new Date(now.getTime() - 30 * 86400000);
      end = now;
    }
  } else {
    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    start = new Date(now.getTime() - days * 86400000);
  }

  const labels = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" };
  const label =
    range === "custom"
      ? `${ymd(start)} → ${ymd(end)}`
      : labels[range] || "Last 30 days";

  return { start, end, range, label };
}

const TOUCH_SUBQUERIES = {
  // Distinct leads referenced by each channel within the period. $1=brandId,
  // $2=start, $3=end. Used both as a count and as an IN (...) filter.
  phone: `SELECT DISTINCT lead_id FROM calls
          WHERE brand_id = $1 AND lead_id IS NOT NULL
            AND created_at >= $2 AND created_at <= $3`,
  sms: `SELECT DISTINCT lead_id FROM sms_messages
        WHERE brand_id = $1 AND lead_id IS NOT NULL
          AND created_at >= $2 AND created_at <= $3`,
  email: `SELECT DISTINCT r.lead_id FROM email_marketing_recipients r
          JOIN email_marketing_campaigns mc ON r.campaign_id = mc.campaign_id
          WHERE mc.brand_id = $1 AND r.lead_id IS NOT NULL
            AND r.delivery_status <> 'pending'
            AND r.created_at >= $2 AND r.created_at <= $3`,
};

/**
 * Computes the funnel counts (leads, appointments, conversions) for a set of
 * leads expressed as a subquery returning lead_id. The subquery must use the
 * same $1/$2/$3 params (brandId, start, end).
 *
 * Attribution model (deliberate): leads and appointments are date-bounded to the
 * window, but conversions reflect a lead's CURRENT converted status — the leads
 * table has no conversion timestamp, so we cannot bound conversions by a flip
 * date. A lead is credited to a channel when that channel touched it within the
 * window; its conversion then counts regardless of when the status changed. This
 * is touch-attribution, not a conversion-date-bounded count. The blended TOTAL
 * (below) instead uses the authoritative CRM count of leads created+converted in
 * range to avoid inflation.
 */
async function funnelForLeadSet(brandId, start, end, leadSetSql) {
  const params = [brandId, start, end];
  const [leadCount, apptCount, convCount] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS n FROM (${leadSetSql}) t`, params),
    db.query(
      `SELECT COUNT(*)::int AS n FROM appointments a
       WHERE a.brand_id = $1 AND a.created_at >= $2 AND a.created_at <= $3
         AND a.lead_id IN (${leadSetSql})`,
      params,
    ),
    db.query(
      `SELECT COUNT(*)::int AS n FROM leads l
       WHERE l.brand_id = $1 AND l.conversion_status = 'converted'
         AND l.lead_id IN (${leadSetSql})`,
      params,
    ),
  ]);
  return {
    leads: leadCount.rows[0].n,
    appointments: apptCount.rows[0].n,
    conversions: convCount.rows[0].n,
  };
}

/**
 * Core: pulls every channel's real data for [start, end] and returns the full
 * advanced ROI breakdown (channels, funnel, totals). No HTTP concerns.
 */
async function computeAdvancedSummary(brandId, start, end) {
  const m = ROI_MODEL;
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const startDate = ymd(start);
  const endDate = ymd(end);
  const params = [brandId, startIso, endIso];

  // --- Facebook ads (from real weekly analytics) ---
  const fbRow = await db.query(
    `SELECT COALESCE(SUM(total_spend), 0)::numeric AS spend,
            COALESCE(SUM(total_leads), 0)::int AS leads,
            COALESCE(SUM(conversions), 0)::int AS conversions
     FROM analytics
     WHERE brand_id = $1 AND week_date >= $2::date AND week_date <= $3::date`,
    [brandId, startDate, endDate],
  );
  const fbApptRow = await db.query(
    `SELECT COUNT(*)::int AS n FROM appointments
     WHERE brand_id = $1 AND created_at >= $2 AND created_at <= $3
       AND source = 'facebook'`,
    params,
  );

  // --- Channel spend (estimated from real volumes) ---
  const [phoneSpendRow, smsSpendRow, emailSpendRow] = await Promise.all([
    db.query(
      `SELECT COALESCE(SUM(duration_seconds), 0)::int AS seconds
       FROM calls WHERE brand_id = $1 AND created_at >= $2 AND created_at <= $3`,
      params,
    ),
    db.query(
      `SELECT COUNT(*)::int AS n FROM sms_messages
       WHERE brand_id = $1 AND direction = 'outbound'
         AND created_at >= $2 AND created_at <= $3`,
      params,
    ),
    db.query(
      `SELECT COUNT(*)::int AS n FROM email_marketing_recipients r
       JOIN email_marketing_campaigns mc ON r.campaign_id = mc.campaign_id
       WHERE mc.brand_id = $1 AND r.delivery_status <> 'pending'
         AND r.created_at >= $2 AND r.created_at <= $3`,
      params,
    ),
  ]);

  // --- Touch-based funnels (phone / sms / email) ---
  const [phoneFunnel, smsFunnel, emailFunnel] = await Promise.all([
    funnelForLeadSet(brandId, startIso, endIso, TOUCH_SUBQUERIES.phone),
    funnelForLeadSet(brandId, startIso, endIso, TOUCH_SUBQUERIES.sms),
    funnelForLeadSet(brandId, startIso, endIso, TOUCH_SUBQUERIES.email),
  ]);

  // --- Website / chatbot: CRM leads created in the period with no other touch ---
  const websiteLeadSetSql = `SELECT lead_id FROM leads
    WHERE brand_id = $1 AND created_at >= $2 AND created_at <= $3
      AND lead_id NOT IN (${TOUCH_SUBQUERIES.phone})
      AND lead_id NOT IN (${TOUCH_SUBQUERIES.sms})
      AND lead_id NOT IN (${TOUCH_SUBQUERIES.email})`;
  const websiteFunnel = await funnelForLeadSet(
    brandId,
    startIso,
    endIso,
    websiteLeadSetSql,
  );

  // --- Real CRM totals (independent of multi-touch channel attribution) ---
  const crmRow = await db.query(
    `SELECT COUNT(*)::int AS leads,
            COUNT(*) FILTER (WHERE conversion_status = 'converted')::int AS conversions
     FROM leads
     WHERE brand_id = $1 AND created_at >= $2 AND created_at <= $3`,
    params,
  );
  const apptTotalRow = await db.query(
    `SELECT COUNT(*)::int AS n FROM appointments
     WHERE brand_id = $1 AND created_at >= $2 AND created_at <= $3`,
    params,
  );

  // ---- Assemble channels ----
  const fbSpend = round2(fbRow.rows[0].spend);
  const fbLeads = fbRow.rows[0].leads;
  const fbConversions = fbRow.rows[0].conversions;
  const fbRevenue = round2(fbConversions * m.revenuePerConversion);

  const phoneSpend = round2((phoneSpendRow.rows[0].seconds / 60) * m.phoneCostPerMinute);
  const smsSpend = round2(smsSpendRow.rows[0].n * m.smsCostPerMessage);
  const emailSpend = round2(emailSpendRow.rows[0].n * m.emailCostPerSend);

  function channel(key, label, spend, f) {
    const revenue = round2(f.conversions * m.revenuePerConversion);
    return {
      key,
      label,
      spend: round2(spend),
      leads: f.leads,
      appointments: f.appointments,
      conversions: f.conversions,
      revenue,
      costPerLead: perUnit(spend, f.leads),
      costPerConversion: perUnit(spend, f.conversions),
      roiPercent: roiPct(revenue, spend),
    };
  }

  const channels = [
    {
      key: "facebook",
      label: "Facebook Ads",
      spend: fbSpend,
      leads: fbLeads,
      appointments: fbApptRow.rows[0].n,
      conversions: fbConversions,
      revenue: fbRevenue,
      costPerLead: perUnit(fbSpend, fbLeads),
      costPerConversion: perUnit(fbSpend, fbConversions),
      roiPercent: roiPct(fbRevenue, fbSpend),
    },
    channel("phone", "Phone Calls", phoneSpend, phoneFunnel),
    channel("sms", "SMS", smsSpend, smsFunnel),
    channel("email", "Email", emailSpend, emailFunnel),
    channel("website", "Website / Chatbot", 0, websiteFunnel),
  ];

  // ---- Totals (real spend; revenue from real CRM conversions) ----
  const totalSpend = round2(channels.reduce((s, c) => s + c.spend, 0));
  const crmLeads = crmRow.rows[0].leads;
  const crmConversions = crmRow.rows[0].conversions;
  const totalAppointments = apptTotalRow.rows[0].n;
  // Totals use the real CRM converted leads (created in range) as the SINGLE
  // authoritative conversion source, so total revenue is never double-counted.
  // Per-channel revenue is multi-touch (incl. Facebook's ad-reported
  // conversions) and can sum higher than this total — that overlap is expected
  // and surfaced in the dashboard disclaimer.
  const totalConversions = crmConversions;
  const totalRevenue = round2(totalConversions * m.revenuePerConversion);
  const totalRoi = roiPct(totalRevenue, totalSpend);

  // ---- Best / worst channel by ROI (spend > 0); fall back to revenue ----
  const measurable = channels.filter((c) => c.roiPercent != null);
  let best = null;
  let worst = null;
  if (measurable.length) {
    best = measurable.reduce((a, b) => (b.roiPercent > a.roiPercent ? b : a));
    worst = measurable.reduce((a, b) => (b.roiPercent < a.roiPercent ? b : a));
  } else {
    const byRev = [...channels].sort((a, b) => b.revenue - a.revenue);
    best = byRev[0] || null;
    worst = byRev[byRev.length - 1] || null;
  }

  // ---- Funnel view (per channel, with drop-off rates) ----
  const funnel = channels.map((c) => {
    const leadToAppt = c.leads > 0 ? round2((c.appointments / c.leads) * 100) : null;
    const apptToConv =
      c.appointments > 0 ? round2((c.conversions / c.appointments) * 100) : null;
    const leadToConv = c.leads > 0 ? round2((c.conversions / c.leads) * 100) : null;
    return {
      key: c.key,
      label: c.label,
      leads: c.leads,
      appointments: c.appointments,
      conversions: c.conversions,
      leadToApptRate: leadToAppt,
      apptToConvRate: apptToConv,
      leadToConvRate: leadToConv,
    };
  });

  const withLeads = funnel.filter((f) => f.leads > 0 && f.leadToConvRate != null);
  const bestConversion = withLeads.length
    ? withLeads.reduce((a, b) => (b.leadToConvRate > a.leadToConvRate ? b : a))
    : null;
  const worstConversion = withLeads.length
    ? withLeads.reduce((a, b) => (b.leadToConvRate < a.leadToConvRate ? b : a))
    : null;

  return {
    brandId,
    period: { start: startDate, end: endDate, range: undefined },
    totals: {
      spend: totalSpend,
      revenue: totalRevenue,
      leads: crmLeads,
      conversions: totalConversions,
      appointments: totalAppointments,
      roiPercent: totalRoi,
    },
    channels,
    funnel,
    best: best ? { key: best.key, label: best.label, roiPercent: best.roiPercent } : null,
    worst: worst ? { key: worst.key, label: worst.label, roiPercent: worst.roiPercent } : null,
    bestConversion: bestConversion
      ? { key: bestConversion.key, label: bestConversion.label, rate: bestConversion.leadToConvRate }
      : null,
    worstConversion: worstConversion
      ? { key: worstConversion.key, label: worstConversion.label, rate: worstConversion.leadToConvRate }
      : null,
    assumptions: {
      revenuePerConversion: m.revenuePerConversion,
      smsCostPerMessage: m.smsCostPerMessage,
      phoneCostPerMinute: m.phoneCostPerMinute,
      emailCostPerSend: m.emailCostPerSend,
    },
  };
}

/** Upserts a period snapshot from a computed summary (+ optional AI analysis). */
async function upsertSnapshot(brandId, summary, aiAnalysis) {
  const t = summary.totals;
  const result = await db.query(
    `INSERT INTO roi_advanced_snapshots
       (brand_id, period_start, period_end, total_spend, total_revenue,
        total_leads, total_conversions, total_appointments, roi_percentage,
        channel_breakdown, ai_analysis)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (brand_id, period_start, period_end)
     DO UPDATE SET total_spend = EXCLUDED.total_spend,
                   total_revenue = EXCLUDED.total_revenue,
                   total_leads = EXCLUDED.total_leads,
                   total_conversions = EXCLUDED.total_conversions,
                   total_appointments = EXCLUDED.total_appointments,
                   roi_percentage = EXCLUDED.roi_percentage,
                   channel_breakdown = EXCLUDED.channel_breakdown,
                   ai_analysis = COALESCE(EXCLUDED.ai_analysis, roi_advanced_snapshots.ai_analysis)
     RETURNING snapshot_id`,
    [
      brandId,
      summary.period.start,
      summary.period.end,
      t.spend,
      t.revenue,
      t.leads,
      t.conversions,
      t.appointments,
      t.roiPercent,
      JSON.stringify({
        channels: summary.channels,
        funnel: summary.funnel,
        totals: summary.totals,
        best: summary.best,
        worst: summary.worst,
        bestConversion: summary.bestConversion,
        worstConversion: summary.worstConversion,
      }),
      aiAnalysis || null,
    ],
  );
  return result.rows[0].snapshot_id;
}

/**
 * GET /api/roi/:brandId/advanced/summary
 * Full multi-channel ROI summary for the requested date range. Includes the most
 * recent stored AI analysis for the current period (if any).
 */
async function getAdvancedSummary(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const { start, end, range, label } = resolveRange(req.query);
    const summary = await computeAdvancedSummary(brandId, start, end);
    summary.period.range = range;
    summary.period.label = label;

    // Surface any stored analysis for this exact period.
    const stored = await db.query(
      `SELECT ai_analysis FROM roi_advanced_snapshots
       WHERE brand_id = $1 AND period_start = $2 AND period_end = $3`,
      [brandId, summary.period.start, summary.period.end],
    );
    summary.analysis = stored.rows[0]?.ai_analysis || null;

    return res.json({ summary });
  } catch (err) {
    console.error("Advanced ROI summary error:", err.message);
    return res.status(500).json({ error: "Failed to calculate advanced ROI" });
  }
}

/**
 * POST /api/roi/:brandId/advanced/analysis
 * Recomputes the summary for the requested range, generates a fresh AI executive
 * summary, and upserts the period snapshot. Returns the analysis + summary.
 */
async function generateAdvancedAnalysis(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const { start, end, range, label } = resolveRange(req.body || {});
    const summary = await computeAdvancedSummary(brandId, start, end);
    summary.period.range = range;
    summary.period.label = label;

    const analysis = await generateRoiAnalysis(brand, summary);
    await upsertSnapshot(brandId, summary, analysis);
    summary.analysis = analysis;

    return res.json({ brandId, analysis, summary });
  } catch (err) {
    console.error("Advanced ROI analysis error:", err.message);
    if (err.aiInvalid || (typeof err.status === "number" && err.status >= 400)) {
      return res.status(502).json({
        error:
          "The AI provider could not generate your ROI analysis right now. Please try again shortly.",
      });
    }
    return res.status(500).json({ error: "Failed to generate ROI analysis" });
  }
}

/**
 * GET /api/roi/:brandId/advanced/history
 * The last 12 stored period snapshots (most recent first), summary fields only.
 */
async function getAdvancedHistory(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `SELECT snapshot_id, period_start, period_end, total_spend, total_revenue,
              total_leads, total_conversions, total_appointments, roi_percentage,
              (ai_analysis IS NOT NULL) AS has_analysis, created_at
       FROM roi_advanced_snapshots
       WHERE brand_id = $1
       ORDER BY period_end DESC
       LIMIT 12`,
      [brandId],
    );
    return res.json({ brandId, count: result.rows.length, snapshots: result.rows });
  } catch (err) {
    console.error("Advanced ROI history error:", err.message);
    return res.status(500).json({ error: "Failed to load ROI history" });
  }
}

/**
 * GET /api/roi/:brandId/advanced/history/:snapshotId
 * The full stored breakdown + AI analysis for one snapshot.
 */
async function getAdvancedSnapshot(req, res) {
  const userId = req.user.userId;
  const { brandId, snapshotId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `SELECT snapshot_id, period_start, period_end, total_spend, total_revenue,
              total_leads, total_conversions, total_appointments, roi_percentage,
              channel_breakdown, ai_analysis, created_at
       FROM roi_advanced_snapshots
       WHERE brand_id = $1 AND snapshot_id = $2`,
      [brandId, snapshotId],
    );
    if (!result.rows[0])
      return res.status(404).json({ error: "Snapshot not found" });

    return res.json({ snapshot: result.rows[0] });
  } catch (err) {
    console.error("Advanced ROI snapshot error:", err.message);
    return res.status(500).json({ error: "Failed to load ROI snapshot" });
  }
}

/**
 * Scheduler hook: computes and persists a weekly advanced ROI snapshot for one
 * brand (the trailing 7 days, period_end = today). Attempts an AI executive
 * summary best-effort — an AI failure stores the snapshot without analysis rather
 * than losing the data. Returns the snapshot id.
 */
async function generateWeeklyRoiSnapshot(brand) {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 86400000);
  const summary = await computeAdvancedSummary(brand.brand_id, start, end);
  summary.period.range = "7d";
  summary.period.label = "Last 7 days";

  let analysis = null;
  try {
    const brandRow = brand.brand_name
      ? brand
      : (
          await db.query(
            `SELECT brand_id, brand_name, brand_personality, voice_description, target_audience
             FROM brands WHERE brand_id = $1`,
            [brand.brand_id],
          )
        ).rows[0];
    if (brandRow) analysis = await generateRoiAnalysis(brandRow, summary);
  } catch (err) {
    console.error(
      `Weekly ROI analysis failed for brand ${brand.brand_id}:`,
      err.message,
    );
  }

  return upsertSnapshot(brand.brand_id, summary, analysis);
}

module.exports = {
  computeAdvancedSummary,
  getAdvancedSummary,
  generateAdvancedAnalysis,
  getAdvancedHistory,
  getAdvancedSnapshot,
  generateWeeklyRoiSnapshot,
};
