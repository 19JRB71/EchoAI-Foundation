---
name: EchoAI task spine (Prompt 009)
description: Canonical agent_tasks lifecycle recorder — pairing, recorder semantics, adopter rules, test traps
---

- **Recorder, not controller.** The spine (utils/taskSpine.js) only RECORDS what features do; feature claims/retry/timing stay authoritative. All adopter recording goes through `safeSpine` — a spine failure must never change a publish outcome. If the provider succeeded and recording failed, safeSpine creates a `reconciliation` MANUAL_REVIEW task; a 10-min scan sweep rebuilds any missing trails from social_posts + external_proofs with ZERO provider calls.
- **Transactional pairing:** every transition + its agent_task_events row commit in ONE tx; `transition({client?...})` joins a caller's tx client or opens its own. Test both failure directions with temporary DB triggers that RAISE (never monkeypatch pooled clients).
- **Honesty edges:** REPORTED from PROVIDER_ACCEPTED only with `meta.verification==='unavailable'`; guarded transition miss returns null (no event, no throw); illegal TARGET throws. MANUAL_REVIEW sources = EXECUTING/PROVIDER_ACCEPTED/RETRY_SCHEDULED; CANCELLED reachable from APPROVED/QUEUED. Failed FB read-back after successful publish → MANUAL_REVIEW `verification_failed`, provider NEVER retried (double-post risk).
- **Adopters embedded in feature transactions** (autopilot/voice/calendar) record AFTER their COMMIT in the spine's own tx — spine failure must never roll back an approval. Idempotency: one agent_tasks row per (task_type,source_type,source_id,attempt); terminal predecessor → attempt+1.
- **Test traps:** (1) test files run in parallel processes on the shared test DB — any leftover due `scheduled` social_posts row gets claimed by another file's publishDuePosts sweep (broke tenantIsolation's attempted-count); default test posts to FUTURE scheduled_time, make them due only inside sweep tests. (2) Staging a stale `updated_at` requires disabling `trg_social_posts_updated_at` around the UPDATE.

- **Verification read-back = existence, not metrics.** `socialApi.verifyPostExists` reads only id/created_time/permalink_url — engagement fields need `pages_read_engagement`, which the connected page token does NOT carry (proven live on staging). Never verify a publish with fetchMetrics.
- **Cleanup of spine proof posts:** normal-flow posts carry no staging-proof run claim, so the runner's Graph delete can't touch them and page tokens decrypt only on Railway — FB deletion of normal-flow test posts is an owner step.

**Why:** the spine is the owner-facing audit trail; a fabricated or lost edge is a trust failure worse than a missing one.
**How to apply:** any new agent-executed action type (018/019 may add edges) must adopt via createTask/transition + safeSpine and keep these invariants.
