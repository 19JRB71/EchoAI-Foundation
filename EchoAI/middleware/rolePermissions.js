// Role-permission middleware for workspace team members.
//
// Roles rank: viewer < manager < admin < owner. The platform admin
// (`req.user.isPlatformAdmin`) bypasses every check. Workspace role is resolved
// by the auth middleware as `req.user.workspaceRole`.
//
//   Viewer  — read only; cannot mutate campaigns/content/leads/calls/social.
//   Manager — can run the platform, but no billing/subscription/team access.
//   Admin   — can manage the team + billing, but cannot delete the account.
//   Owner   — full control.

const RANK = { viewer: 1, manager: 2, admin: 3, owner: 4 };
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function roleRank(req) {
  return RANK[req.user && req.user.workspaceRole] || 0;
}

function isPlatformAdmin(req) {
  return Boolean(req.user && req.user.isPlatformAdmin);
}

/**
 * Requires the workspace role to be at least `minRole`. Used to keep managers
 * (and below) out of billing / subscription / team-management routes by
 * requiring 'admin', for example.
 */
function requireRole(minRole) {
  const need = RANK[minRole] || 0;
  return function (req, res, next) {
    if (isPlatformAdmin(req)) return next();
    if (roleRank(req) >= need) return next();
    return res.status(403).json({
      error: `This action requires the ${minRole} role or higher.`,
      requiredRole: minRole,
      currentRole: (req.user && req.user.workspaceRole) || null,
    });
  };
}

/**
 * Blocks viewers from any state-changing request (POST/PUT/PATCH/DELETE) while
 * still allowing GETs. Applied to the route groups a viewer may read but not
 * modify (campaigns, content, leads, calls, social posts).
 */
function denyViewerMutations(req, res, next) {
  if (isPlatformAdmin(req)) return next();
  if (
    req.user &&
    req.user.workspaceRole === "viewer" &&
    MUTATING_METHODS.has(req.method)
  ) {
    return res.status(403).json({
      error:
        "Viewers have read-only access. Ask an account admin to change your role to make changes.",
      currentRole: "viewer",
    });
  }
  return next();
}

/**
 * Allows only the account owner (or platform admin). Used for destructive
 * account-level actions such as account deletion — a team admin is blocked.
 */
function requireOwner(req, res, next) {
  if (isPlatformAdmin(req)) return next();
  if (req.user && req.user.workspaceRole === "owner") return next();
  return res.status(403).json({
    error: "Only the account owner can perform this action.",
  });
}

module.exports = { requireRole, denyViewerMutations, requireOwner, roleRank, RANK };
