---
name: EchoAI ad-launch task spine
description: Canonical adopter for Facebook ad-launch task trails (Prompt 018) — invariants, failure classes, and test gotchas.
---

## Rules
- ALL launch entry points (manual, Ad Studio, Autopilot, Echo, Setup Wizard) go through `utils/adLaunchSpine.js` — never create ad_launch tasks elsewhere. Source id = pre-generated `campaigns.campaign_id`; both success AND launch_failed rows must insert with that explicit id so the trail stays joined.
- **Why:** the task trail, external_proofs reference, and campaigns row are only auditable if they share one source identity; a generated-id failure row is an orphan.
- PROVIDER_ACCEPTED requires ALL FOUR FB ids; persist-fail after provider success = PROVIDER_ACCEPTED → MANUAL_REVIEW `persist_failed`, NEVER relaunch; verify-fail = MANUAL_REVIEW, no retry; partial chain always EXTERNAL_FAILURE.
- `recordFailedLaunch` explicit-id fallback to a generated id fires ONLY on PK collision 23505; other errors bubble to log-and-null (don't sever identity on transient DB errors).
- State agreement (campaigns.status vs task state) throws in tests (NODE_ENV=test OR `__ECHOAI_TEST_DB_URL` marker), MANUAL_REVIEW in prod — never silently reconciled.
- Reconciliation rebuilds (reconstructLaunchTrail) are bookkeeping-only: ZERO provider calls; missing proof = honest `verification:'unavailable'`, never fabricated.
- `verifyCampaignStatus` additionally returns a verbatim `readBack` payload (additive); assert verdict fields individually, not deepStrictEqual on the whole result.

## Test gotchas
- external_proofs is append-only ACROSS test runs: test-inserted proof rows need per-run-unique run_key AND external_id (`${Date.now()}`), or reruns hit the (run_key, action) unique constraint and stale proofs get reused by ORDER BY created_at.
- The FB fetch mock's chain ids must be unique per test wherever a proof lookup by external_id happens (parametrize an idPrefix); findExistingAdId is NOT user-scoped, so shared mock ids collide across parallel test files.

## Known pre-existing risk (ruled acceptable for 018; reserved as PROMPT 033)
- autopilot approveItem wraps the launch inside the item-claim transaction; a COMMIT failure after a successful launch leaves the item pending with a real campaign existing → retry could double-launch. Reviewer ruling: architecture-bounded (dupes are PAUSED/$0 per 015 caps; spine source-uniqueness makes it detectable). Fix reserved as Prompt 033 (provider call outside the claim tx, or idempotent claim) — HARD DEADLINE before Prompt 026.
- The "no new approvals inbox needed" judgment is NOT final — it is Prompt 019's Gate-D design question, carried as an open question into 019 preflight.
