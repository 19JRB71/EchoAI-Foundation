# Department Collaboration — Stage 0 Completion Report

**Prepared for:** James (CEO) — final Stage 0 review
**Date:** July 19, 2026
**Status:** ✅ Stage 0 COMPLETE — built dark, fully tested, architect-reviewed (PASS)
**Governing spec:** `ZORECHO_DEPARTMENT_COLLABORATION_ARCHITECTURE.md` — ✅ APPROVED, permanent baseline (changes only by CEO-approved amendment)
**Customer impact today:** **NONE.** Every collaboration flag is OFF. Not one customer-visible behavior changed.

---

## 1. Exact Stage 0 functionality implemented

Stage 0 is the *foundation only*: the message table, the single code chokepoint
all department communication must pass through, the Knowledge Registry (who
owns what information), the nightly cleanup, and the feature flags — all dark.
No department actually uses the bus yet; that is Stage 1, which has **not**
been started.

## 2. Every file created or modified

| File | Change |
|---|---|
| `EchoAI/models/122_collaboration_bus.sql` | **NEW** — `department_messages` table + constraints + indexes |
| `EchoAI/config/knowledgeRegistry.js` | **NEW** — 10 topics, owners, schemas, denylist |
| `EchoAI/utils/collaborationBus.js` | **NEW** — the bus chokepoint (all rules in code) |
| `EchoAI/tests/collaborationBus.test.js` | **NEW** — 16 automated tests |
| `EchoAI/config/aiControls.js` | Modified — 10 collaboration flags registered, all OFF |
| `EchoAI/utils/scheduler.js` | Modified — bus maintenance as a guarded branch of the existing nightly job |
| `ZORECHO_DEPARTMENT_COLLABORATION_ARCHITECTURE.md` | Modified — status header set to ✅ APPROVED |
| `MILESTONES.md` | Modified — approval + Stage 0 completion rows |
| `COLLAB_STAGE0_COMPLETION_REPORT.md` | **NEW** — this report |

No client (dashboard) files changed — this is a server-only, dark change.

## 3. Database migration — complete `department_messages` schema

Migration `122_collaboration_bus.sql` (applied to development and test
databases; idempotent, additive only):

| Column | Type | Purpose |
|---|---|---|
| `message_id` | UUID PK (auto) | unique message id |
| `brand_id` | UUID NOT NULL → `brands` (cascade delete) | brand isolation |
| `from_dept` / `to_dept` | TEXT NOT NULL | sender/recipient, locked to the 10-department roster by CHECK |
| `kind` | TEXT NOT NULL | `request` \| `response` \| `report` \| `alert` (CHECK) |
| `topic` | TEXT NOT NULL | must exist in the Knowledge Registry (enforced in code) |
| `payload` | JSONB NOT NULL | schema-validated content |
| `correlation_id` | UUID → `department_messages` | links a response to its request |
| `plan_id` | UUID | **reserved for Stage 3** Echo plans; unusable by anyone else |
| `status` | TEXT NOT NULL default `sent` | `sent` \| `claimed` \| `answered` \| `declined` \| `expired` \| `failed` (CHECK) |
| `priority` | TEXT NOT NULL default `routine` | `routine` \| `elevated` (CHECK) |
| `answer_by` | TIMESTAMPTZ | request deadline (default 24h) |
| `input_hash` | TEXT | dedup key (SHA-256 of topic + sorted payload) |
| `error_message` | TEXT | honest failure/decline/expiry reason |
| `created_at` / `claimed_at` / `answered_at` | TIMESTAMPTZ | audit timeline |

Constraints and indexes:
- `dept_msg_from_chk` / `dept_msg_to_chk` — only the 10 real departments
  (echo, scout, atlas, nova, pulse, voice, forge, sentinel, sage, vision).
- `dept_msg_correlation_chk` — **anti-loop at the database level**: a request
  can never carry a `correlation_id`; a response must carry one.
- `dept_msg_plan_chk` — `plan_id` only on Echo-originated requests.
- `uniq_dept_msg_one_response` — partial unique index: **at most one response
  per request**, guaranteed by the database itself.
- Indexes for department inboxes, brand activity, deadline sweeps, and dedup
  lookups.

## 4. Collaboration feature flags — all confirmed OFF

Registered in `config/aiControls.js` `SWITCH_DEFAULTS` (DB override > env >
code default; unregistered names throw, so a typo can never silently pass):

