---
name: EchoAI team workspace remap
description: How team-member auth remapping makes userId workspace-scoped, and the identity-sensitive paths that must NOT use the remapped id.
---

# Team workspace remap (the `/api/team` feature)

`middleware/auth.js` remaps an **active** team member's `req.user.userId` to their
`account_owner_user_id` so all existing `userId`-scoped queries automatically
become workspace-scoped — no per-controller edits. It also sets
`req.user.actualUserId` (the real signed-in user), `workspaceRole`,
`isTeamMember`, `isPlatformAdmin`. Remap is skipped for `/api/v2*` (mobile keeps
real identity).

**Rule: self-account mutations must use `actualUserId`, never `userId`.**
**Why:** `userId` is the *owner's* id for a team member. Using it on a
self-account write lets any team member (even a viewer) overwrite the owner's
account. This was a real bug caught in review: `authController.updateProfile` and
`updateOnboarding` wrote with `req.user.userId` and let a viewer change the
owner's email/business_name/team_size/onboarding.
**How to apply:** any new mutation in `authController` (or anything editing the
caller's *own* `users` row / identity) must resolve
`req.user.actualUserId || req.user.userId`. Workspace-data controllers correctly
keep using `userId`.

**Rule: verify invitee email BEFORE consuming an invite token.**
**Why:** `POST /api/team/accept` originally did the single-use `UPDATE ... SET
accepted_at = NOW()` first, then checked the email — so a leaked token presented
by the wrong user burned the invite (DoS on the real invitee). Fix: SELECT the
unconsumed/unexpired invite, check `invited_email === caller email` (403 if not),
THEN run the atomic conditional UPDATE to consume it (still single-use; concurrent
accept loses the race → 410).
