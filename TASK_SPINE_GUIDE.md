# Task Spine Developer Guide

**One page. Binding for every prompt that adds or changes agent-executed actions (018, 019, …).**
Source of truth for design rationale: `PROMPT_009_STAGE1_DESIGN.md`. Engine: `EchoAI/utils/taskSpine.js`. Schema: `EchoAI/models/131_agent_tasks.sql`. Reference adopter: `EchoAI/controllers/socialController.js` (spine helpers near the bottom).

## What it is — and is not

The spine is a **recorder, not a controller**. It is the canonical, owner-visible audit trail of what the AI team did (`agent_tasks` + append-only `agent_task_events`). Features keep full authority over claims, retries, timing, and provider semantics. Recording must NEVER change a feature outcome: every adopter call goes through `taskSpine.safeSpine(fn, opts)`, which swallows spine errors. If the provider action succeeded but recording failed, `safeSpine` files a `reconciliation` MANUAL_REVIEW task instead of throwing.

## Lifecycle states (17)

Pre-execution: `DRAFT → PROPOSED → APPROVED → QUEUED` (owner-side intent).
Execution: `EXECUTING → PROVIDER_ACCEPTED → EXTERNALLY_VERIFIED → REPORTED → COMPLETED`.
Retry/failure: `RETRY_SCHEDULED`, `AUTH_REQUIRED`, `PERMISSION_DENIED`, `RATE_LIMITED`, `VALIDATION_FAILED`, `EXTERNAL_FAILURE`.
Human/terminal: `MANUAL_REVIEW`, `CANCELLED`.
One `agent_tasks` row per **attempt** — unique `(task_type, source_type, source_id, attempt)`. A terminal predecessor + new work = `createTask` returns attempt+1 (never reuses a terminal row).

## Legal transitions

The table in `taskSpine.js` is keyed by **TARGET** state (`LEGAL_SOURCES`). Highlights that trip people up:
- `MANUAL_REVIEW` only from `EXECUTING`, `PROVIDER_ACCEPTED`, `RETRY_SCHEDULED`.
- `CANCELLED` only from pre-execution states (`APPROVED`, `QUEUED`) — e.g. pausing a calendar. Re-activation = a **new attempt**, never a resurrection.
- **Honesty rule:** `REPORTED` from `PROVIDER_ACCEPTED` (skipping `EXTERNALLY_VERIFIED`) is legal ONLY with explicit `meta.verification === 'unavailable'`. The trail never claims a verification that didn't happen.
- An illegal target **throws**; a legal-but-lost race returns `null` (see below).

## Transaction requirements (non-negotiable)

- Every state change and its event row commit in **ONE database transaction** (`transition()` does this internally).
- If the caller is already inside a transaction, pass its client: `transition({ client, ... })` joins it — never open a nested/second connection.
- Transitions are **guarded UPDATEs** (`WHERE status = <expected source>`). A miss returns `null` and writes NO event — recorder semantics: if you didn't win the row, you record nothing. Never fabricate an edge.
- Adopters whose feature work runs inside its own transaction (autopilot, voice, calendar) record **AFTER the feature COMMIT**, in the spine's own transaction — a spine failure must never roll back an approval.
- `agent_task_events` is append-only (DB trigger rejects UPDATE/DELETE). Never touch it directly; only `transition()` writes it.

## External verification & external_proofs linkage

- After a provider accepts an action, verify by **existence read-back**, not metrics (`socialApi.verifyPostExists` — identity fields only; engagement fields need permissions the token may not carry).
- The verbatim read-back is written to `external_proofs` (run key `task-<taskId>`, action `publish_readback`) and the task stores `proof_id` — the trail **references** evidence, never copies it.
- Failed read-back after a successful provider action → `MANUAL_REVIEW` (`reason: verification_failed`), and the provider action is **NEVER retried** from the spine (double-post risk).

## Reconciliation

Write-time recording is the fast path. Safety net: `scanForMissingTasks` (scheduler job `task-spine-reconcile`, every 10 min) finds recent rows carrying provider IDs with no canonical task and rebuilds their trail deterministically from DB state — with **zero provider calls**. Per-row guard: one bad row never aborts the sweep (stub seam `module.exports.repairOne`).

## How a new feature adopts the spine (checklist for 018/019+)

1. Choose a `task_type` and use the feature row's ID as `source_id` (`source_type` = its table).
2. On owner intent: `createTask(...)` at APPROVED, then transition to QUEUED (actor `owner:<userId>` for human actions, `system:<component>` for automated ones — actors are mandatory on every event).
3. Wrap ALL recording in `safeSpine`, passing `providerSucceeded` truthfully.
4. On execution: EXECUTING → PROVIDER_ACCEPTED (with `external_ref`) → existence read-back → proof row → EXTERNALLY_VERIFIED → REPORTED → COMPLETED. No read-back configured? REPORTED with `verification: 'unavailable'` — say so, don't fake it.
5. Classify failures into the specific failure states (auth vs permission vs rate-limit vs validation vs external); retry only what the FEATURE deems transient (spine records `RETRY_SCHEDULED`, it does not decide).
6. If your inserts happen inside a feature transaction, record post-commit (rule above).
7. Extend the legal-transition table only deliberately, with tests for both the new edge and its illegal neighbors, in `EchoAI/tests/taskSpine.test.js`. Prove transactional pairing with DB-level triggers, never pooled-client monkeypatching.
8. Never write `agent_tasks.status` or `agent_task_events` directly — everything goes through `createTask`/`transition`/`attachEvidence`.

## Owner-facing surface

Read-only endpoints `GET /api/tasks/activity?brandId=` and `GET /api/tasks/:taskId/events` (owner-scoped) feed the Activity tab (`client/src/sections/social/ActivityPanel.jsx`). UI derives ONLY from the spine — it renders what happened, it never infers.
