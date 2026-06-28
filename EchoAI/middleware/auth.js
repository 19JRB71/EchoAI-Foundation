const jwt = require("jsonwebtoken");
const db = require("../config/db");

/**
 * Auth middleware: verifies a JWT from the Authorization header.
 * Expects a header of the form:  Authorization: Bearer <token>
 *
 * - Missing or malformed token   -> 401
 * - Invalid or expired token     -> 401
 * - Valid token                  -> attaches identity to req.user and continues
 *
 * Workspace resolution
 * --------------------
 * EchoAI supports team members: a user can be invited into another account
 * owner's workspace with a role. To make the entire existing (user_id-scoped)
 * codebase operate transparently inside the employer's workspace, we remap the
 * EFFECTIVE user id for active team members:
 *
 *   req.user.userId        -> the workspace owner's id (what data is scoped to)
 *   req.user.actualUserId  -> the real authenticated user's id (identity/audit)
 *   req.user.workspaceRole -> 'owner' | 'admin' | 'manager' | 'viewer'
 *   req.user.isTeamMember  -> boolean
 *   req.user.isPlatformAdmin -> boolean (users.role = 'admin')
 *
 * Identity-sensitive endpoints (profile, team management, push) must use
 * actualUserId. The remap is skipped for the mobile API (`/api/v2*`), which
 * keeps its own real-identity model, and for platform admins (full access to
 * their own workspace, exempt from all team/role logic).
 */
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: no token provided" });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: no token provided" });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized: invalid or expired token" });
  }

  // Sensible defaults: the user acts as the owner of their own workspace.
  req.user = {
    ...decoded,
    userId: decoded.userId,
    actualUserId: decoded.userId,
    workspaceRole: "owner",
    isTeamMember: false,
    isPlatformAdmin: false,
  };

  // Resolve platform-admin status and any active team membership. Best-effort:
  // any failure leaves the user as the owner of their own workspace.
  try {
    const { rows } = await db.query(
      `SELECT u.role AS platform_role,
              tm.account_owner_user_id AS owner_id,
              tm.role AS team_role
         FROM users u
         LEFT JOIN LATERAL (
           SELECT account_owner_user_id, role
             FROM team_members
            WHERE invited_user_id = u.user_id AND status = 'active'
            ORDER BY accepted_at DESC NULLS LAST
            LIMIT 1
         ) tm ON TRUE
        WHERE u.user_id = $1`,
      [decoded.userId]
    );

    const row = rows[0];
    if (row) {
      req.user.isPlatformAdmin = row.platform_role === "admin";

      const isV2 = (req.baseUrl || "").startsWith("/api/v2");
      if (!req.user.isPlatformAdmin && !isV2 && row.owner_id) {
        req.user.userId = row.owner_id;
        req.user.workspaceRole = row.team_role;
        req.user.isTeamMember = true;
      }
    }
  } catch (err) {
    // Fall back to self-owned workspace; never block the request on this lookup.
  }

  return next();
}

module.exports = authMiddleware;
