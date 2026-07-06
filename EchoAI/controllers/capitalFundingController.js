/**
 * Capital & Funding controller (Enterprise feature) — Scout's opportunity &
 * capital intelligence engine.
 *
 * Two AI-driven engines plus a grant writer power this subsystem:
 *   1. Funding intelligence — scanFundingForBrand(brand) studies the business
 *      profile and surfaces real funding programs (Federal/SBA/USDA/Florida/
 *      Foundation) into funding_opportunities, each with a fit/impact/probability
 *      read and an apply/consider/skip call. Weekly scans dedup in place.
 *   2. Opportunity intelligence — generateOpportunityBriefing(brand) produces the
 *      weekly ranked opportunity briefing (business opportunities, competitor
 *      weaknesses, market trends, partnerships, trending topics) into
 *      opportunity_briefings.
 *   3. Grant writer — draftApplicationForOpportunity(...) has Echo write a full,
 *      submission-ready grant application from brand discovery + owner story.
 *
 * runWeeklyOpportunityScanForBrand(brand) wires both engines into the Monday
 * scheduler. Because that is a background path, it enforces the Enterprise tier
 * itself (route featureGate never runs there). All AI failures map to HTTP 502
 * (never mocked); ownership is enforced via getOwnedBrand (brand.user_id).
 */

const db = require("../config/db");
const { sageContextForBrand } = require("../utils/sageContext");
const { meetsTier } = require("../config/tiers");
const { getUserTier } = require("../middleware/featureGate");
const { generateFundingOpportunities } = require("../prompts/fundingIntelligencePrompt");
const { generateOpportunityIntelligence } = require("../prompts/opportunityIntelligencePrompt");
const { draftGrantApplication } = require("../prompts/grantWriterPrompt");

const CAPITAL_TIER = "enterprise";
const APP_STATUSES = new Set(["draft", "in_progress", "submitted", "awarded", "declined"]);

/** Loads a brand only if it belongs to the authenticated user. */
async function getOwnedBrand(userId, brandId) {
  const result = await db.query(
    `SELECT brand_id, user_id, brand_name, brand_personality, voice_description,
            target_audience, tagline
     FROM brands
     WHERE brand_id = $1 AND user_id = $2`,
    [brandId, userId],
  );
  return result.rows[0] || null;
}

/** Maps any thrown error to the right HTTP status (AI/provider failures → 502). */
function sendError(res, err, fallbackMsg) {
  if (err.aiInvalid || (typeof err.status === "number" && err.status >= 400)) {
    return res.status(502).json({
      error:
        "Scout could not complete this AI research right now. Please try again shortly.",
    });
  }
  console.error("capitalFunding error:", err.message);
  return res.status(500).json({ error: fallbackMsg });
}

function weekDateFor(date = new Date()) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/* --------------------------- profile & context ---------------------------- */

/**
 * Builds a modest, grounded business profile for the funding + opportunity
 * agents: real lead/campaign activity, the latest ROI snapshot, and the latest
 * competitor intelligence report. No HTTP concerns.
 */
