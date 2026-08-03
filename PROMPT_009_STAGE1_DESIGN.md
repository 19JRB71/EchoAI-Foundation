# PROMPT 009 — Stage 1 Design Proposal (task spine)

**Status: awaiting owner authorization. No implementation code has been written.**
Binding inputs: REPLIT_PROMPT_009 v2 + Owner Addendum A–I (recorded in full in
`attached_assets/Pasted--REPLIT-PROMPT-009-v2-Task-spine-schema-unified-lifecyc_1785624042811.txt`).

---

## 0. Preflight findings

- **Migration number:** highest in live `EchoAI/models/` is `130_external_proofs.sql` → **131 is free, as expected (B9)**.
- **Today's publish flow (every state and edge, from code):**
  - `social_posts.status` enum: `draft | scheduled | publishing | published | failed` (012_social_media.sql). `publish_attempts` (065), `external_post_id` (012), `proof_run_key` (130, staging proof only).
  - Entry paths into `scheduled`: owner `schedulePost` (socialController.js:422–523, actor = req.user), calendar activation draft→scheduled (contentCalendarController.js:645) and deactivation scheduled→draft (:686), autopilot approval/immediate (autopilotController.js:1110–1145, 1300–1313), voice approval (voiceContentController.js:548–588). Manual reschedule = failed→scheduled only, resets attempts (socialController.js:534–575).
  - Minute sweep `publishDuePosts` (socialController.js:866–977): (a) stale rescue — atomic UPDATE of `publishing` rows >10 min old → `failed`, never retried (double-post uncertainty), owner alerted from the RETURNING rows; (b) **the claim** — ONE atomic UPDATE scheduled→publishing of due rows (demo brands excluded, LIMIT 50, FOR UPDATE SKIP LOCKED, RETURNING); (c) per row `publishStoredPost`: success = publishing→published + `external_post_id` (missing id = hard failure); transient (`err.transient`/429/5xx) with attempts < 2 = publishing→scheduled at +5 min, attempts+1; otherwise publishing→failed (status-guarded UPDATE; alert only on rowcount).
  - Second owner path `publish-now` (:992–1057): same atomic claim semantics.
  - No Graph read-back in the normal flow today (read-back exists only in the staging proof runner).
- **Claim-pattern reuse (B4):** the sweep's atomic UPDATE-rowcount claim IS the QUEUED→EXECUTING transition. The spine adds **no second claim mechanism** — it records transitions derived from the same RETURNING rows that already decide the claim.

---

## 1. Schemas (B1) — migration `131_agent_tasks.sql`, additive only

### agent_tasks (mutable canonical row, one per unit of work)

| column | type | notes |
|---|---|---|
| task_id | UUID PK default gen_random_uuid() | |
| brand_id | UUID NOT NULL | tenant scope. **No FK** (see below) |
| user_id | UUID NOT NULL | owning user. No FK |
| task_type | TEXT NOT NULL | `'social_publish'` (009); CHECK against known types |
| source_type | TEXT NOT NULL | `'social_post'` (addendum G) |
| source_id | TEXT NOT NULL | `social_posts.post_id::text` |
| attempt | INT NOT NULL DEFAULT 1 | attempt identity (G): a NEW canonical task after a terminal CANCELLED predecessor gets attempt+1; in-lifecycle retries stay on the SAME task |
| status | TEXT NOT NULL | CHECK constrained to the 17 lifecycle states |
| title | TEXT NOT NULL | owner-readable ("Publish to Facebook: …") |
| external_ref | TEXT NULL | provider id (external_post_id) set at PROVIDER_ACCEPTED |
| proof_id | UUID NULL | **reference** to external_proofs.proof_id at EXTERNALLY_VERIFIED — plain UUID, no FK (a FK would block Prompt-029 audited evidence deletion and violates the 006 no-FK-on-immutable-table lesson) |
| last_error | TEXT NULL | redacted |
| meta | JSONB NOT NULL DEFAULT '{}' | platform, scheduled_time, etc. |
| created_at / updated_at | TIMESTAMPTZ | |

- **UNIQUE (task_type, source_type, source_id, attempt)** — one scheduled publish attempt can never create duplicate canonical rows (G). `createTask` is get-or-create: 23505 → return the existing row.
- Indexes for the activity/inbox queries (B1): `(brand_id, updated_at DESC)`, `(brand_id, status)`, `(user_id, created_at DESC)`.
- **No FKs to brands/users/external_proofs** — same reasoning as external_proofs (immutable audit must outlive tenants; FK cascade would also mass-delete the audit trail). Orphan cleanup on account deletion is deferred to the same Prompt-029 audited-deletion design. ⚠ Owner decision point: this means task rows survive brand deletion, exactly like external_proofs rows already do.

