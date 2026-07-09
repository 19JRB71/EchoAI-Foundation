/**
 * Feature Suggestions — admin API.
 *
 * Read-only listing of everything users have asked Echo for that it can't do
 * yet (most-requested first), plus a status setter so the admin can track
 * pending → in_development → completed. Mounted under /api/admin (auth +
 * admin role enforced by adminRoutes).
 */

const db = require("../config/db");
const { STATUSES } = require("../utils/featureSuggestions");

/** GET /api/admin/feature-suggestions — all suggestions, most requested first. */
async function listSuggestions(req, res) {
  try {
    const result = await db.query(
      `SELECT s.suggestion_id, s.title, s.description, s.request_count, s.status,
              s.first_requested_at, s.last_requested_at,
              (SELECT COUNT(DISTINCT r.user_id) FROM feature_suggestion_requests r
                WHERE r.suggestion_id = s.suggestion_id AND r.user_id IS NOT NULL) AS distinct_users
       FROM feature_suggestions s
       ORDER BY s.request_count DESC, s.last_requested_at DESC`
    );
    return res.json({
      suggestions: result.rows.map((r) => ({
        suggestionId: r.suggestion_id,
        title: r.title,
        description: r.description,
        requestCount: Number(r.request_count),
        distinctUsers: Number(r.distinct_users),
        status: r.status,
        firstRequestedAt: r.first_requested_at,
        lastRequestedAt: r.last_requested_at,
      })),
    });
  } catch (err) {
    console.error("List feature suggestions failed:", err.message);
    return res.status(500).json({ error: "Couldn't load feature suggestions." });
  }
}

/** GET /api/admin/feature-suggestions/:suggestionId/requests — verbatim asks. */
async function listSuggestionRequests(req, res) {
  try {
    const { suggestionId } = req.params;
    const result = await db.query(
      `SELECT r.request_id, r.request_text, r.created_at, u.email
       FROM feature_suggestion_requests r
       LEFT JOIN users u ON u.user_id = r.user_id
       WHERE r.suggestion_id = $1
       ORDER BY r.created_at DESC
       LIMIT 100`,
      [suggestionId]
    );
    return res.json({
      requests: result.rows.map((r) => ({
        requestId: r.request_id,
        requestText: r.request_text,
        email: r.email || null,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error("List suggestion requests failed:", err.message);
    return res.status(500).json({ error: "Couldn't load the individual requests." });
  }
}

/** PUT /api/admin/feature-suggestions/:suggestionId/status — { status }. */
async function updateSuggestionStatus(req, res) {
  try {
    const { suggestionId } = req.params;
    const status = req.body && req.body.status;
    if (!STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ error: `Status must be one of: ${STATUSES.join(", ")}.` });
    }
    const result = await db.query(
      `UPDATE feature_suggestions
       SET status = $1, updated_at = NOW()
       WHERE suggestion_id = $2
       RETURNING suggestion_id, status`,
      [status, suggestionId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Suggestion not found." });
    }
    return res.json({ suggestionId: result.rows[0].suggestion_id, status: result.rows[0].status });
  } catch (err) {
    console.error("Update suggestion status failed:", err.message);
    return res.status(500).json({ error: "Couldn't update the suggestion status." });
  }
}

module.exports = { listSuggestions, listSuggestionRequests, updateSuggestionStatus };
