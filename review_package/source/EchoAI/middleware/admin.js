const db = require("../config/db");

/**
 * Admin middleware. Runs AFTER the auth middleware (so req.user is populated).
 *
 * The JWT only carries the user id and email, so the role is looked up fresh
 * from the database on every request — this means revoking admin access takes
 * effect immediately and a stale token can never grant admin powers.
 *
 * - Not authenticated / user missing -> 401
 * - Authenticated but not an admin   -> 403
 * - Admin                            -> attaches role to req.user and continues
 */
async function adminMiddleware(req, res, next) {
  if (!req.user || !req.user.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await db.query("SELECT role FROM users WHERE user_id = $1", [
      req.user.userId,
    ]);

    if (result.rows.length === 0 || result.rows[0].role !== "admin") {
      return res.status(403).json({ error: "Forbidden: admin access required" });
    }

    req.user.role = result.rows[0].role;
    return next();
  } catch (err) {
    console.error("Admin check error:", err);
    return res.status(500).json({ error: "Failed to verify admin access" });
  }
}

module.exports = adminMiddleware;
