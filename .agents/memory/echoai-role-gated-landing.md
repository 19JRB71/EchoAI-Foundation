---
name: EchoAI role-gated default landing
description: Rules for adding an owner-only section as a default landing + agent "open workspace" CTAs in the EchoAI client.
---

When a client section's backing API is owner-only (`requireOwner` on the route)
or admin-only, the client must gate it in THREE places, not just one:

1. **Default section.** If it becomes the default landing (`useState` + on login),
   team members must be redirected off it (e.g. to `overview`) once the profile
   loads (`profile.isTeamMember`), or they land on a 403'ing view.
2. **Nav visibility.** Filter the group/item out of the sidebar for users who
   can't reach it (team members for owner-only; non-admins for admin-only).
3. **Cross-section CTAs.** Agent/card "Open workspace" buttons that jump to
   `agent.section` must check reachability first — a section like Sentinel maps to
   `admin`, which only renders for `isAdmin`, so a non-admin owner clicking it hits
   a blank view. Thread a `canOpenSection(section)` predicate down and hide the CTA
   when false; also make `handleSelectSection` fall back to `overview` for
   unreachable targets as a defensive backstop.

**Why:** Mission Control / AI Team (`/api/agents`) are owner-only, and the health
console (`admin`) is admin-only, but agent cards list all 8 agents for every
owner. Gating only the route (or only the default) leaves dead/403 views.

**How to apply:** Any new default landing or cross-linking card in `App.jsx` /
`Sidebar.jsx` — derive one `canOpenSection` predicate from `isTeamMember`/`isAdmin`
and reuse it for nav filtering, the navigation guard, and every jump CTA.
