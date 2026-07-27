const db = require("../config/db");

// Tour sequences the client can run. Kept in sync with the client tour builder
// (client/src/tour/tourSteps.js). Anything else is rejected so we never persist
// junk tour types.
const VALID_TOUR_TYPES = ["starter", "pro", "enterprise", "admin"];

function isValidTourType(tourType) {
  return VALID_TOUR_TYPES.includes(String(tourType || "").toLowerCase());
}

// Tour progress is identity-scoped: it belongs to the REAL authenticated user,
// not the remapped workspace owner, so each team member keeps their own tour.
function tourUserId(req) {
  return req.user.actualUserId || req.user.userId;
}

function serializeRow(row) {
  return {
    tourType: row.tour_type,
    currentStep: row.current_step,
    completed: row.completed,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/tour/status
 * Returns the authenticated user's progress for every tour they've touched as a
 * map keyed by tour type, e.g. { tours: { starter: { currentStep, completed } } }.
 * The client reads the entry for the tour matching its tier.
 */
async function getTourStatus(req, res) {
  try {
    const userId = tourUserId(req);
    const { rows } = await db.query(
      `SELECT tour_type, current_step, completed, completed_at, updated_at
         FROM tour_progress
        WHERE user_id = $1`,
      [userId],
    );

    const tours = {};
    for (const row of rows) {
      tours[row.tour_type] = serializeRow(row);
    }

    return res.json({ tours });
  } catch (err) {
    console.error("getTourStatus error:", err);
    return res.status(500).json({ error: "Failed to load tour status" });
  }
}

/**
 * POST /api/tour/progress
 * Body: { tourType, currentStep, completed? }
 * Upserts the user's progress for a tour. Used as the user advances step-by-step
 * so a half-finished tour can resume where they left off (even on another device).
 */
async function saveTourProgress(req, res) {
  const { tourType, currentStep, completed } = req.body || {};

  if (!isValidTourType(tourType)) {
    return res.status(400).json({ error: "Invalid tourType" });
  }

  const step = Number(currentStep);
  if (!Number.isInteger(step) || step < 0) {
    return res.status(400).json({ error: "currentStep must be a non-negative integer" });
  }

  const isComplete = completed === true;

  try {
    const userId = tourUserId(req);
    const { rows } = await db.query(
      `INSERT INTO tour_progress (user_id, tour_type, current_step, completed, completed_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN now() ELSE NULL END)
       ON CONFLICT (user_id, tour_type) DO UPDATE
         SET current_step = GREATEST(tour_progress.current_step, EXCLUDED.current_step),
             completed = tour_progress.completed OR EXCLUDED.completed,
             completed_at = CASE
               WHEN tour_progress.completed THEN tour_progress.completed_at
               WHEN EXCLUDED.completed THEN now()
               ELSE tour_progress.completed_at
             END
       RETURNING tour_type, current_step, completed, completed_at, updated_at`,
      [userId, String(tourType).toLowerCase(), step, isComplete],
    );

    return res.json(serializeRow(rows[0]));
  } catch (err) {
    console.error("saveTourProgress error:", err);
    return res.status(500).json({ error: "Failed to save tour progress" });
  }
}

/**
 * POST /api/tour/complete
 * Body: { tourType }
 * Marks a tour finished. Idempotent — re-completing keeps the first completion time.
 */
async function completeTour(req, res) {
  const { tourType } = req.body || {};

  if (!isValidTourType(tourType)) {
    return res.status(400).json({ error: "Invalid tourType" });
  }

  try {
    const userId = tourUserId(req);
    const { rows } = await db.query(
      `INSERT INTO tour_progress (user_id, tour_type, completed, completed_at)
       VALUES ($1, $2, TRUE, now())
       ON CONFLICT (user_id, tour_type) DO UPDATE
         SET completed = TRUE,
             completed_at = COALESCE(tour_progress.completed_at, now())
       RETURNING tour_type, current_step, completed, completed_at, updated_at`,
      [userId, String(tourType).toLowerCase()],
    );

    return res.json(serializeRow(rows[0]));
  } catch (err) {
    console.error("completeTour error:", err);
    return res.status(500).json({ error: "Failed to complete tour" });
  }
}

module.exports = { getTourStatus, saveTourProgress, completeTour };
