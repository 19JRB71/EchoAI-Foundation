# 026-C3-PM10 — Stage Note

**Authorization:** investigation and Stage-note preparation only  
**Implementation status:** **NOT AUTHORIZED / NOT STARTED**  
**Stage-note result:** **HARD STOP — session↔Guided-journey binding is not strictly provable from persisted contracts**

## Executive finding

The SDS-H1 Setup Agent session is durably completed, is bound to the authenticated owner and the real South Dixie Storage brand, and has terminal durable outcomes for all 11 planned actions. The onboarding account projection remains incomplete.

The client crash is diagnosed: an ordinary failed-step **Skip this step** button calls the needs-connection skip handler. That handler performs the server write first, then dereferences `needsConnection.key` even though the failed-step branch has cleared `needsConnection`. This produces the observed:

> `Cannot read properties of null (reading 'key')`

The crash occurred after authoritative server work and prevented the Guided Setup wrapper from committing its normal onboarding-completion transition.

However, the strict PM10 binding predicate cannot currently prove that this exact completed `setup_sessions` row belongs to this exact `guided_setup_progress` journey. Both rows belong to the same owner, and product wiring strongly links them, but neither table persists the other's identifier, the brand, or a journey-origin key. Current server state loading simply selects the owner's latest Setup Agent session.

Under the authorization's rule—**unprovable session↔journey binding = STOP**—no convergence implementation may begin.

Two additional Stage-1 rulings are required:

1. Whether the owner-singleton Guided journey plus owner-gated profile embedding is sufficient authority despite the missing persisted session/origin link.
2. How to reconcile strict reuse of the existing completion writer in `authController.js` with the expected two-server-file surface of `guidedSetupController.js` plus `setupAgentController.js`.

---

## A. I-69 client-crash diagnosis

### Exact exception

The captured browser error was:

> `Cannot read properties of null (reading 'key')`

### Component and function

The best and source-deterministic match is:

- Component: `client/src/onboarding/SetupAgent.jsx`
- Function: `skipConnection()`
- Dereference: `needsConnection.key`
- Source range: `SetupAgent.jsx:830-850`, specifically line 839 in staging HEAD `81f4d92`

### Triggering state

1. The email campaign action was represented by the ordinary durable failed-step panel.
2. The failure branch sets `failedStep` and explicitly clears `needsConnection`:
   - `SetupAgent.jsx:407-457`
   - `setNeedsConnection(null)` at approximately line 456
3. The ordinary failed-step panel's fallback **Skip this step** button is incorrectly wired to `skipConnection`:
   - `SetupAgent.jsx:1835-1851`
   - `onClick={skipConnection}` at approximately lines 1845-1847
4. `skipConnection()` calls `api.runSetupAction(sessionId, true)` before reading local state.
5. After the server request resolves, it constructs a local result using `needsConnection.key`.
6. In this failed-step state, `needsConnection` is null, causing the observed exception.

### Proven versus inferred

**Proven from source and screenshots**

- The failed-step branch clears `needsConnection`.
- The ordinary failed-step Skip button calls the needs-connection handler.
- That handler dereferences `needsConnection.key` only after the server request.
- This is a deterministic `null.key` path matching the observed click and exception.
- The server session was durably completed before the wrapper completion flag was written.

**Inferred**

- The exact request interleaving that completed the final survey and terminal session is not reconstructable from a retained browser stack/network trace.
- A secondary possible `null.key` site is `step.key` in `runLoop` (`SetupAgent.jsx:474-475`) if a malformed non-terminal response lacks `step`. It is a weaker match than the directly miswired failed-step Skip handler.
- `outcome.failedStep.key` at approximately line 417 would require a malformed failed payload that bypassed the current classifier's truthiness guard; it does not fit the observed action as well.

### Reproducibility without touching SDS-H1

The crash is reproducible from the source state invariant:

- `failedStep != null`
- `needsConnection == null`
- render ordinary failed panel
- invoke its Skip button
- let `runSetupAction(..., true)` resolve
- handler reads `needsConnection.key`