### agent_task_events (append-only audit trail — B1, C)

| column | type |
|---|---|
| event_id | UUID PK |
| task_id | UUID NOT NULL (no FK — table is append-only; a cascade DELETE would violate its own trigger) |
| actor | TEXT NOT NULL — `owner:<user_id>`, `system:publish-sweep`, `system:stale-rescue`, `system:autopilot`, `system:voice-approval`, `system:repair` |
| from_status | TEXT NULL (NULL = creation event) |
| to_status | TEXT NOT NULL |
| meta | JSONB NOT NULL DEFAULT '{}' (redacted; error class, attempt counts, provider timing) |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT NOW() |

- Trigger `trg_agent_task_events_immutable` rejects UPDATE and DELETE (identical pattern to 130).
- Index `(task_id, created_at)` for trail reads.

---

## 2. Lifecycle + enforced legal-transition table (B2)

Happy path: `DRAFTED → REVIEWED → APPROVED → QUEUED → EXECUTING → PROVIDER_ACCEPTED → EXTERNALLY_VERIFIED → REPORTED → COMPLETED`.

Legal-transition map (anything not listed **throws** in `taskSpine.transition`):

| from | legal to |
|---|---|
| DRAFTED | REVIEWED, CANCELLED |
| REVIEWED | APPROVED, CANCELLED |
| APPROVED | QUEUED, CANCELLED |
| QUEUED | EXECUTING, CANCELLED |
| EXECUTING | PROVIDER_ACCEPTED, RETRY_SCHEDULED, AUTH_REQUIRED, PERMISSION_DENIED, RATE_LIMITED, VALIDATION_FAILED, EXTERNAL_FAILURE, MANUAL_REVIEW |
| PROVIDER_ACCEPTED | EXTERNALLY_VERIFIED, REPORTED*, MANUAL_REVIEW |
| EXTERNALLY_VERIFIED | REPORTED |
| REPORTED | COMPLETED |
| RETRY_SCHEDULED | QUEUED, CANCELLED, MANUAL_REVIEW |
| AUTH_REQUIRED / PERMISSION_DENIED / RATE_LIMITED / VALIDATION_FAILED / EXTERNAL_FAILURE | QUEUED (owner reschedule only), CANCELLED |
| MANUAL_REVIEW | QUEUED (owner action), CANCELLED |
| COMPLETED / CANCELLED | terminal — nothing |

\* `PROVIDER_ACCEPTED → REPORTED` is legal ONLY with `meta.verification='unavailable'` (platform without a read-back). Facebook publishes always go through EXTERNALLY_VERIFIED. Honesty rule: the trail never claims verification that didn't happen.

Failure-state reachability: all six failure states are reachable **only from EXECUTING** (plus MANUAL_REVIEW from PROVIDER_ACCEPTED for the addendum-F reconciliation case and from RETRY_SCHEDULED for the stale rescue).

---

## 3. Mapping today's scheduled_posts statuses (B3) — every edge, none behavior-changed

