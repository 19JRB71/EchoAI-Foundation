/**
 * Portfolio controller — Echo, the Multi-Business Chief of Staff.
 *
 * Owner/admin-only API that spans ALL of an owner's REAL businesses (the demo
 * brand is excluded inside utils/portfolio.js, so every number here is real):
 *   GET  /api/portfolio/overview             Parts 1 + 7: cards, summary,
 *                                            unified approval queue + hot leads
 *   GET  /api/portfolio/health               Part 5: 12-week trajectory + latest
 *   POST /api/portfolio/health/run           recompute today's snapshot on demand
 *   GET  /api/portfolio/intelligence         Part 3: latest weekly AI report
 *   POST /api/portfolio/intelligence/generate  Part 3: generate this week's report
 *   GET  /api/portfolio/team                 Part 6: unified team across the acct
 *
 * AI failures map to 502 via sendError (err.aiInvalid / err.status). Health is
 * deterministic so /health/run never 502s.
 */

const db = require("../config/db");
const {
  gatherPortfolioOverview,
  healthTrajectory,
  latestHealth,
  snapshotHealth,
  realBrands,
  portfolioBusinessesForAI,
  weekDateFor,
} = require("../utils/portfolio");
const { generateCrossBusinessIntelligence } = require("../prompts/crossBusinessPrompt");

function sendError(res, err, fallbackStatus = 500) {
  const status = err && (err.aiInvalid || (err.status && err.status >= 400)) ? 502 : fallbackStatus;
  if (status === 502) {
    return res.status(502).json({
      error: "Echo's AI service is temporarily unavailable. Please try again shortly.",
    });
  }
  return res.status(status).json({ error: err.message || "Something went wrong." });
}

/** GET /api/portfolio/overview */
async function getOverview(req, res) {
  try {
    const data = await gatherPortfolioOverview(req.user.userId, {
      isAdmin: Boolean(req.user.isPlatformAdmin),
    });
    return res.json(data);
  } catch (err) {
    return sendError(res, err);
  }
}

/** GET /api/portfolio/health — 12-week trajectory + latest score per business. */
async function getHealth(req, res) {
  try {
    const [trajectory, brands] = await Promise.all([
      healthTrajectory(req.user.userId),
      realBrands(req.user.userId),
    ]);
    const latest = await Promise.all(
      brands.map(async (b) => ({
        brandId: b.brand_id,
        name: b.brand_name,
        health: await latestHealth(b.brand_id),
      })),
    );
    return res.json({ ...trajectory, latest });
  } catch (err) {
    return sendError(res, err);
  }
}

/** POST /api/portfolio/health/run — recompute today's health for every business. */
async function runHealth(req, res) {
  try {
    const brands = await realBrands(req.user.userId);
    const results = [];
    for (const b of brands) {
      const snap = await snapshotHealth(b.brand_id);
      results.push({ brandId: b.brand_id, name: b.brand_name, ...snap });
    }
    return res.json({ updated: results.length, results });
  } catch (err) {
    return sendError(res, err);
  }
}

/** GET /api/portfolio/intelligence — latest stored weekly cross-business report. */
async function getIntelligence(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT week_date, report, ai_analysis, created_at
       FROM cross_business_intelligence
       WHERE user_id = $1
       ORDER BY week_date DESC LIMIT 1`,
      [req.user.userId],
    );
    if (!rows[0]) return res.json({ report: null });
    return res.json({
      weekDate: rows[0].week_date,
      report: rows[0].report,
      aiAnalysis: rows[0].ai_analysis,
      createdAt: rows[0].created_at,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

/** POST /api/portfolio/intelligence/generate — generate this week's report. */
async function generateIntelligence(req, res) {
  try {
    const businesses = await portfolioBusinessesForAI(req.user.userId);
    if (businesses.length < 2) {
      return res.status(400).json({
        error:
          "Cross-business intelligence needs at least two businesses. Add another business to unlock it.",
      });
    }

    const result = await generateCrossBusinessIntelligence(businesses);
    const weekDate = weekDateFor();

    await db.query(
      `INSERT INTO cross_business_intelligence (user_id, week_date, report, ai_analysis)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, week_date)
       DO UPDATE SET report = EXCLUDED.report, ai_analysis = EXCLUDED.ai_analysis`,
      [req.user.userId, weekDate, JSON.stringify(result), result.summary],
    );

    return res.json({ weekDate, report: result, aiAnalysis: result.summary });
  } catch (err) {
    return sendError(res, err);
  }
}

/** GET /api/portfolio/team — every teammate across the whole account. */
async function getTeam(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT tm.team_member_id, tm.email, tm.role, tm.status,
              tm.invited_at, tm.accepted_at, u.user_id AS linked_user_id
       FROM team_members tm
       LEFT JOIN users u ON u.user_id = tm.invited_user_id
       WHERE tm.account_owner_user_id = $1
       ORDER BY tm.created_at ASC`,
      [req.user.userId],
    );

    const members = rows.map((r) => ({
      teamMemberId: r.team_member_id,
      email: r.email,
      role: r.role,
      status: r.status,
      invitedAt: r.invited_at,
      acceptedAt: r.accepted_at,
      linkedUserId: r.linked_user_id,
    }));

    const byRole = members.reduce((acc, m) => {
      acc[m.role] = (acc[m.role] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      members,
      summary: {
        total: members.length,
        active: members.filter((m) => m.status === "active").length,
        pending: members.filter((m) => m.status === "pending").length,
        byRole,
      },
    });
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = {
  getOverview,
  getHealth,
  runHealth,
  getIntelligence,
  generateIntelligence,
  getTeam,
};