async function buildOpportunityProfile(brandId) {
  const [leadsRow, campaignsRow, roiRow, competitorRow] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE temperature = 'hot')::int AS hot,
              COUNT(*) FILTER (WHERE conversion_status = 'converted')::int AS converted,
              COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days')::int AS last_90d
       FROM leads WHERE brand_id = $1`,
      [brandId],
    ),
    db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'active')::int AS active,
              COALESCE(SUM(budget), 0)::numeric AS total_budget
       FROM campaigns WHERE brand_id = $1`,
      [brandId],
    ),
    db.query(
      `SELECT period_start, period_end, total_spend, total_revenue,
              total_leads, total_conversions, roi_percentage
       FROM roi_advanced_snapshots
       WHERE brand_id = $1
       ORDER BY period_end DESC LIMIT 1`,
      [brandId],
    ),
    db.query(
      `SELECT competitor_names, intelligence_report, created_at
       FROM competitor_intelligence
       WHERE brand_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [brandId],
    ),
  ]);

  const leads = leadsRow.rows[0] || {};
  const campaigns = campaignsRow.rows[0] || {};
  const roi = roiRow.rows[0] || null;
  const competitor = competitorRow.rows[0] || null;

  return {
    activity: {
      totalLeads: leads.total || 0,
      hotLeads: leads.hot || 0,
      convertedLeads: leads.converted || 0,
      leadsLast90Days: leads.last_90d || 0,
      totalCampaigns: campaigns.total || 0,
      activeCampaigns: campaigns.active || 0,
      totalAdBudget: Number(campaigns.total_budget) || 0,
    },
    roi: roi
      ? {
          periodStart: roi.period_start,
          periodEnd: roi.period_end,
          totalSpend: Number(roi.total_spend) || 0,
          totalRevenue: Number(roi.total_revenue) || 0,
          totalLeads: roi.total_leads || 0,
          totalConversions: roi.total_conversions || 0,
          roiPercentage: roi.roi_percentage != null ? Number(roi.roi_percentage) : null,
        }
      : null,
    competitorIntelligence: competitor
      ? {
          competitors: competitor.competitor_names || [],
          report: competitor.intelligence_report || null,
          generatedAt: competitor.created_at,
        }
      : null,
  };
}

/** Pulls the owner's story/mission/goals for the grant writer. */
async function buildOwnerContext(userId) {
  const [userRow, profileRow] = await Promise.all([
    db.query("SELECT first_name, last_name, email FROM users WHERE user_id = $1", [userId]),
    db.query(
      `SELECT risk_tolerance, core_values, blind_spots, decision_patterns,
              preferences, communication_style, goals
       FROM echo_owner_profile WHERE user_id = $1`,
      [userId],
    ),
  ]);
  const u = userRow.rows[0] || {};
  const p = profileRow.rows[0] || {};
  return {
    ownerName: [u.first_name, u.last_name].filter(Boolean).join(" ") || "",
    ownerEmail: u.email || "",
    values: p.core_values || "",
    goals: p.goals || "",
    riskTolerance: p.risk_tolerance || "",
    decisionPatterns: p.decision_patterns || "",
    preferences: p.preferences || "",
  };
}

/* ----------------------------- funding engine ----------------------------- */

/**
 * Runs the funding-intelligence AI for one brand and upserts the results into
 * funding_opportunities, deduping in place on (brand_id, source, lower(name)).
 * The upsert deliberately does NOT touch `status`, so a program the owner
 * dismissed stays dismissed across weekly rescans. Returns the count upserted.
 * Throws on AI failure (caller decides best-effort vs HTTP 502).
 */
async function scanFundingForBrand(brand) {
  const profile = await buildOpportunityProfile(brand.brand_id);
  const opportunities = await generateFundingOpportunities(brand, profile);

  for (const o of opportunities) {
    await db.query(
      `INSERT INTO funding_opportunities
         (brand_id, source, name, award_amount, amount_max, deadline, deadline_text,
          eligibility, description, recommendation, rationale, fit_score,
          impact_score, probability_score, priority_score, official_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (brand_id, source, lower(name))
       DO UPDATE SET award_amount = EXCLUDED.award_amount,
                     amount_max = EXCLUDED.amount_max,
                     deadline = EXCLUDED.deadline,
                     deadline_text = EXCLUDED.deadline_text,
                     eligibility = EXCLUDED.eligibility,
                     description = EXCLUDED.description,
                     recommendation = EXCLUDED.recommendation,
                     rationale = EXCLUDED.rationale,
                     fit_score = EXCLUDED.fit_score,
                     impact_score = EXCLUDED.impact_score,
                     probability_score = EXCLUDED.probability_score,
                     priority_score = EXCLUDED.priority_score,
                     official_url = EXCLUDED.official_url,
                     updated_at = NOW()`,
      [
        brand.brand_id,
        o.source,
        o.name,
        o.awardAmount,
        o.amountMax,
        o.deadline,
        o.deadlineText,
        o.eligibility,
        o.description,
        o.recommendation,
        o.rationale,
        o.fitScore,
        o.impactScore,
        o.probabilityScore,
        o.priorityScore,
        o.officialUrl,
      ],
    );
  }
  return opportunities.length;
}

function mapOpportunityRow(r) {
  return {
    opportunityId: r.opportunity_id,
    source: r.source,
    name: r.name,
    awardAmount: r.award_amount,
    amountMax: r.amount_max != null ? Number(r.amount_max) : null,
    deadline: r.deadline,
    deadlineText: r.deadline_text,
    eligibility: r.eligibility,
    description: r.description,
    recommendation: r.recommendation,
    rationale: r.rationale,
    fitScore: r.fit_score,
    impactScore: r.impact_score,
    probabilityScore: r.probability_score,
    priorityScore: r.priority_score != null ? Number(r.priority_score) : 0,
    officialUrl: r.official_url,
    status: r.status,
    hasApplication: r.application_id != null,
    applicationId: r.application_id || null,
    applicationStatus: r.application_status || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function listOpportunityRows(brandId) {
  const { rows } = await db.query(
    `SELECT o.*, a.application_id, a.status AS application_status
     FROM funding_opportunities o
     LEFT JOIN grant_applications a ON a.opportunity_id = o.opportunity_id
     WHERE o.brand_id = $1 AND o.status = 'identified'
     ORDER BY o.priority_score DESC, o.updated_at DESC`,
    [brandId],
  );
  return rows.map(mapOpportunityRow);
}

/* -------------------------- opportunity briefing -------------------------- */

/**
 * Runs the opportunity-intelligence AI for one brand and upserts this week's
 * opportunity_briefings row. Throws on AI failure. Returns the briefing object.
 */
async function generateOpportunityBriefing(brand) {
  const profile = await buildOpportunityProfile(brand.brand_id);
  brand._sageContext = await sageContextForBrand(brand.brand_id);
  const brief = await generateOpportunityIntelligence(brand, profile);
  const weekDate = weekDateFor();

  const { rows } = await db.query(
    `INSERT INTO opportunity_briefings
       (brand_id, week_date, summary, opportunities, competitor_weaknesses,
        market_trends, partnerships, trending_topics)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (brand_id, week_date)
     DO UPDATE SET summary = EXCLUDED.summary,
                   opportunities = EXCLUDED.opportunities,
                   competitor_weaknesses = EXCLUDED.competitor_weaknesses,
                   market_trends = EXCLUDED.market_trends,
                   partnerships = EXCLUDED.partnerships,
                   trending_topics = EXCLUDED.trending_topics
     RETURNING briefing_id, week_date, created_at`,
    [
      brand.brand_id,
      weekDate,
      brief.summary,
      JSON.stringify(brief.opportunities),
      JSON.stringify(brief.competitorWeaknesses),
      JSON.stringify(brief.marketTrends),
      JSON.stringify(brief.partnerships),
      JSON.stringify(brief.trendingTopics),
    ],
  );
  const row = rows[0];
  return {
    briefingId: row.briefing_id,
    weekDate: row.week_date,
    createdAt: row.created_at,
    ...brief,
  };
}

function mapBriefingRow(r) {
  return {
    briefingId: r.briefing_id,
    weekDate: r.week_date,
    createdAt: r.created_at,
    summary: r.summary,
    opportunities: r.opportunities || [],
    competitorWeaknesses: r.competitor_weaknesses || [],
    marketTrends: r.market_trends || [],
    partnerships: r.partnerships || [],
    trendingTopics: r.trending_topics || [],
  };
}

/* ------------------------------ grant writer ------------------------------ */

function mapApplicationRow(r) {
  return {
    applicationId: r.application_id,
    opportunityId: r.opportunity_id,
    grantName: r.grant_name,
    status: r.status,
    draftSummary: r.draft_summary,
    draftSections: r.draft_sections || [],
    awardAmount: r.award_amount,
    deadline: r.deadline,
    notes: r.notes,
    submittedAt: r.submitted_at,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Has Echo draft a full grant application for one owned opportunity and upserts
 * it into grant_applications (one draft per opportunity — re-drafting replaces
 * the draft in place, preserving the owner's status/notes). Throws on AI failure.
 */
async function draftApplicationForOpportunity(brand, opportunity, userId) {
  const owner = await buildOwnerContext(userId);
  const metrics = await buildOpportunityProfile(brand.brand_id);
  const draft = await draftGrantApplication({ brand, owner, opportunity, metrics });

  const { rows } = await db.query(
    `INSERT INTO grant_applications
       (brand_id, opportunity_id, grant_name, status, draft_summary,
        draft_sections, award_amount, deadline)
     VALUES ($1,$2,$3,'draft',$4,$5,$6,$7)
     ON CONFLICT (opportunity_id)
     DO UPDATE SET grant_name = EXCLUDED.grant_name,
                   draft_summary = EXCLUDED.draft_summary,
                   draft_sections = EXCLUDED.draft_sections,
                   award_amount = EXCLUDED.award_amount,
                   deadline = EXCLUDED.deadline,
                   updated_at = NOW()
     RETURNING *`,
    [
      brand.brand_id,
      opportunity.opportunity_id,
      opportunity.name,
      draft.summary,
      JSON.stringify(draft.sections),
      opportunity.award_amount,
      opportunity.deadline,
    ],
  );
  return mapApplicationRow(rows[0]);
}

/* ------------------------- weekly scheduler entry ------------------------- */

/**
 * Weekly (Monday) scan for one brand: funding scan + opportunity briefing.
 * Enterprise-gated at the source because the scheduler is a background path that
 * never runs route featureGate — a non-Enterprise owner is skipped entirely.
 * Each engine is best-effort so one AI failure doesn't block the other.
 */
async function runWeeklyOpportunityScanForBrand(brand) {
  const { tier, role } = await getUserTier(brand.user_id);
  if (role !== "admin" && !meetsTier(tier, CAPITAL_TIER)) return;

  const brandRow = brand.brand_name
    ? brand
    : (await db.query(
        `SELECT brand_id, user_id, brand_name, brand_personality, voice_description,
                target_audience, tagline
         FROM brands WHERE brand_id = $1`,
        [brand.brand_id],
      )).rows[0];
  if (!brandRow) return;

  try {
    await scanFundingForBrand(brandRow);
  } catch (err) {
    console.error(`Weekly funding scan failed for brand ${brandRow.brand_id}:`, err.message);
  }
  try {
    await generateOpportunityBriefing(brandRow);
  } catch (err) {
    console.error(`Weekly opportunity briefing failed for brand ${brandRow.brand_id}:`, err.message);
  }
}

/* -------------------------------- routes ---------------------------------- */

// GET /api/capital/:brandId/opportunities
async function getOpportunities(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    return res.json({ opportunities: await listOpportunityRows(brand.brand_id) });
  } catch (err) {
    return sendError(res, err, "Failed to load funding opportunities.");
  }
}

// POST /api/capital/:brandId/scan  — regenerate the funding scan on demand.
async function scanFunding(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const count = await scanFundingForBrand(brand);
    return res.json({ scanned: count, opportunities: await listOpportunityRows(brand.brand_id) });
  } catch (err) {
    return sendError(res, err, "Failed to scan for funding opportunities.");
  }
}

// POST /api/capital/:brandId/opportunities/:opportunityId/dismiss
async function dismissOpportunity(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const { rowCount } = await db.query(
      `UPDATE funding_opportunities SET status = 'dismissed', updated_at = NOW()
       WHERE opportunity_id = $1 AND brand_id = $2 AND status = 'identified'`,
      [req.params.opportunityId, brand.brand_id],
    );
    if (rowCount === 0) return res.status(404).json({ error: "Opportunity not found" });
    return res.json({ ok: true });
  } catch (err) {
    return sendError(res, err, "Failed to dismiss the opportunity.");
  }
}

// GET /api/capital/:brandId/briefing — latest weekly opportunity briefing.
async function getBriefing(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const { rows } = await db.query(
      `SELECT * FROM opportunity_briefings
       WHERE brand_id = $1 ORDER BY week_date DESC LIMIT 1`,
      [brand.brand_id],
    );
    return res.json({ ready: rows.length > 0, briefing: rows[0] ? mapBriefingRow(rows[0]) : null });
  } catch (err) {
    return sendError(res, err, "Failed to load the opportunity briefing.");
  }
}

// POST /api/capital/:brandId/briefing/generate — regenerate on demand.
async function generateBriefing(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const briefing = await generateOpportunityBriefing(brand);
    return res.json({ ready: true, briefing });
  } catch (err) {
    return sendError(res, err, "Failed to generate the opportunity briefing.");
  }
}

// GET /api/capital/:brandId/pipeline — funding pipeline overview.
async function getPipeline(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const [oppRow, apps, deadlines] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS identified,
                COUNT(*) FILTER (WHERE recommendation = 'apply')::int AS recommended
         FROM funding_opportunities WHERE brand_id = $1 AND status = 'identified'`,
        [brand.brand_id],
      ),
      db.query(
        `SELECT * FROM grant_applications WHERE brand_id = $1 ORDER BY created_at DESC`,
        [brand.brand_id],
      ),
      db.query(
        `SELECT opportunity_id, name, source, deadline, deadline_text, priority_score
         FROM funding_opportunities
         WHERE brand_id = $1 AND status = 'identified' AND deadline IS NOT NULL
           AND deadline >= CURRENT_DATE
         ORDER BY deadline ASC LIMIT 10`,
        [brand.brand_id],
      ),
    ]);

    const applications = apps.rows.map(mapApplicationRow);
    const counts = oppRow.rows[0] || { identified: 0, recommended: 0 };
    return res.json({
      opportunities: { identified: counts.identified, recommended: counts.recommended },
      applications,
      inProgress: applications.filter((a) => a.status === "draft" || a.status === "in_progress"),
      submitted: applications.filter((a) => a.status === "submitted"),
      pendingDecisions: applications.filter((a) => a.status === "submitted"),
      decided: applications.filter((a) => a.status === "awarded" || a.status === "declined"),
      upcomingDeadlines: deadlines.rows.map((d) => ({
        opportunityId: d.opportunity_id,
        name: d.name,
        source: d.source,
        deadline: d.deadline,
        deadlineText: d.deadline_text,
        priorityScore: d.priority_score != null ? Number(d.priority_score) : 0,
      })),
    });
  } catch (err) {
    return sendError(res, err, "Failed to load the funding pipeline.");
  }
}