| today | spine recording |
|---|---|
| post INSERTed as `scheduled` (owner, calendar activation, autopilot, voice) | createTask at **APPROVED** (creation event, actor recorded per B7) + immediate APPROVED→QUEUED (`scheduled` = approved-and-waiting) |
| calendar `draft` posts | **no task** (drafts are out of the adopter's scope; DRAFTED/REVIEWED remain legal-but-unused in 009) |
| calendar deactivation scheduled→draft | QUEUED→CANCELLED (actor owner). Re-activation = NEW task, attempt+1 (G) |
| sweep claim scheduled→publishing (atomic UPDATE RETURNING) | QUEUED→EXECUTING per returned row (B4 — the existing claim IS the transition; no second claim) |
| publish success publishing→published + external_post_id | EXECUTING→PROVIDER_ACCEPTED, `attachEvidence({externalRef})`; then best-effort Graph read-back (new READ, publish semantics untouched) → EXTERNALLY_VERIFIED + external_proofs reference → REPORTED → COMPLETED (same tick; see §6) |
| transient failure, attempts < 2 → scheduled at +5 min | EXECUTING→RETRY_SCHEDULED (meta: classification incl. 429); at the next claim RETRY_SCHEDULED→QUEUED→EXECUTING (two events) |
| hard/exhausted failure publishing→failed | EXECUTING→{AUTH_REQUIRED (credential-failure classification), RATE_LIMITED (exhausted 429), VALIDATION_FAILED (content), PERMISSION_DENIED, EXTERNAL_FAILURE (rest)} |
| 10-min stale-publishing rescue → failed (never retried) | EXECUTING→MANUAL_REVIEW, actor `system:stale-rescue` (matches its "owner must look" semantics) |
| owner reschedule failed→scheduled (attempts reset) | failure-state→QUEUED, actor owner |
| publish-now path | identical recording to the sweep (APPROVED→QUEUED→EXECUTING→…) |

**Retry policy, timing, 5-min delay, 2-attempt budget, stale-rescue behavior, owner alerts: all byte-identical (C). The spine only records.**

---

## 4. taskSpine.js API (B2, B5)

- `createTask({ brandId, userId, taskType, sourceType, sourceId, attempt, title, status, actor, meta })` — get-or-create on the unique key; always writes a creation event on create.
- `transition({ taskId | bySource, to, actor, meta })` — single transaction: status-guarded atomic UPDATE (`WHERE status = ANY(legalFrom(to))`) + event insert. Illegal target for the current status → **throws**; rowcount 0 with a legal-looking request → returns null (already moved — recorder semantics, no races).
- `attachEvidence({ taskId, externalRef?, proofId?, actor, meta })` — sets external_ref / proof_id + writes an evidence event (reference to external_proofs, never a copy — B5).
- `reconstructTrail({ sourceType, sourceId })` — the addendum-F deterministic repair path: rebuilds the missing task + trail from the existing `social_posts` row (status, external_post_id, publish_attempts, engagement_metrics error) and any external_proofs rows, actor `system:repair`, **never touches the provider, never republishes**.
- **Every adopter call goes through `safeSpine(fn)`**: spine failures are caught, logged, and — if a provider action already succeeded — produce a **high-severity reconciliation task** (`task_type 'reconciliation'`, status MANUAL_REVIEW, meta pointing at the post). A successful publish is NEVER retried because a spine write failed (F); `external_post_id` continues to live in `social_posts` exactly as today.

## 5. Actor model (B7)

Owner scheduling records `actor: owner:<user_id>` on the APPROVED creation event. All system actors are named explicitly (§1 list). Autopilot/voice-approved posts record `system:autopilot` / `system:voice-approval` as creator with the owning user on the task row.

## 6. REPORTED / COMPLETED semantics (B6, addendum H)

The "Approvals & Activity" list reads **only agent_tasks/agent_task_events** (honest-state rule). REPORTED = the verified result durably placed on that owner-visible surface — i.e. the EXTERNALLY_VERIFIED task row is committed and therefore served by the activity query; the REPORTED event records that placement. It does NOT claim the owner viewed it (H). COMPLETED = the report event recorded + no automatic work remains for the attempt; the sweep advances REPORTED→COMPLETED in the same tick.

## 7. Approvals & Activity list (B8)

- `GET /api/tasks/activity?brandId=` — owner-only (getOwnedBrand), newest-first agent_tasks for the brand (status, title, external_ref, updated_at), LIMIT 50; served by the `(brand_id, updated_at DESC)` index.
- `GET /api/tasks/:taskId/events` — the full trail (ownership-checked via the task's brand).
- UI: read-only "Activity" panel inside the existing **Social** section (where the posts it describes live), gated owner-side; derives ONLY from task states. App-shell cache bump (sw.js CACHE version) per addendum E.

## 8. Stage-2 live proof (addendum D + I)

D-23 controls: read-only preflight naming Page (South Dixie Storage `140006069194366`), brand, and innocuous item-14-style text → owner approval → schedule through the NORMAL flow → minute sweep publishes → trail reaches PROVIDER_ACCEPTED → EXTERNALLY_VERIFIED (Graph read-back + external_proofs reference) → REPORTED → COMPLETED → **screenshot trail + activity list + capture all rows FIRST** → only then delete the post, with the deletion's provider response recorded separately (I). Redaction per D-23 term 10 throughout.

## 9. Testing plan (addendum E)

Baseline **1071**. New suite `tests/taskSpine.test.js` + adopter tests: transition-legality matrix (illegal throws), full-flow integration with mocked HTTP asserting the exact trail, duplicate-claim test (concurrent sweeps → exactly one EXECUTING), source-idempotency (G — no duplicate canonical rows; retries explicit), brand-isolation test, spine-failure integrity test (spine write throws → publish still succeeds, reconciliation task appears, `reconstructTrail` rebuilds without republishing — F), append-only trigger test, REPORTED/COMPLETED semantics. Exact new total + decomposition stated in the Stage-2 report.

## 10. What 009 does NOT touch (B10)

Campaign/ad flows (018), email (019), COLLAB_* flags (bus stays dark), retry policy/timing/failure handling, publish semantics, 005's campaign verification authority, autonomy settings, any other feature's approval semantics.

## 11. Branch plan (D-18)

`prompt-009-task-spine` off the current staging tip `5ff21e4` (plumbing push recipe), PR to `staging`, owner merges; migration 131 applies on deploy (additive only). Rollback: revert the merge; tables are additive and dark to every other feature.
