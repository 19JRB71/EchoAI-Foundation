/**
 * Prompt 009 — read-only Approvals & Activity endpoints.
 *
 * Honest-state rule (Stage-1 B6/B8): these endpoints read ONLY
 * agent_tasks / agent_task_events. They never touch social_posts, never
 * mutate anything, and are owner-only (brand ownership enforced on every
 * read).
 */

const db = require("../config/db");

async function getOwnedBrand(userId, brandId) {
  const { rows } = await db.query(
    "SELECT brand_id FROM brands WHERE brand_id = $1 AND user_id = $2",
    [brandId, userId]
  );
  return rows[0] || null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/tasks/activity?brandId=
 * Newest-first canonical tasks for one owned brand (LIMIT 50).
 */
async function getActivity(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.query;
  if (!brandId || !UUID_RE.test(String(brandId))) {
    return res.status(400).json({ error: "A valid brandId is required" });
  }
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const { rows } = await db.query(
      `SELECT task_id, task_type, source_type, source_id, attempt, status,
              title, external_ref, proof_id, last_error, created_at, updated_at
         FROM agent_tasks
        WHERE brand_id = $1
        ORDER BY updated_at DESC
        LIMIT 50`,
      [brandId]
    );
    return res.json({ brandId, count: rows.length, tasks: rows });
  } catch (err) {
    console.error("Task activity error:", err.message);
    return res.status(500).json({ error: "Failed to load task activity" });
  }
}

/**
 * GET /api/tasks/:taskId/events
 * The full immutable trail for one task (ownership via the task's brand).
 */
async function getTaskEvents(req, res) {
  const userId = req.user.userId;
  const { taskId } = req.params;
  if (!taskId || !UUID_RE.test(taskId)) {
    return res.status(400).json({ error: "Invalid task id" });
  }
  try {
    const owned = await db.query(
      `SELECT t.task_id, t.status, t.title, t.external_ref, t.proof_id
         FROM agent_tasks t
         JOIN brands b ON b.brand_id = t.brand_id AND b.user_id = $2
        WHERE t.task_id = $1`,
      [taskId, userId]
    );
    if (owned.rows.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }
    const { rows } = await db.query(
      `SELECT event_id, actor, from_status, to_status, meta, created_at
         FROM agent_task_events
        WHERE task_id = $1
        ORDER BY created_at ASC, event_id ASC`,
      [taskId]
    );
    return res.json({ task: owned.rows[0], count: rows.length, events: rows });
  } catch (err) {
    console.error("Task events error:", err.message);
    return res.status(500).json({ error: "Failed to load the task trail" });
  }
}

module.exports = { getActivity, getTaskEvents };