// POST /api/capital/:brandId/opportunities/:opportunityId/draft — Echo drafts.
async function draftApplication(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const { rows } = await db.query(
      `SELECT * FROM funding_opportunities WHERE opportunity_id = $1 AND brand_id = $2`,
      [req.params.opportunityId, brand.brand_id],
    );
    if (rows.length === 0) return res.status(404).json({ error: "Opportunity not found" });
    const application = await draftApplicationForOpportunity(brand, rows[0], req.user.userId);
    return res.json({ application });
  } catch (err) {
    return sendError(res, err, "Failed to draft the grant application.");
  }
}

// GET /api/capital/:brandId/applications
async function listApplications(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const { rows } = await db.query(
      `SELECT * FROM grant_applications WHERE brand_id = $1 ORDER BY created_at DESC`,
      [brand.brand_id],
    );
    return res.json({ applications: rows.map(mapApplicationRow) });
  } catch (err) {
    return sendError(res, err, "Failed to load grant applications.");
  }
}

// GET /api/capital/:brandId/applications/:applicationId
async function getApplication(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const { rows } = await db.query(
      `SELECT * FROM grant_applications WHERE application_id = $1 AND brand_id = $2`,
      [req.params.applicationId, brand.brand_id],
    );
    if (rows.length === 0) return res.status(404).json({ error: "Application not found" });
    return res.json({ application: mapApplicationRow(rows[0]) });
  } catch (err) {
    return sendError(res, err, "Failed to load the grant application.");
  }
}

