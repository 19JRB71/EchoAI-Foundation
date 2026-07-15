/**
 * Vision — Visual Intelligence Agent (Phase 1).
 *
 * Read endpoints for the Vision department page plus a manual "Study now"
 * trigger. The actual studying lives in utils/visionEngine.js; Forge consults
 * Vision in-process (getGuidanceForImageRequest), not over HTTP.
 *
 * Honesty: everything shown is real — knowledge rows Vision actually wrote,
 * run logs with true per-source counts, and real Forge consultation counts.
 * Empty states stay empty; nothing is fabricated.
 */

const db = require("../config/db");
const visionEngine = require("../utils/visionEngine");

/** Loads a brand (with owner industry) only if it belongs to the user. */
async function getOwnedBrand(userId, brandId) {
  const r = await db.query(
    `SELECT b.brand_id, b.brand_name, b.user_id, u.industry
     FROM brands b
     JOIN users u ON u.user_id = b.user_id
     WHERE b.brand_id = $1 AND b.user_id = $2`,
    [brandId, userId]
  );
  return r.rows[0] || null;
}

function requireBrandId(req, res) {
  const brandId = req.query.brandId || req.body.brandId;
  if (!brandId) {
    res.status(400).json({ error: "brandId is required" });
    return null;
  }
  return brandId;
}

/**
 * GET /api/vision/overview?brandId=...
 * The brand's visual knowledge base, latest study run, and Forge-impact stats.
 */
async function getOverview(req, res) {
  try {
    const brandId = requireBrandId(req, res);
    if (!brandId) return;
    const brand = await getOwnedBrand(req.user.userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const [knowledge, lastRun, consultStats] = await Promise.all([
      db.query(
        `SELECT industry, knowledge, confidence, version, sources_studied, last_studied_at
         FROM vision_knowledge WHERE brand_id = $1`,
        [brandId]
      ),
      db.query(
        `SELECT status, trigger, sources, summary, error, started_at, finished_at
         FROM vision_study_runs WHERE brand_id = $1
         ORDER BY started_at DESC LIMIT 1`,
        [brandId]
      ),
      db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS week
         FROM vision_guidance_log WHERE brand_id = $1`,
        [brandId]
      ),
    ]);

    const k = knowledge.rows[0] || null;
    return res.json({
      brandId,
      industry: k ? k.industry : brand.industry || null,
      knowledge: k
        ? {
            sections: k.knowledge,
            confidence: k.confidence,
            version: k.version,
            sourcesStudied: k.sources_studied,
            lastStudiedAt: k.last_studied_at,
          }
        : null,
      lastRun: lastRun.rows[0] || null,
      forgeImpact: {
        totalConsultations: consultStats.rows[0].total,
        consultationsThisWeek: consultStats.rows[0].week,
      },
      // Honest source disclosure for the UI — exactly what Phase 1 studies.
      sources: visionEngine.SOURCE_REGISTRY.map((s) => ({ key: s.key, label: s.label })),
    });
  } catch (err) {
    console.error("Vision overview error:", err.message);
    return res.status(500).json({ error: "Failed to load Vision overview" });
  }
}

/**
 * POST /api/vision/study  { brandId }
 * Manual study trigger. Runs synchronously (same engine as the daily sweep)
 * and returns the run outcome; AI failure surfaces as 502, never mocked.
 */
async function studyNow(req, res) {
  try {
    const brandId = requireBrandId(req, res);
    if (!brandId) return;
    const brand = await getOwnedBrand(req.user.userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const out = await visionEngine.studyBrand(brand, { trigger: "manual" });
    if (out.status === "skipped") {
      return res.status(409).json({
        error: "Vision is already studying this brand right now — check back in a moment.",
      });
    }
    if (out.status !== "completed") {
      return res.status(502).json({
        error: "Vision's study could not be completed this time. Nothing was changed — please try again shortly.",
        detail: out.error,
      });
    }
    return res.json({ status: "completed", summary: out.summary, confidence: out.confidence });
  } catch (err) {
    console.error("Vision study error:", err.message);
    return res.status(500).json({ error: "Failed to run Vision study" });
  }
}

/**
 * GET /api/vision/activity?brandId=...
 * Recent study runs and recent Forge consultations.
 */
async function getActivity(req, res) {
  try {
    const brandId = requireBrandId(req, res);
    if (!brandId) return;
    const brand = await getOwnedBrand(req.user.userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const [runs, consults] = await Promise.all([
      db.query(
        `SELECT status, trigger, sources, summary, error, started_at, finished_at
         FROM vision_study_runs WHERE brand_id = $1
         ORDER BY started_at DESC LIMIT 15`,
        [brandId]
      ),
      db.query(
        `SELECT requester, request_summary, knowledge_version, created_at
         FROM vision_guidance_log WHERE brand_id = $1
         ORDER BY created_at DESC LIMIT 15`,
        [brandId]
      ),
    ]);
    return res.json({ runs: runs.rows, consultations: consults.rows });
  } catch (err) {
    console.error("Vision activity error:", err.message);
    return res.status(500).json({ error: "Failed to load Vision activity" });
  }
}

module.exports = { getOverview, studyNow, getActivity };
