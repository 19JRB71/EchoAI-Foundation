/**
 * Customer Intelligence Engine controller (Enterprise feature) — the "brain".
 *
 * buildIntelligenceProfile(brandId) pulls REAL data from EVERY channel across the
 * whole platform (campaigns, leads, conversions, calls, SMS, email, social,
 * appointments, feedback, competitor intelligence, ROI snapshots, follow-up
 * sequences, SEO, ad creatives, content calendars) and synthesizes it into one
 * structured metrics object. generateWeeklyIntelligence(brand) feeds that profile
 * (plus last week's intelligence for continuity) to the AI Customer Intelligence
 * Agent and persists a weekly customer_intelligence row: the synthesized profile,
 * 5 ranked recommendations, detected trends, a 1-10 trajectory score, and the
 * executive analysis. Owners log what they act on in applied_recommendations.
 *
 * The engine gets smarter every week: each run is anchored on the previous run's
 * score and recommendations so the strategy evolves instead of resetting.
 */

const db = require("../config/db");
const { generateIntelligence } = require("../prompts/customerIntelligencePrompt");

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

function pct(part, whole) {
  const w = Number(whole) || 0;
  if (w <= 0) return null;
  return round2(((Number(part) || 0) / w) * 100);
}

/** Maps any thrown error to the right HTTP status (AI/provider failures → 502). */
function sendError(res, err, fallbackMsg) {
  if (err.aiInvalid || (typeof err.status === "number" && err.status >= 400)) {
    return res.status(502).json({
      error:
        "The AI provider could not generate your intelligence brief right now. Please try again shortly.",
    });
  }
  return res.status(500).json({ error: fallbackMsg });
}

/**
 * Pulls every channel's real data for a brand and synthesizes it into one
 * structured metrics object. Looks back 90 days for activity windows while also
 * capturing lifetime/latest rollups. No HTTP concerns — used by the scheduler and
 * the on-demand regenerate endpoint.
 */
