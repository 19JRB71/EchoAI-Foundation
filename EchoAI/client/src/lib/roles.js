// Client mirror of the workspace-role model (backend middleware/rolePermissions).
//
// Workspace roles describe what a team member can do inside the owner's account:
//   owner      — the account holder; full control (never a team_members row)
//   admin      — full control delegated by the owner (team + billing + all tools)
//   manager    — READ-ONLY everywhere; can view but never mutate
//   sales_rep  — works one assigned lead at a time; masked phone numbers only
//   viewer     — legacy read-only role (treated like manager)
//
// The backend is always the source of truth for enforcement; this only drives
// the UI (role badges, hiding write controls, the sales-rep console).

export const WORKSPACE_ROLES = {
  owner: { label: "Owner", badge: "bg-teal-500/15 text-teal-300" },
  admin: { label: "Admin", badge: "bg-indigo-500/15 text-indigo-300" },
  manager: { label: "Manager", badge: "bg-sky-500/15 text-sky-300" },
  sales_rep: { label: "Sales Rep", badge: "bg-amber-500/15 text-amber-300" },
  viewer: { label: "Viewer", badge: "bg-gray-500/15 text-gray-300" },
};

export function roleLabel(role) {
  return WORKSPACE_ROLES[role]?.label || role || "Member";
}

export function roleBadgeClass(role) {
  return WORKSPACE_ROLES[role]?.badge || "bg-gray-500/15 text-gray-300";
}

// Read-only roles can view everything but must not see write controls. The
// platform admin (isAdmin) always bypasses this.
export function isReadOnlyRole(role) {
  return role === "manager" || role === "viewer";
}

// Whether a workspace user may perform write actions. Platform admins and the
// owner/workspace-admin can write; managers and viewers cannot.
export function canWrite({ isAdmin = false, workspaceRole = "owner" } = {}) {
  if (isAdmin) return true;
  return workspaceRole === "owner" || workspaceRole === "admin";
}
