---
name: EchoAI Setup Agent orchestration
description: How the AI Setup Agent runs setup steps server-side, and the concurrency/authz/idempotency invariants it must keep.
---

# EchoAI AI Setup Agent (server-side onboarding orchestrator)

The Setup Agent interviews a new user, then (consent-gated) configures their
account by orchestrating the EXISTING feature controllers in-process via a
synthetic req/res (same pattern as `voiceController.invokeChatbot`) — NOT via any
browser/cursor automation. OAuth stays user-driven (`needs_connection` handoff).

## Invariants to preserve when touching `setupAgentController.executeNextAction`

- **Owner-only, server-side.** `setupAgentRoutes` chain is `auth, lockout,
  requireOwner`. Team members are blocked with 403 at the API, not just hidden in
  the UI. `requireOwner` (middleware/rolePermissions.js) allows workspaceRole
  'owner' or `isPlatformAdmin`. **Why:** auth.js remaps an active team member's
  userId→owner, so without this guard a team member could reconfigure the whole
  workspace by calling the API directly.
- **One step at a time (concurrency).** `/execute` takes a compare-and-swap claim
  on `setup_sessions.executing` (409 if already claimed) and releases it in a
  `finally`. Stale claims (`executing_at < NOW() - 5 min`) are reclaimable so a
  crash mid-step can't deadlock the session forever. **Residual:** the reclaim is
  time-based (no heartbeat lease), so a step running >5 min could be re-entered —
  mitigated by the idempotency checks below + the sequential single-client loop.
- **Idempotent artifact steps.** The non-idempotent, artifact-creating actions
  each existence-check before creating so a crash/retry (or overlap) can't
  duplicate: content_calendar→`content_calendars`, ad_creatives→`ad_creatives`,
  email_preferences→`email_marketing_campaigns` (campaign_name='Welcome Series'),
  all scoped by `brand_id`. **Why:** these tables have no per-brand unique
  constraint (multiple rows are legitimate in normal use), so the guard is in app
  code, not the schema.
- **Tier gating skips gracefully.** A gated action below the user's tier is marked
  complete with status 'skipped' + a message, never a hard failure. Admin bypass.
- **AI failures → 502, never mocked** (matches the platform-wide convention).