| Flag | Gates | Default |
|---|---|---|
| `COLLAB_BUS` | the entire bus (Stage 0) | **OFF** |
| `COLLAB_ACTIVITY_VIEW` | Stage 2 owner-facing activity view | **OFF** |
| `COLLAB_FORGE_SAGE` | Stage 1: Forge consults Sage strategy | **OFF** |
| `COLLAB_ATLAS_INTEL` | Stage 1: Atlas reads Scout competitor intel | **OFF** |
| `COLLAB_NOVA_STRATEGY` | Stage 1: Nova aligns content with strategy | **OFF** |
| `COLLAB_PULSE_REPORTS` | Stage 1: Pulse lead-outcome reports | **OFF** |
| `COLLAB_VOICE_INSIGHTS` | Stage 1: Voice customer-language insights | **OFF** |
| `COLLAB_SCOUT_ENRICH` | Stage 1: Scout enrichment on demand | **OFF** |
| `COLLAB_DEPT_SCORECARDS` | Stage 2 (CEO Addition 1): scorecards | **OFF** |
| `COLLAB_ROUNDTABLE` | Stage 3 (CEO Addition 2): Executive Roundtable | **OFF** |

An automated test asserts all 10 exist and default OFF — a regression that
flipped any of them would fail the suite.

## 5. `collaborationBus.js` — responsibilities and enforcement chokepoints

The bus is the **single chokepoint**; every rule lives in code, none in AI
prompts. Public functions: `sendRequest`, `claimRequest`, `respondToRequest`,
`sendReport`, `sendAlert`, `runBusMaintenance`, `getRecentActivity`.

Enforced on every message, in order: flag check → department roster check →
topic exists in registry → routing rule (requests to owner / reports from
owner / alerts to Echo only / no self-messages) → strict payload schema →
secret-key denylist deep scan → real-brand check (demo excluded) → per-brand
daily cap. Any failure returns a plain-English error and writes nothing.

## 6. Knowledge Registry — topics, ownership, schemas, honest empties

`config/knowledgeRegistry.js` defines the 10 v1 topics. **One owner per
topic**; adding a topic means naming its owner and schema in code review —
ownership disputes are design-time, never runtime.

| Topic | Owner | Class | Freshness |
|---|---|---|---|
| `strategy.current` | sage | lookup | 60 min |
| `truth.company` | sage | lookup | 360 min |
| `scorecard.channel` | sage | lookup | 60 min |
| `intel.competitor` | scout | lookup | 120 min |
| `creative.request` | forge | **generation** (the only one in v1) | 0 (never dedup-served) |
| `campaign.performance` | atlas | lookup | 60 min |
| `social.calendar` | nova | lookup | 30 min |
| `leads.outcomes` | pulse | lookup | 60 min |
| `customer.language` | voice | lookup | 1440 min |
| `system.health` | sentinel | lookup | 15 min |

- Every topic declares a request schema and a response schema
  (field → validator).
- **Honest-empty contract:** every response schema includes `available`
  (boolean) + `reason` — "no data" is always an explicit, stated answer;
  `{}` is never an answer and nothing is ever fabricated.

## 7. Request / response / report / alert lifecycle

- **Request:** consumer → topic owner, with a deadline (`answer_by`,
  default 24h). Statuses: `sent` → `claimed` → `answered`/`declined`, or
  `expired`/`failed` via maintenance.
- **Response:** owner → original requester, always carrying
  `correlation_id`; born terminal (`answered` or `declined`).
- **Report:** fire-and-forget fact, **only the topic owner may publish it**
  (facts come from the department that owns the data); validated against the
  topic's response (fact) schema; born terminal.
- **Alert:** owner-attention fact, routes **only through Echo** (§3.1/§8);
  supports `elevated` priority; born terminal.

## 8. Legal status transitions and terminal-state enforcement

Legal request transitions (everything else is impossible):
`sent → claimed` (claim) · `sent|claimed → answered` (answer) ·
`sent|claimed → declined` (decline) · `sent|claimed → expired` (deadline) ·
`claimed → failed` (stale-claim rescue).