async function buildIntelligenceProfile(brandId) {
  const now = new Date();
  const since90 = new Date(now.getTime() - 90 * 86400000).toISOString();
  const since30 = new Date(now.getTime() - 30 * 86400000).toISOString();
  const p90 = [brandId, since90];

  const [
    campaignsRow,
    leadsRow,
    leadStatusRows,
    callsRow,
    smsRow,
    emailRow,
    socialRows,
    apptRows,
    feedbackRow,
    feedbackReportRow,
    competitorRow,
    roiRow,
    seqRows,
    touchpointRow,
    seoRow,
    adCreativeRows,
    calendarRow,
    analyticsRow,
  ] = await Promise.all([
    // Campaigns
    db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'active')::int AS active,
              COALESCE(SUM(budget), 0)::numeric AS total_budget
       FROM campaigns WHERE brand_id = $1`,
      [brandId],
    ),
    // Leads (lifetime + 90d window + temperature/conversion split)
    db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE created_at >= $2)::int AS last_90d,
              COUNT(*) FILTER (WHERE created_at >= $3)::int AS last_30d,
              COUNT(*) FILTER (WHERE temperature = 'hot')::int AS hot,
              COUNT(*) FILTER (WHERE temperature = 'warm')::int AS warm,
              COUNT(*) FILTER (WHERE temperature = 'tire_kicker')::int AS tire_kickers,
              COUNT(*) FILTER (WHERE conversion_status = 'converted')::int AS converted
       FROM leads WHERE brand_id = $1`,
      [brandId, since90, since30],
    ),
    // Lead pipeline by conversion status (lifetime)
    db.query(
      `SELECT conversion_status AS status, COUNT(*)::int AS n
       FROM leads WHERE brand_id = $1
       GROUP BY conversion_status ORDER BY n DESC`,
      [brandId],
    ),
    // Phone calls (90d)
    db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE direction = 'inbound')::int AS inbound,
              COUNT(*) FILTER (WHERE direction = 'outbound')::int AS outbound,
              COALESCE(AVG(duration_seconds), 0)::numeric AS avg_seconds
       FROM calls WHERE brand_id = $1 AND created_at >= $2`,
      p90,
    ),
    // SMS (90d)
    db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE direction = 'inbound')::int AS inbound,
              COUNT(*) FILTER (WHERE direction = 'outbound')::int AS outbound
       FROM sms_messages WHERE brand_id = $1 AND created_at >= $2`,
      p90,
    ),
    // Email marketing performance (90d)
    db.query(
      `SELECT COUNT(*)::int AS sent,
              COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened,
              COUNT(*) FILTER (WHERE clicked_at IS NOT NULL)::int AS clicked
       FROM email_marketing_recipients r
       JOIN email_marketing_campaigns mc ON r.campaign_id = mc.campaign_id
       WHERE mc.brand_id = $1 AND r.delivery_status <> 'pending'
         AND r.created_at >= $2`,
      p90,
    ),
    // Social posts published (90d), per platform + raw engagement metrics
    db.query(
      `SELECT platform, COUNT(*)::int AS posts,
              COALESCE(jsonb_agg(engagement_metrics) FILTER (WHERE engagement_metrics IS NOT NULL), '[]'::jsonb) AS metrics
       FROM social_posts
       WHERE brand_id = $1 AND status = 'published' AND COALESCE(published_time, created_at) >= $2
       GROUP BY platform`,
      p90,
    ),
    // Appointment outcomes (90d)
    db.query(
      `SELECT status, COUNT(*)::int AS n
       FROM appointments WHERE brand_id = $1 AND created_at >= $2
       GROUP BY status`,
      p90,
    ),
    // Feedback sentiment (90d survey responses)
    db.query(
      `SELECT COUNT(*)::int AS responses,
              COALESCE(AVG(sentiment_score), 0)::numeric AS avg_sentiment
       FROM survey_responses
       WHERE brand_id = $1 AND responded_at IS NOT NULL AND responded_at >= $2`,
      p90,
    ),
    // Latest feedback report (themes/recommendations)
    db.query(
      `SELECT average_sentiment, total_responses, themes, recommendations
       FROM feedback_reports WHERE brand_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [brandId],
    ),
    // Latest competitor intelligence
    db.query(
      `SELECT competitor_names, intelligence_report
       FROM competitor_intelligence WHERE brand_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [brandId],
    ),
    // Latest advanced ROI snapshot
    db.query(
      `SELECT period_start, period_end, total_spend, total_revenue, total_leads,
              total_conversions, roi_percentage, channel_breakdown
       FROM roi_advanced_snapshots WHERE brand_id = $1
       ORDER BY period_end DESC LIMIT 1`,
      [brandId],
    ),
    // Follow-up sequences (lifetime status split)
    db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'active')::int AS active,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
              COUNT(*) FILTER (WHERE status = 'stopped')::int AS stopped
       FROM follow_up_sequences WHERE brand_id = $1`,
      [brandId],
    ),
    // Sequence touchpoints delivery (90d)
    db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE t.status = 'sent')::int AS sent,
              COUNT(*) FILTER (WHERE t.status = 'failed')::int AS failed
       FROM sequence_touchpoints t
       JOIN follow_up_sequences s ON t.sequence_id = s.sequence_id
       WHERE s.brand_id = $1 AND t.created_at >= $2`,
      p90,
    ),
    // SEO content
    db.query(
      `SELECT COUNT(*)::int AS total, COALESCE(AVG(seo_score), 0)::numeric AS avg_score
       FROM seo_content WHERE brand_id = $1`,
      [brandId],
    ),
    // Ad creatives (launched) + performance
    db.query(
      `SELECT status, COUNT(*)::int AS n
       FROM ad_creatives WHERE brand_id = $1
       GROUP BY status`,
      [brandId],
    ),
    // Content calendars
    db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'active')::int AS active
       FROM content_calendars WHERE brand_id = $1`,
      [brandId],
    ),
    // Weekly analytics rollup (last 12 weeks)
    db.query(
      `SELECT COALESCE(SUM(total_spend), 0)::numeric AS spend,
              COALESCE(SUM(total_leads), 0)::int AS leads,
              COALESCE(SUM(conversions), 0)::int AS conversions,
              COALESCE(AVG(return_on_ad_spend), 0)::numeric AS avg_roas,
              COUNT(*)::int AS weeks
       FROM analytics
       WHERE brand_id = $1 AND week_date >= (CURRENT_DATE - INTERVAL '84 days')`,
      [brandId],
    ),
  ]);

  const leads = leadsRow.rows[0];
  const calls = callsRow.rows[0];
  const email = emailRow.rows[0];
  const feedback = feedbackRow.rows[0];

  // Aggregate social engagement defensively from freeform JSONB metrics.
  const social = socialRows.rows.map((r) => {
    let likes = 0, comments = 0, shares = 0, impressions = 0;
    for (const m of r.metrics || []) {
      if (!m || typeof m !== "object") continue;
      likes += Number(m.likes) || 0;
      comments += Number(m.comments) || 0;
      shares += Number(m.shares) || 0;
      impressions += Number(m.impressions) || Number(m.reach) || 0;
    }
    return { platform: r.platform, posts: r.posts, likes, comments, shares, impressions };
  });

  const appointments = apptRows.rows.reduce(
    (acc, r) => ({ ...acc, [r.status]: r.n }),
    {},
  );
  const adCreatives = adCreativeRows.rows.reduce(
    (acc, r) => ({ ...acc, [r.status]: r.n }),
    {},
  );

  return {
    generatedAt: now.toISOString(),
    window: "Last 90 days (lifetime rollups where noted)",
    campaigns: {
      total: campaignsRow.rows[0].total,
      active: campaignsRow.rows[0].active,
      totalBudget: round2(campaignsRow.rows[0].total_budget),
    },
    leads: {
      lifetime: leads.total,
      last90d: leads.last_90d,
      last30d: leads.last_30d,
      hot: leads.hot,
      warm: leads.warm,
      tireKickers: leads.tire_kickers,
      converted: leads.converted,
      conversionRatePct: pct(leads.converted, leads.total),
      pipelineByStatus: leadStatusRows.rows,
    },
    phone: {
      total: calls.total,
      inbound: calls.inbound,
      outbound: calls.outbound,
      avgDurationSeconds: round2(calls.avg_seconds),
    },
    sms: smsRow.rows[0],
    email: {
      sent: email.sent,
      opened: email.opened,
      clicked: email.clicked,
      openRatePct: pct(email.opened, email.sent),
      clickRatePct: pct(email.clicked, email.sent),
    },
    social,
    appointments,
    feedback: {
      responses90d: feedback.responses,
      avgSentiment90d: round2(feedback.avg_sentiment),
      latestReport: feedbackReportRow.rows[0]
        ? {
            averageSentiment: feedbackReportRow.rows[0].average_sentiment,
            totalResponses: feedbackReportRow.rows[0].total_responses,
            themes: feedbackReportRow.rows[0].themes,
            recommendations: feedbackReportRow.rows[0].recommendations,
          }
        : null,
    },
    competitorIntelligence: competitorRow.rows[0]
      ? {
          competitors: competitorRow.rows[0].competitor_names,
          report: competitorRow.rows[0].intelligence_report,
        }
      : null,
    roi: roiRow.rows[0] || null,
    followUps: {
      sequences: seqRows.rows[0],
      touchpoints90d: touchpointRow.rows[0],
    },
    seo: {
      total: seoRow.rows[0].total,
      avgScore: round2(seoRow.rows[0].avg_score),
    },
    adCreatives,
    contentCalendars: calendarRow.rows[0],
    analytics12w: {
      spend: round2(analyticsRow.rows[0].spend),
      leads: analyticsRow.rows[0].leads,
      conversions: analyticsRow.rows[0].conversions,
      avgRoas: round2(analyticsRow.rows[0].avg_roas),
      weeksRecorded: analyticsRow.rows[0].weeks,
    },
  };
}

/** Fetches the most recent prior intelligence row for continuity (or null). */
async function getPreviousIntelligence(brandId, beforeWeekDate) {
  const result = await db.query(
    `SELECT week_date, trajectory_score, recommendations
     FROM customer_intelligence
     WHERE brand_id = $1 AND week_date < $2
     ORDER BY week_date DESC LIMIT 1`,
    [brandId, beforeWeekDate],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { trajectoryScore: row.trajectory_score, recommendations: row.recommendations || [] };
}

/** Most recent Monday on or before the given date, as YYYY-MM-DD. */
function weekDateFor(date = new Date()) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/** Upserts the weekly intelligence row from a built profile + AI output. */
async function upsertIntelligence(brandId, weekDate, metrics, insights, ai) {
  const rawProfile = { metrics, insights };
  const result = await db.query(
    `INSERT INTO customer_intelligence
       (brand_id, week_date, raw_profile_data, recommendations, trends_identified,
        trajectory_score, ai_analysis)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (brand_id, week_date)
     DO UPDATE SET raw_profile_data = EXCLUDED.raw_profile_data,
                   recommendations = EXCLUDED.recommendations,
                   trends_identified = EXCLUDED.trends_identified,
                   trajectory_score = EXCLUDED.trajectory_score,
                   ai_analysis = EXCLUDED.ai_analysis
     RETURNING intelligence_id`,
    [
      brandId,
      weekDate,
      JSON.stringify(rawProfile),
      JSON.stringify(ai.recommendations),
      JSON.stringify(ai.trends),
      ai.trajectoryScore,
      ai.analysis,
    ],
  );
  return result.rows[0].intelligence_id;
}

/**
 * Builds this week's intelligence for one brand: pulls the full cross-channel
 * profile, anchors on last week for continuity, runs the AI agent, and upserts
 * the weekly row. Throws on AI failure (caller decides best-effort vs HTTP 502).
 * Returns the intelligence_id.
 */
async function generateWeeklyIntelligence(brand) {
  const brandRow = brand.brand_name
    ? brand
    : (
        await db.query(
          `SELECT brand_id, brand_name, brand_personality, voice_description, target_audience
           FROM brands WHERE brand_id = $1`,
          [brand.brand_id],
        )
      ).rows[0];
  if (!brandRow) throw new Error("Brand not found");

  const weekDate = weekDateFor();
  const metrics = await buildIntelligenceProfile(brandRow.brand_id);
  const previous = await getPreviousIntelligence(brandRow.brand_id, weekDate);

  const ai = await generateIntelligence(brandRow, { metrics, previous });
  return upsertIntelligence(brandRow.brand_id, weekDate, metrics, ai.insights, ai);
}

/**
 * GET /api/intelligence/:brandId/brief
 * This week's strategic brief: trajectory score + delta vs last week, the ranked
 * recommendations, detected trends, and the executive analysis.
 */
async function getIntelligenceBrief(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `SELECT intelligence_id, week_date, recommendations, trends_identified,
              trajectory_score, ai_analysis, created_at
       FROM customer_intelligence
       WHERE brand_id = $1
       ORDER BY week_date DESC LIMIT 2`,
      [brandId],
    );

    if (!result.rows.length) {
      return res.json({ brandId, ready: false, brief: null });
    }

    const current = result.rows[0];
    const previous = result.rows[1] || null;
    const delta =
      previous && current.trajectory_score != null && previous.trajectory_score != null
        ? current.trajectory_score - previous.trajectory_score
        : null;

    return res.json({
      brandId,
      ready: true,
      brief: {
        intelligenceId: current.intelligence_id,
        weekDate: current.week_date,
        trajectoryScore: current.trajectory_score,
        previousScore: previous ? previous.trajectory_score : null,
        trajectoryDelta: delta,
        recommendations: current.recommendations || [],
        trends: current.trends_identified || [],
        analysis: current.ai_analysis,
        createdAt: current.created_at,
      },
    });
  } catch (err) {
    console.error("Intelligence brief error:", err.message);
    return res.status(500).json({ error: "Failed to load intelligence brief" });
  }
}

/**
 * GET /api/intelligence/:brandId/profile
 * The latest synthesized intelligence profile (AI insight sections + the raw
 * cross-channel metrics behind them).
 */
async function getIntelligenceProfile(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `SELECT week_date, raw_profile_data, created_at
       FROM customer_intelligence
       WHERE brand_id = $1
       ORDER BY week_date DESC LIMIT 1`,
      [brandId],
    );

    if (!result.rows.length) {
      return res.json({ brandId, ready: false, profile: null });
    }

    const row = result.rows[0];
    const raw = row.raw_profile_data || {};
    return res.json({
      brandId,
      ready: true,
      profile: {
        weekDate: row.week_date,
        insights: raw.insights || {},
        metrics: raw.metrics || {},
        createdAt: row.created_at,
      },
    });
  } catch (err) {
    console.error("Intelligence profile error:", err.message);
    return res.status(500).json({ error: "Failed to load intelligence profile" });
  }
}

/**
 * GET /api/intelligence/:brandId/trends
 * Up to 12 weeks of trajectory scores + headline metric trends + this week's
 * recommendations vs last week's (to show strategy evolution).
 */
async function getIntelligenceTrends(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `SELECT week_date, trajectory_score, recommendations, raw_profile_data
       FROM customer_intelligence
       WHERE brand_id = $1
       ORDER BY week_date DESC LIMIT 12`,
      [brandId],
    );

    // Oldest → newest for charting.
    const rows = result.rows.slice().reverse();
    const history = rows.map((r) => {
      const m = (r.raw_profile_data && r.raw_profile_data.metrics) || {};
      return {
        weekDate: r.week_date,
        trajectoryScore: r.trajectory_score,
        leads: m.leads ? m.leads.last90d : null,
        conversions: m.leads ? m.leads.converted : null,
        conversionRatePct: m.leads ? m.leads.conversionRatePct : null,
        avgSentiment: m.feedback ? m.feedback.avgSentiment90d : null,
        roiPercent: m.roi ? m.roi.roi_percentage : null,
      };
    });

    const latest = result.rows[0] || null;
    const prior = result.rows[1] || null;

    return res.json({
      brandId,
      count: history.length,
      history,
      recommendationComparison: {
        current: latest ? { weekDate: latest.week_date, recommendations: latest.recommendations || [] } : null,
        previous: prior ? { weekDate: prior.week_date, recommendations: prior.recommendations || [] } : null,
      },
    });
  } catch (err) {
    console.error("Intelligence trends error:", err.message);
    return res.status(500).json({ error: "Failed to load intelligence trends" });
  }
}

/**
 * POST /api/intelligence/:brandId/generate
 * On-demand regeneration of this week's intelligence (same path the Monday
 * scheduler uses). AI/provider failures map to 502.
 */
async function regenerateIntelligence(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    await generateWeeklyIntelligence(brand);
    // Return the freshly built brief.
    return getIntelligenceBrief(req, res);
  } catch (err) {
    console.error("Intelligence regenerate error:", err.message);
    return sendError(res, err, "Failed to generate intelligence brief");
  }
}

/**
 * GET /api/intelligence/:brandId/applied
 * The log of recommendations the owner has marked applied, newest first.
 */
async function getAppliedRecommendations(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `SELECT application_id, intelligence_id, recommendation_text, action_taken,
              applied_at, outcome_notes, created_at, updated_at
       FROM applied_recommendations
       WHERE brand_id = $1
       ORDER BY applied_at DESC`,
      [brandId],
    );
    return res.json({ brandId, count: result.rows.length, applied: result.rows });
  } catch (err) {
    console.error("Applied recommendations error:", err.message);
    return res.status(500).json({ error: "Failed to load applied recommendations" });
  }
}

/**
 * POST /api/intelligence/:brandId/applied
 * Logs a recommendation the owner has applied. Body: { recommendationText,
 * actionTaken?, outcomeNotes?, intelligenceId? }.
 */
async function applyRecommendation(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  const { recommendationText, actionTaken, outcomeNotes, intelligenceId } = req.body || {};
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    if (!recommendationText || !String(recommendationText).trim()) {
      return res.status(400).json({ error: "recommendationText is required" });
    }

    // Guard the optional intelligenceId against cross-brand references.
    let safeIntelligenceId = null;
    if (intelligenceId) {
      const owns = await db.query(
        `SELECT 1 FROM customer_intelligence WHERE intelligence_id = $1 AND brand_id = $2`,
        [intelligenceId, brandId],
      );
      if (owns.rows.length) safeIntelligenceId = intelligenceId;
    }

    const result = await db.query(
      `INSERT INTO applied_recommendations
         (intelligence_id, brand_id, recommendation_text, action_taken, outcome_notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING application_id, intelligence_id, recommendation_text, action_taken,
                 applied_at, outcome_notes, created_at, updated_at`,
      [
        safeIntelligenceId,
        brandId,
        String(recommendationText).trim(),
        actionTaken ? String(actionTaken).trim() : null,
        outcomeNotes ? String(outcomeNotes).trim() : null,
      ],
    );
    return res.status(201).json({ applied: result.rows[0] });
  } catch (err) {
    console.error("Apply recommendation error:", err.message);
    return res.status(500).json({ error: "Failed to log applied recommendation" });
  }
}

/**
 * PATCH /api/intelligence/:brandId/applied/:applicationId
 * Updates the action taken and/or outcome notes for an applied recommendation.
 */
async function updateAppliedRecommendation(req, res) {
  const userId = req.user.userId;
  const { brandId, applicationId } = req.params;
  const { actionTaken, outcomeNotes } = req.body || {};
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const result = await db.query(
      `UPDATE applied_recommendations
       SET action_taken = COALESCE($1, action_taken),
           outcome_notes = COALESCE($2, outcome_notes)
       WHERE application_id = $3 AND brand_id = $4
       RETURNING application_id, intelligence_id, recommendation_text, action_taken,
                 applied_at, outcome_notes, created_at, updated_at`,
      [
        actionTaken != null ? String(actionTaken).trim() : null,
        outcomeNotes != null ? String(outcomeNotes).trim() : null,
        applicationId,
        brandId,
      ],
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Applied recommendation not found" });
    return res.json({ applied: result.rows[0] });
  } catch (err) {
    console.error("Update applied recommendation error:", err.message);
    return res.status(500).json({ error: "Failed to update applied recommendation" });
  }
}

module.exports = {
  buildIntelligenceProfile,
  generateWeeklyIntelligence,
  getIntelligenceBrief,
  getIntelligenceProfile,
  getIntelligenceTrends,
  regenerateIntelligence,
  getAppliedRecommendations,
  applyRecommendation,
  updateAppliedRecommendation,
};