// PATCH /api/capital/:brandId/applications/:applicationId — status/notes.
async function updateApplication(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.params.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const body = req.body || {};
    const sets = [];
    const params = [];
    let i = 1;

    if (body.status !== undefined) {
      const status = String(body.status);
      if (!APP_STATUSES.has(status)) {
        return res.status(400).json({ error: "Invalid application status" });
      }
      sets.push(`status = $${i++}`);
      params.push(status);
      // Stamp lifecycle timestamps on the relevant transitions.
      if (status === "submitted") sets.push("submitted_at = NOW()");
      if (status === "awarded" || status === "declined") sets.push("decided_at = NOW()");
    }
    if (body.notes !== undefined) {
      sets.push(`notes = $${i++}`);
      params.push(typeof body.notes === "string" ? body.notes : "");
    }
    if (sets.length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }
    sets.push("updated_at = NOW()");

    params.push(req.params.applicationId, brand.brand_id);
    const { rows } = await db.query(
      `UPDATE grant_applications SET ${sets.join(", ")}
       WHERE application_id = $${i++} AND brand_id = $${i}
       RETURNING *`,
      params,
    );
    if (rows.length === 0) return res.status(404).json({ error: "Application not found" });
    return res.json({ application: mapApplicationRow(rows[0]) });
  } catch (err) {
    return sendError(res, err, "Failed to update the grant application.");
  }
}

module.exports = {
  // engines (used by scheduler + tests)
  buildOpportunityProfile,
  scanFundingForBrand,
  generateOpportunityBriefing,
  draftApplicationForOpportunity,
  runWeeklyOpportunityScanForBrand,
  weekDateFor,
  // route handlers
  getOpportunities,
  scanFunding,
  dismissOpportunity,
  getBriefing,
  generateBriefing,
  getPipeline,
  draftApplication,
  listApplications,
  getApplication,
  updateApplication,
};