No specimen interaction is required to establish this path. No reproduction was executed against SDS-H1.

### Before or after authoritative completion

The authoritative session completion occurred server-side at:

- `completed_at = 2026-08-22T14:47:50.633Z`
- `status = completed`
- `consent_granted = false`

The client then displayed the runtime error and never reached the Guided wrapper's completion writer.

Therefore:

- Setup Agent completion was durable before the onboarding projection remained false.
- The crash was a post-server-write client failure.

### Durable effects

Observed durable state after the crash:

- Setup Agent session: completed
- Welcome email series: not created
- Email preferences action: skipped
- Survey action: completed; one survey exists
- Social posts: 13 drafts
- Content calendar: one draft
- New external actions since the controlled retry: zero
- New/changed campaign tasks since the controlled retry: zero
- Onboarding account projection: still false, step 1
- Guided progress: still `profile`
- `_recovery`: preserved

No evidence shows the crash changed campaign, Meta, social binding, schedule, publish, or provider state. Its harmful durable effect was omission of the wrapper's onboarding-completion transition.

I-69 is diagnosed only. It is not fixed by this Stage-note.

---

## B. Session↔journey binding proof

### What is strictly proven

#### Authenticated owner

The current staging owner row has:

- `users.user_id = 8e55c26c-7ac2-4ea6-9884-1703b0806016`
- `onboarding_completed = false`
- `onboarding_step = 1`

#### Guided Setup singleton

There is exactly one `guided_setup_progress` row for that owner:

- `user_id = 8e55c26c-7ac2-4ea6-9884-1703b0806016`
- `current_step = profile`
- owner-row count = 1
- `_recovery` remains present in `connections`

Schema contract:

- `models/096_guided_setup.sql:10-17`
- `guided_setup_progress.user_id` is the owner-keyed primary key

#### Completed Setup Agent session

There is exactly one Setup Agent session for that owner:

- `session_id = ae17b133-b42c-4336-ae88-ac68b6465e3c`
- `user_id = 8e55c26c-7ac2-4ea6-9884-1703b0806016`
- `brand_id = d5745758-30a6-462a-baa6-4233216b8f93`
- `status = completed`
- `interview_complete = true`
- `completed_at` is non-null
- `consent_granted = false`
- all 11 `ACTIONS` keys are present in `completed_steps`

Server completion contract:

- `controllers/setupAgentController.js:2804-2827`
- completion occurs only after no planned action remains

#### Owned, real brand

The bound brand row has:

- `brands.brand_id = d5745758-30a6-462a-baa6-4233216b8f93`
- `brands.user_id = 8e55c26c-7ac2-4ea6-9884-1703b0806016`
- `is_demo = false`

This proves the completed session belongs to the authenticated owner and a real owner-controlled brand. No display-name matching was used.

#### Product wiring

The Guided Setup `profile` step embeds `SetupAgent` directly:

- `client/src/onboarding/guided/GuidedSetupWizard.jsx:531-547`

Guided Setup state and the latest Setup Agent session are loaded for the authenticated owner:

- `controllers/guidedSetupController.js:139-177`
- owner/auth route guard: `routes/guidedSetupRoutes.js:27-32`

### What is not strictly persisted

Neither side stores a direct journey binding:

- `guided_setup_progress` stores no `setup_session_id`
- `guided_setup_progress` stores no `brand_id`
- `setup_sessions` stores no `guided_setup_progress` identifier
- `setup_sessions` stores no Guided-journey origin key
- Guided state loading selects the owner's latest session by time, not by a persisted journey join

The singleton owner journey, one observed session, six-second creation proximity, UI embedding, and onboarding gate are strong operational evidence. They are not an explicit persisted session↔journey contract.

### Binding ruling

**HARD STOP under the supplied authority model.**

Current contracts prove:

- session↔owner
- session↔owned real brand
- owner↔singleton Guided progress
- Guided profile↔Setup Agent product wiring

They do not strictly prove:

- this exact session row↔this exact Guided journey row

Claude must explicitly rule either:

