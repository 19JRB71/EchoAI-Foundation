// Role-permission middleware for workspace team members.
//
// Roles rank: sales_rep = viewer < manager < admin < owner. The platform admin
// (`req.user.isPlatformAdmin`) bypasses every check. Workspace role is resolved
// by the auth middleware as `req.user.workspaceRole`.
//
//   Sales Rep — works ONE assigned lead at a time from the CRM queue. No access
//               to the lead list, phone numbers (masked), or any other section.
//   Viewer    — legacy read-only role (retired from the UI; treated read-only).
//   Manager   — READ-ONLY across the whole platform. Can see everything, change
//               nothing. Cannot access billing/subscription/team management.
//   Admin     — full read + write, can manage the team + billing, but cannot
//               delete the account (owner-only).
//   Owner     — full control.
//
// "Writer" roles are owner + admin only. Everyone else is read-only on the
// shared route groups and is blocked from any state-changing request there.

const RANK = { sales_rep: 1, viewer: 1, manager: 2, admin: 3, owner: 4 };
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
 * Blocks any read-only role (manager, viewer, sales_rep) from a state-changing
 * request (POST/PUT/PATCH/DELETE) while still allowing GETs. Only owners and
 * admins (writers) may mutate the shared route groups. Applied to the route
 * groups a manager may read but not modify (campaigns, content, leads, calls,
 * social, etc.). Managers are read-only by design.
 */
function denyReadOnlyMutations(req, res, next) {
  if (isPlatformAdmin(req)) return next();
  if (MUTATING_METHODS.has(req.method) && roleRank(req) < RANK.admin) {
    return res.status(403).json({
      error:
        "Your role has read-only access. Ask an account admin to make changes.",
      currentRole: (req.user && req.user.workspaceRole) || null,
    });
  }
  return next();
}

/**
 * Blocks sales reps from a route group entirely (any method). Sales reps only
 * ever touch their own CRM queue endpoints; they must never reach the full lead
 * list, call history (unmasked numbers), or other sections. Managers/admins are
 * unaffected here (their read/write scope is governed elsewhere).
 */
function denySalesRep(req, res, next) {
  if (isPlatformAdmin(req)) return next();
  if (req.user && req.user.workspaceRole === "sales_rep") {
    return res.status(403).json({
      error: "Sales reps work leads from their queue only.",
      currentRole: "sales_rep",
    });
  }
  return next();
}

/**
 * Allows only a sales rep. The rep console (assigned lead + phone bridge) is
 * meaningless for other roles, so owners/admins/managers are blocked — they use
 * the queue-management and monitoring endpoints instead.
 */
function requireSalesRep(req, res, next) {
  if (req.user && req.user.workspaceRole === "sales_rep") return next();
  return res.status(403).json({
    error: "Only sales reps have a personal lead queue.",
    currentRole: (req.user && req.user.workspaceRole) || null,
  });
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

module.exports = {
  requireRole,
  // `denyViewerMutations` kept as a backwards-compatible alias; it now blocks
  // ALL read-only roles (manager included), not just legacy viewers.
  denyViewerMutations: denyReadOnlyMutations,
  denyReadOnlyMutations,
  denySalesRep,
  requireSalesRep,
  requireOwner,
  roleRank,
  RANK,
};
