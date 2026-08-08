/**
 * Prompt 022 — Sage pre-interview research endpoints.
 *
 * POST /api/brands/:brandId/research  -> 202 { runId } (409 when already running)
 * GET  /api/brands/:brandId/research  -> { draft } (running or latest active)
 *
 * The draft is UNAPPROVED research only; nothing here writes brands columns.
 * Owner-scoped: both routes verify the brand belongs to the caller.
 */

const db = require("../config/db");
const sageResearch = require("../utils/sageResearch");

// Test hook (Company Truth pattern): awaits the background run.
let lastRunPromise = Promise.resolve();

async function getOwnedBrand(brandId, userId) {
  const { rows } = await db.query(
    `SELECT brand_id, user_id, brand_name, website_url, facebook_page_url, industry
       FROM brands WHERE brand_id = $1 AND user_id = $2`,
    [brandId, userId],
  );
  return rows[0] || null;
}

function draftView(row) {
  if (!row) return null;
  return {
    draftId: row.draft_id,
    runId: row.run_id,
    status: row.status,
    fields: row.fields || {},
    summary: row.summary,
    stopReason: row.stop_reason,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

async function startResearch(req, res, next) {
  try {
    const brand = await getOwnedBrand(req.params.brandId, req.user.userId);
    if (!brand) return res.status(404).json({ error: "Brand not found." });

    let claim;
    try {
      claim = await sageResearch.claimRun(brand.brand_id, req.user.userId);
    } catch (err) {
      if (err.inProgress) return res.status(409).json({ error: err.message });
      throw err;
    }

    lastRunPromise = sageResearch.runResearch(brand, { runId: claim.runId });
    return res.status(202).json({ runId: claim.runId, draftId: claim.draftId, status: "running" });
  } catch (err) {
    return next(err);
  }
}

async function getResearch(req, res, next) {
  try {
    const brand = await getOwnedBrand(req.params.brandId, req.user.userId);
    if (!brand) return res.status(404).json({ error: "Brand not found." });

    const { rows } = await db.query(
      `SELECT * FROM sage_research_drafts
        WHERE brand_id = $1 AND status IN ('running','complete','partial','empty','failed')
        ORDER BY (status = 'running') DESC, created_at DESC
        LIMIT 1`,
      [brand.brand_id],
    );
    return res.json({ draft: draftView(rows[0]) });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  startResearch,
  getResearch,
  get lastRunPromise() {
    return lastRunPromise;
  },
};