1. the owner-singleton/auth-gated embedding contract is sufficient for this existing specimen; or
2. a persisted origin/binding mechanism is required.

No implementation can proceed before that ruling.

---

## C. Terminal-outcomes evidence table

Source taxonomy:

- Planned action order: `controllers/setupAgentController.js:900-1710`
- Durable serializer: `controllers/setupAgentController.js:2037-2047`
- Completed/skipped atomic writes: approximately `:569-601`, `:2830-2895`, `:2940-2985`
- Deferred Meta validator/enrichment: approximately `:790-831`, `:2830-2855`
- Six-way contract tests: `tests/setupAgent.pm6Deferral.test.js:255-276`

| Step key | Durable outcome | Code | Journey disposition | Terminal? | Evidence |
|---|---|---|---|---:|---|
| `create_brand_profile` | `completed` | — | — | Yes | `completed_steps` + `step_outcomes` |
| `set_availability` | `completed` | — | — | Yes | `completed_steps` + `step_outcomes` |
| `connect_google` | `completed` | — | — | Yes | `completed_steps` + `step_outcomes` |
| `content_calendar` | `completed` | — | — | Yes | `completed_steps` + `step_outcomes` |
| `ad_creatives` | `completed` | — | — | Yes | `completed_steps` + `step_outcomes` |
| `setup_google_ads` | `skipped` | — | — | Yes | `completed_steps` + `step_outcomes` |
| `create_facebook_campaign` | `failed` | `provider_manual_review` | `deferred` | **Yes** | Valid owner-directed failed-then-deferred object |
| `connect_social` | `completed` | — | — | Yes | `completed_steps` + `step_outcomes` |
| `social_schedule` | `skipped` | — | — | Yes | `completed_steps` + `step_outcomes` |
| `email_preferences` | `skipped` | — | — | Yes | `completed_steps` + `step_outcomes` |
| `create_survey` | `completed` | — | — | Yes | `completed_steps` + `step_outcomes` |

### Deferred Meta proof

The Facebook campaign durable object contains:

- `status = failed`
- `code = provider_manual_review`
- `retryable = false`
- `journey_disposition = deferred`
- `deferred_reason = pending_provider_review`
- `owner_directed = true`
- valid failure and deferral timestamps

This is the exact PM6 failed-then-deferred terminal class. It is not provider success and must never be rewritten as success.

Relevant source/tests:

- validator/enrichment: `controllers/setupAgentController.js:790-831`
- terminal write/response: `controllers/setupAgentController.js:2830-2855`
- preservation/no-rerun contract: `tests/setupAgent.pm6Deferral.test.js:98-161`

### Six-way classification

| State | Terminal for journey? |
|---|---:|
| never attempted | No |
| skipped before attempt | Yes |
| succeeded | Yes |
| failed retryable | No |
| failed manual review | No |
| failed, then owner-directed deferred | Yes |

All 11 SDS-H1 planned actions are terminal.

---

## D. Existing completion writer

### Legitimate writer

- Function: `updateOnboarding`
- File: `controllers/authController.js:404-485`
- Route: `PUT /api/auth/profile/onboarding`
- Route wiring: `routes/authRoutes.js:31`
- Client wrapper: `client/src/api.js:720-721`
- Current legitimate caller: `GuidedSetupWizard.finish()`
- Caller source: `client/src/onboarding/guided/GuidedSetupWizard.jsx:424-437`

### Fields changed

The writer can change:

- `users.onboarding_step`
- `users.onboarding_completed`

The normal Guided finish payload is:

```json
{
  "onboardingStep": 5,
  "onboardingCompleted": true
}
```

### Current transaction and idempotency behavior

- The writer uses one SQL statement with a `prev` CTE and `UPDATE ... RETURNING`.
- It does not open an explicit transaction.
- It targets the real authenticated user (`actualUserId || userId`).
- Sequential repeated `true` writes leave the field true.
- Welcome email delivery is attempted only when the returned transition appears false→true.
- Email delivery is best-effort and outside the database write.

### Concurrency limitation

