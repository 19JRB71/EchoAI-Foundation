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
- **One step at a time (token-fenced renewable lease).** `/execute` claims a lease
  on `setup_sessions.executing` (409 if already held) and releases it in `finally`.
  It is a *renewable, fenced* lease, not a plain time-based CAS:
  - `claimExecution` stamps `executing_at` + a per-claim `executing_token` (UUID,
    migration 044) and returns the token (or null when blocked).
  - While a step runs, a heartbeat (`EXECUTION_HEARTBEAT_MS=60s`) bumps `executing_at`
    guarded by the token, so a legitimately slow step (>`EXECUTION_LEASE_SECONDS=300`)
    is **never** reclaimed mid-flight. Only a dead claim (no heartbeat past the lease
    window, i.e. a crashed process) is reclaimable — so setup never stalls.
  - `heartbeatExecution`/`releaseExecution` are **token-guarded** (`AND executing_token
    = $token`). **Why:** a revived crashed executor must not clear a lease another
    request already reclaimed (would allow a duplicate run). Helpers + both constants
    are exported for the `tests/setupAgent.lease.test.js` suite.
  **Residual (accepted):** the fence stops stale *release*, not stale *side effects*
  already in flight; the idempotency existence-checks below are the backstop for that.
- **Idempotent artifact steps.** The non-idempotent, artifact-creating actions
  each existence-check before creating so a crash/retry (or overlap) can't
  duplicate: content_calendar→`content_calendars`, ad_creatives→`ad_creatives`,
  email_preferences→`email_marketing_campaigns` (campaign_name='Welcome Series'),
  all scoped by `brand_id`. **Why:** these tables have no per-brand unique
  constraint (multiple rows are legitimate in normal use), so the guard is in app
  code, not the schema.
- **Tier gating skips gracefully.** A gated action below the user's tier is marked
  complete with status 'skipped' + a message, never a hard failure. Admin bypass.
  The decision is the pure `isActionAllowed(action, tier, role)` (exported, unit-
  tested): admin→allow, no `feature`→allow, **unknown feature key→deny (fail
  closed)**, else `meetsTier`. **Why fail closed:** a mistyped/removed feature key
  must never silently unlock a gated setup step. All setup actions are pro-gated or
  baseline (no enterprise-only setup step), so Enterprise unlocks every gated step.
- **AI failures → 502, never mocked** (matches the platform-wide convention).
- **First action (create_brand_profile) is crash-replay safe.** It persists
  `discovery_session_id` on the setup_sessions row BEFORE calling brand-discovery
  confirm; on retry it recovers the created brand via that discovery row's
  `brand_id` rather than creating a second brand. **Why:** brand creation is an
  external side effect that runs before the completed-steps write.
- **Resumable lifecycle.** setup_sessions tracks started_at / paused_at /
  resumed_at / completed_at / updated_at. Leaving mid-interview marks the row
  'paused'; reopening via initiateSession stamps resumed_at and flips back to
  'in_progress'. Pause has TWO client paths that share one idempotent guarded
  UPDATE (`markSessionPaused`, only flips status='in_progress' scoped to owner):
  - in-app nav / closing the agent → React unmount effect → auth'd POST /pause.
  - hard tab/window close → `pagehide` `navigator.sendBeacon` → no-auth POST
    /pause-beacon. **Why a separate endpoint:** unmount effects don't run on hard
    unload and sendBeacon can't set an Authorization header, so the beacon route
    is mounted BEFORE `router.use(auth,...)` and verifies the JWT from its **body**
    (`{sessionId, token}`), scoping the UPDATE to the token's userId. Always 204,
    swallows bad-token/DB errors (never block the unload). A `pausedRef` guard in
    SetupAgent ensures at most one pause fires (beacon OR unmount, not both).

## Test suite lives in TWO dirs — `npm test` must glob both

- `EchoAI/test/` (singular) holds the e2e flow test; `EchoAI/tests/` (plural)
  holds the health/gating/lease unit tests. `npm test` globs **both**
  (`node --test "test/**/*.test.js" "tests/**/*.test.js"`). **Why:** a prior
  duplicate `test` key in package.json silently ran only one dir (last key wins in
  JSON) — if you touch the test script, keep both globs or half the suite goes
  dark with no error.
- Registered as the Replit **`test` validation step** (`cd EchoAI && npm test`) so
  a broken onboarding flow blocks task completion instead of passing silently.
- Runner needs the same boot env as the app: `DATABASE_URL` (migrated schema),
  `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY`. `ANTHROPIC_API_KEY` is read at
  import but the Anthropic client is stubbed — any non-empty value works, no spend.