`answered`, `declined`, `expired`, `failed` are **terminal and immutable** —
the respond path explicitly refuses ("Request is already X — terminal states
are final"), and every transition is a status-guarded `UPDATE ... WHERE status
IN (...)` whose row count is checked, so a concurrent state change means
nothing is written (Appendix A pattern used platform-wide).

## 9. Atomic claim, answer, decline, expiry, and failure behavior

- **Claim:** one atomic status-guarded UPDATE (`sent → claimed`, only for the
  addressed department) — two concurrent claimers cannot both win. A
  defensive registry check additionally rejects (and reverts) a claim by any
  department that is not the topic's registered owner.
- **Answer/decline:** one database transaction — row-lock the request
  (`FOR UPDATE`) → validate ownership, status, and response payload → insert
  the response → flip the request. The response and the request status can
  never disagree. A decline **requires a plain-English reason**, stored on
  both rows.
- **Expiry:** overdue `sent`/`claimed` requests flip to `expired` with the
  honest message "No response before the deadline."
- **Failure:** a claim older than 2 hours with no answer flips to `failed`
  with "Consumer claimed this request but never answered." **Never silently
  retried** (double-work risk); failures are visible in the log.

## 10. Correlation validation and one-response-per-request

Both enforced by the **database itself**, not just code:
- `dept_msg_correlation_chk` — requests never carry `correlation_id`;
  responses always do.
- `uniq_dept_msg_one_response` — a second response to the same request
  violates the unique index; the bus maps that to a clean "This request
  already has a response" error inside a rolled-back transaction.

## 11. Brand isolation and demo-brand exclusion

Every message requires a `brand_id` belonging to a **real** brand
(`is_demo = false` checked at the chokepoint); demo brands are rejected with
an explicit error. Activity reads are brand-scoped. Deleting a brand cascades
its messages away.

## 12. Payload schema enforcement (additionalProperties: false)

`validatePayload` checks every declared field's validator AND rejects any
field not in the schema: *"Payload field X is not allowed (schema-only
payloads)."* Unknown fields are **rejected, never silently stripped** —
tested explicitly. Response payloads get the same treatment at answer time.

## 13. Secret-field denylist protections

Defense in depth on top of schemas (which can never declare credential
fields): a deep, case-insensitive, substring scan of every payload for
`token`, `secret`, `password`, `api_key`, `authorization` — at any nesting
level (8 deep), inside arrays too. A hit rejects the whole message. Applied
to requests, responses, reports, and alerts alike.

## 14. PII minimization and redaction behavior

Per Appendix B, enforced structurally by the schemas themselves:
- `leads.outcomes` carries **references and aggregate counts only** — the
  schema has no name/email/phone fields, so copies of contact data are
  rejected by the schema-only rule before they can touch the bus.
- `customer.language` carries aggregated themes/objections plus a
  `sample_count`; producer-side redaction before the bus write is the
  documented contract for Stage 1 producers.
- The denylist scan (item 13) backstops credential-shaped keys everywhere.

## 15. Input-hash deduplication and freshness windows

Every request gets a SHA-256 `input_hash` of topic + key-sorted payload. If an
**answered** request with the same brand + topic + hash exists inside the
topic's freshness window, the logged response is served back **free** — no
new row, no consumer wake-up, flagged `deduplicated: true`. Generation topics
(`creative.request`, freshness 0) are **never** dedup-served — generated work
is always fresh work.

## 16. Daily caps and anti-loop enforcement

- **Cap:** at most 200 collaboration messages per brand per day (structural
  cost bound, §10.3); the 201st send is rejected with an explicit error.
- **Anti-loop:** a department can never create a request *in reaction to* a
  response, because requests physically cannot carry a `correlation_id`
  (database CHECK — tested by attempting the forbidden insert directly).
  Chained work is reserved exclusively for Echo's Stage 3 plan mechanics.

## 17. Echo plan foundations (Stage 0 scope)

Only the groundwork: the `plan_id` column exists and is constrained so that
**only Echo-originated requests** may ever carry it. No plan logic, no
orchestration, no Roundtable — those are Stages 3+ and were not touched.

## 18. Expiry sweep and stale-claim rescue

`runBusMaintenance()` runs as a **guarded branch inside the existing nightly
maintenance job** (`runSageOpportunityMaintenance` in `utils/scheduler.js`) —
**no new scheduled job was added**. It: expires overdue requests, rescues
stale claims to `failed` with an honest reason (never auto-retried), and
purges old rows. A failure in the bus branch never blocks the rest of the
nightly job, and with `COLLAB_BUS` off the branch is a complete no-op.

## 19. 180-day retention cleanup

Messages older than 180 days (Appendix B) are deleted nightly,
batch-limited (5,000/night) so a backlog can never stall the job.

## 20. Dark-response behavior while flags are OFF

Every public bus function checks `COLLAB_BUS` **first** and returns an honest
`{ enabled: false }` before touching the database. The dark test proves the
table's row count is byte-for-byte unchanged after calling every entry point
with the flag off. The nightly branch likewise no-ops.

## 21. The getSwitch issue — root cause, exact fix, regression coverage

- **What happened:** during the build, the bus's first draft treated the
  platform's flag reader `getSwitch()` as a simple synchronous lookup.
  It is neither: it is **async** (it checks the database-level admin override
  before env/code defaults) and it **throws on unregistered flag names**
  (a deliberate typo guard). The first test run failed immediately.
- **Root cause:** flag read used before (a) awaiting the async result and
  (b) registering the `COLLAB_*` names in `SWITCH_DEFAULTS`.
- **Exact fix:** `busEnabled()` now `await`s `getSwitch("COLLAB_BUS")`, every
  entry point awaits `busEnabled()`, and all 10 flags were registered in
  `config/aiControls.js` before any read.
- **Regression coverage:** the "flags: all collaboration flags registered and
  default OFF" test calls `getSwitch()` for each flag (throws if any name is
  unregistered) and asserts OFF; the dark test exercises the awaited path on
  every entry point. Caught in development by automated tests — it never
  reached the live product.

## 22. Tests added — all 16 Collaboration Bus tests

`EchoAI/tests/collaborationBus.test.js` (node:test against the real isolated
test database, no mocks of the store):

1. registry: every topic has exactly one owner from the roster and a class
2. registry: creative.request is the only generation topic in v1
3. registry: schema-only payloads reject extra fields, never strip
4. registry: denylisted keys found deep, case-insensitive, substring
5. dark: every bus entry point answers {enabled:false} and writes nothing
6. request: full lifecycle send → claim → respond, one response only
7. request: decline requires a reason and records it honestly
8. request: validation walls — unknown topic, wrong schema, denylist, demo brand, self-message
9. request: response payload is schema-validated and denylist-checked too
10. dedup: identical fresh answered request is served from the log
11. reports/alerts: only the owner publishes reports; alert routes only through Echo
12. anti-loop: requests can never carry a correlation_id (DB CHECK)
13. cap: per-brand daily message cap rejects further sends
14. maintenance: expires overdue, rescues stale claims, purges past retention
15. activity: brand-scoped recent messages, capped limit
16. flags: all collaboration flags registered and default OFF

## 23. Final test totals and validation results

| Gate | Result |
|---|---|
| Full server suite (`npm test`) | ✅ **925 / 925 pass** (909 baseline + 16 new; 0 failures, 0 skips, 0 regressions) |
| Client suite (vitest) | ✅ **372 / 372 pass** (no client changes) |
| Client production build | ✅ clean |
| Migration on a fresh test database | ✅ applies cleanly |
| All three registered validation gates at completion | ✅ PASSED |

## 24. Architect review — findings and exact fixes

Independent architect review (full git diff + approved spec): **PASS — "meets
the stated scope and the critical architecture invariants, with no blocking
deviations found."** Every invariant was individually confirmed (dark
behavior, chokepoint-in-code, ownership, anti-loop, Appendix A concurrency,
maintenance integration, house conventions). Security: none observed.

One **optional hardening** was suggested and **implemented**: `claimRequest`
now double-checks the Knowledge Registry owner (in addition to the row's
`to_dept`), reverting the claim if a manually inserted malformed row ever
addressed the wrong department. All tests re-run green after the change.

## 25. Deviations from the approved architecture

**None.** One internal design refinement worth stating for the record:
reports are validated against the topic's *response* (fact) schema and may
only be **published by the topic owner** to a consumer — the natural reading
of "facts come from the department that owns the data." This tightens, not
loosens, the spec.

## 26. Known limitations (by design, for Stage 0)

- The bus has **no consumers** — nothing sends real messages until Stage 1.
- The Stage 2 activity view, scorecards, and Stage 3 Echo plans/Roundtable
  are flags + reserved columns only.
- Dedup serves only *answered* requests; declined/expired ones are never
  reused (correct: an honest "no" shouldn't be cached as an answer).
- The daily cap (200) and stale-claim window (2h) are code constants; tuning
  them later is a one-line change each.

## 27. Confirmations

- ✅ **Stage 1 not started.** No department consumes the bus.
- ✅ **Scorecards not started** (flag reserved, OFF).
- ✅ **Executive Roundtable not started** (flag reserved, OFF).
- ✅ **No customer-facing collaboration features** exist or are visible.
- ✅ **No new recurring AI jobs** — the platform's job count is unchanged;
  bus maintenance rides the existing nightly job and consumes zero AI.
- ✅ **No new execution paths** — the bus can carry information only; the
  single generation topic routes through Forge's *existing* gated paths
  (tier checks, cost ledger, approvals all unchanged) and only from Stage 1.

## 28. Final readiness recommendation

Stage 0 is **complete, dark, and safe**. The foundation matches the approved
architecture exactly, is enforced in code and in the database (not prompts),
passed 925 automated server tests plus an independent architect review, and
cannot affect a single customer while the flags stay OFF.

**Recommendation:** approve Stage 0 as complete. On your explicit go-ahead —
and only then — Stage 1 (the first real department flows, each behind its own
OFF flag) can begin as the next separately-approved milestone.