The current `prev` CTE does not lock the user row before reading `was_completed`. Two concurrent requests can both observe false before contending on the update and can both believe they performed the false→true transition.

Therefore:

- state idempotency is adequate for ordinary retries;
- exactly-one transition side-effect is not proven for concurrent bootstraps;
- literal exactly-once welcome-email delivery is not guaranteed.

PM10 must reuse and strengthen this writer/semantic operation. It must not add another onboarding-completion SQL writer elsewhere.

---

## E. Proposed server convergence design — conditional on Stage-1 ruling

### Required explicit operation

Reuse the existing `PUT /api/auth/profile/onboarding` writer with an explicit server-validated convergence mode, for example:

```json
{
  "onboardingStep": 5,
  "onboardingCompleted": true,
  "convergeFromCompletedSetup": true
}
```

This is an explicit write request, not a GET side effect.

### Transactional predicate

Within the existing completion writer:

1. Begin a transaction.
2. Lock the authenticated real user row.
3. If `onboarding_completed = true`, return an idempotent no-op result.
4. Load the eligible completed Setup Agent session for that owner.
5. Prove the approved session↔journey binding rule.
6. Require a non-null owned, non-demo brand.
7. Require `status = completed`, `interview_complete = true`, and `completed_at` non-null.
8. Enumerate every `ACTIONS` key.
9. Require each key in `completed_steps`.
10. Require each durable outcome to be exact `completed`, exact `skipped`, or a validated owner-directed failed-then-deferred object.
11. For the Meta action, preserve the existing PM5–PM7 authority rules; never reinterpret deferred failure as success.
12. If any check fails, roll back and return a bounded fail-closed conflict/anomaly response.
13. If all checks pass, call the existing completion semantic inside the same transaction:
    - `onboarding_completed = true`
    - `onboarding_step = GREATEST(onboarding_step, 5)`
14. Commit.
15. Trigger the existing transition-only welcome behavior once, after commit.

### Exactly-once semantics

Two concurrent convergence calls must serialize on the user row:

- first caller performs false→true;
- second caller observes true after obtaining the lock and returns a no-op;
- only the first caller qualifies for transition side effects.

This provides exactly-one committed completion transition. External email delivery still requires the existing delivery mechanism's own idempotency if literal exactly-once delivery is required.

### State boundary

The convergence transaction may change only:

- `users.onboarding_completed`
- `users.onboarding_step` monotonically to at least 5

It must not mutate:

- Setup Agent session, steps, answers, or outcomes
- Guided connection flags
- `_recovery`
- `firstwin`
- `parked`
- `errorKey`
- brands
- social drafts/calendar
- social-account bindings
- campaign/Meta rows
- action ledger

---

## F. Proposed server fresh-session guard — conditional on Stage-1 ruling

Guard `controllers/setupAgentController.js:initiateSession` before the fresh-session inventory/AI/INSERT path.

### Default existing-business request

For a request without explicit `intent: "new_business"`:

1. Lock or otherwise serialize on the authenticated user before deciding resume-versus-create.
2. Resume a genuinely open `in_progress`/`paused` session as today.
3. If no open session exists, inspect onboarding and authoritative completed-journey truth.
4. If onboarding is complete, refuse a fresh onboarding session.
5. If a terminal completed journey exists but onboarding is not yet complete, return a bounded conflict such as:
   - HTTP 409
   - `code = completion_convergence_required`
   - no new session
   - no AI call
   - no action replay
6. If a purported completed session has any non-terminal/missing outcome, return:
   - HTTP 409
   - `code = completed_journey_invalid`
   - no convergence
   - no new session
   - anomaly logged with opaque correlation reference
7. If the authority read fails, fail closed with no INSERT.

### Explicit second-business request

Preserve legitimate `intent: "new_business"` behavior. It is the owner's explicit request for a separate business and is not an onboarding-resume request.

### Concurrency

The current open-session SELECT followed by fresh INSERT is not transactionally protected. The guard must use a user-row lock/transaction so two stale tabs cannot both mint fresh default sessions.

---

## G. Proposed Guided Setup bootstrap change — conditional on Stage-1 ruling

File:

- `client/src/onboarding/guided/GuidedSetupWizard.jsx`

At bootstrap, before rendering the profile-embedded Setup Agent or its existing-business chooser:

1. Load Guided state as today.
2. If account onboarding remains incomplete, invoke the existing onboarding writer in explicit convergence mode.
3. Server—not client—evaluates the full authoritative predicate.
4. If the server reports converged/already complete:
   - persist the existing Guided progress projection to `done` using the existing progress writer;
   - preserve the complete existing connections object byte-for-byte, including `_recovery`;
   - call the existing `onComplete`;
   - never mount/start Setup Agent.
5. If the server reports no eligible completed journey, preserve legitimate current onboarding behavior.
6. If the server reports invalid/non-terminal completed truth or a binding anomaly:
   - fail closed;
   - show a bounded recovery/anomaly state;
   - do not show either fresh-session business option.

The existing-business chooser remains unchanged for legitimate users with no completed onboarding journey.

No `api.js` production change is needed if the existing `api.updateOnboarding(payload)` wrapper accepts the additional payload field.

---

## H. Required R1–R17 test matrix

All server cross-boundary assertions must exercise real route/controller/database behavior rather than only pure mocks.

| ID | Required regression | Layer / assertion |
|---|---|---|
| R1 | Completed terminal session + onboarding false converges | Real completion endpoint; user becomes complete and step is at least 5 |
| R2 | No new session during convergence | Setup-session row count and IDs unchanged |
| R3 | No setup-action reruns | All `ACTIONS.run`, provider, AI, publish, and launch seams remain at zero |
| R4 | Completed session unchanged | Before/after row and durable JSON byte-equivalent |
| R5 | Refresh idempotent | Second convergence request is a no-op; no repeated transition effect |
| R6 | Remount idempotent | Repeated Guided bootstrap unlocks without starting Setup Agent |
| R7 | Legitimate new/existing-business behavior preserved | No eligible completed journey follows current chooser/start behavior; explicit new-business remains valid |
| R8 | Incomplete/open sessions resume normally | `in_progress`/`paused` session resumes; no convergence |
| R9 | Completed session with any non-terminal/missing outcome fails closed | 409/anomaly; user remains incomplete; no fresh session |
| R10 | Dashboard unlock only after truthful convergence | Client calls `onComplete` only after server-confirmed completion |
| R11 | `_recovery` preserved | Guided connections JSON, including `_recovery`, remains byte-equivalent |
| R12 | Social drafts/calendar unchanged | 13 drafts and draft calendar remain unchanged; no scheduling/publishing |
| R13 | Deferred Meta campaign unchanged | Campaign, provider IDs, task, proof, ledger, error, and timestamps unchanged |
| R14 | Direct default session-start refuses fresh session after completed journey | Real `POST /api/setup-agent/session`; bounded 409; no INSERT |
| R15 | Concurrent convergence performs one transition | Two concurrent calls; one transition, one no-op, one transition email attempt |
| R16 | Failed-then-deferred Meta outcome counts terminal | Exact authorized object passes; near-miss objects fail |
| R17 | Convergence modifies completion state only | Database snapshot diff permits only the two onboarding fields and expected transition audit behavior |

Additional binding tests required before implementation:

- wrong owner: reject;
- unowned brand: reject;
- demo brand: reject;
- missing Guided singleton: reject;
- ambiguous/multiple candidate sessions: reject;
- absent persisted journey binding under the final Stage-1 rule: reject.

---

## I. Exact proposed file surface and ruling conflict

### Strict writer-reuse option

Most defensible maximum production surface:

#### Server — two files

1. `controllers/authController.js`
   - extend the existing writer with server-validated convergence and concurrency-safe transition semantics
2. `controllers/setupAgentController.js`
   - expose/reuse the terminal-journey validator
   - add the fresh-session fail-closed guard

#### Client

3. `client/src/onboarding/guided/GuidedSetupWizard.jsx`
   - invoke convergence before the chooser and route successful convergence through the existing completion handoff

#### Tests

4. One focused server integration test file for convergence/session-start contracts
5. One focused Guided client regression test file

No `api.js` change.  
No route change if the existing onboarding endpoint and existing session endpoint are reused.  
No DDL.  
Migration count remains 148.

### Conflict with the authorization's expected server files

The authorization expected:

- `guidedSetupController.js`
- `setupAgentController.js`

But the sole existing completion writer is in:

- `authController.js`

The following alternatives are not compliant:

1. Writing completion SQL in `guidedSetupController.js` duplicates the writer.
2. Internally invoking the Express `authController.updateOnboarding` handler from `guidedSetupController` cannot share a transaction and couples response emission.
3. Extracting a transaction-aware primitive from `authController`, then calling it from `guidedSetupController`, requires three server production files once `setupAgentController` is included.

**Stage-1 ruling required:** authorize `authController.js` to replace `guidedSetupController.js` in the two-server-file surface, or relax the server-file limit. No implementation should choose silently.

---

## J. Expected diff accounting — conditional estimate only

For the strict writer-reuse option:

| Surface | Expected touched hand-edited lines |
|---|---:|
| `authController.js` | 45–60 |
| `setupAgentController.js` | 35–50 |
| `GuidedSetupWizard.jsx` | 20–30 |
| Server integration tests | 85–100 |
| Client regression tests | 35–45 |
| **Expected total** | **220–285** |

Planning bounds:

- padded expected bound: **300 touched hand-edited lines**
- mandatory hard stop: **375 touched hand-edited lines**
- adds and deletes both count
- no SW/dist output was generated during this Stage-note

If the approved architecture cannot fit beneath 375 touched lines, stop and return for re-scope.

---

## Risks and anomalies

1. **Binding hard stop:** no persisted session↔Guided-journey identifier exists.
2. **Writer/file-surface conflict:** strict writer reuse requires touching `authController.js`.
3. **Concurrent transition side effect:** current completion writer does not prove exactly-one welcome-email attempt under concurrency.
4. **Fresh-session race:** current default session endpoint has a SELECT-then-INSERT window without user-scoped serialization.
5. **I-69 remains unfixed:** PM10 bootstrap convergence can recover this specimen but does not correct the miswired failed-step Skip handler unless separately authorized.
6. **Deferred Meta truth must remain failed+deferred:** never rewrite as campaign success.
7. **No-journey-origin near miss:** choosing the latest completed owner session is insufficient if unrelated Setup Agent sessions can exist.
8. **Guided progress sequencing:** updating account completion and Guided `current_step=done` through separate existing operations preserves current semantics but is not one database transaction.
9. **External exactly-once:** database transition can be exactly-once; email delivery requires provider/idempotency guarantees beyond a bare best-effort send.

---

## Integrity and no-touch confirmation

Read-only evidence was gathered from:

- staging-pinned source at `.local/pm8/repo/EchoAI`
- staging PostgreSQL via SELECT-only queries
- owner-provided screenshots and authorization note

Confirmed before writing this report:

- source HEAD: `81f4d92`
- source status had no agent-authored code changes; only the owner-provided authorization attachment appeared untracked from the workspace root
- `schema_migrations` row count: 148
- no DDL
- no source edits
- no tests that mutate the specimen
- no session start/resume
- no business-option click
- no staging data write
- no direct DB/API repair
- no schedule or publish
- no Facebook/Meta/provider action
- no merge
- no deploy
- no production interaction

This Markdown Stage-note is the only agent-authored deliverable. It was created outside the frozen staging source directory.

## Final disposition

**026-C3-PM10 remains blocked at Stage 0 / Stage-note.**

Return this note to the owner and Claude for Stage-1 architectural ruling on:

1. persisted session↔journey authority;
2. whether `authController.js` may replace `guidedSetupController.js` in the two-server-file allowance;
3. whether exactly-once applies only to committed completion state or also to welcome-email delivery.

Do not implement, repair, merge, deploy, start a session, or click either business option until that ruling is explicit.