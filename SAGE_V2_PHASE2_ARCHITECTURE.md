# Sage V2 — Phase 2 Architecture Review (Milestone 2)

**Date:** July 17, 2026
**Stage:** Architecture review (stage 1 of the approved lifecycle)
**Blueprint of record:** `SAGE_V2_CHALLENGE_REVIEW.md` Part 4, row P2:
> Canonical `sage_intel_items` (feed becomes a view; junction tables; redaction; data-quality sentry) + job-queue claim table + input-hash skip gates on ALL AI jobs incl. existing deep cycle.

Per the W1 lesson, every claim about current behavior below was re-verified against the live codebase today (file cited inline). No implementation has started.

---

## 1. Verified current state (re-checked July 17, 2026)

| Blueprint assumption | Verified reality | File |
|---|---|---|
| Sage feed has dual-key dedup + soft-dismiss | ✅ `signal_key` + `content_key` (MD5 of normalized summary), `dismissed_at` soft-dismiss, partial unique index on visible rows | `models/069_*.sql`, `models/101_sage_feed_dismiss.sql`, `controllers/sageController.js` |
| Deep cycle daily 06:15, urgent scan */30, pattern study Tue 05:45 | ✅ confirmed | `utils/scheduler.js` |
| ~14 scheduled AI jobs loop brand-by-brand in-process | ✅ confirmed (weekly-analytics, autonomous-growth, autopilot, competitor scans ×3, sage ×3, real-estate ×5, etc.) | `utils/scheduler.js` |
| No general input-hash skip gate exists | ✅ confirmed — what exists is *run claiming* (`sage_research_runs` bucket claims, site-monitor 20h window) and *output dedup* (`content_key`), but **no job skips its AI call when inputs are unchanged** | `controllers/sageController.js`, `controllers/competitorSiteController.js` |
| Raw intel writers: competitor ads / site changes / pattern campaigns | ✅ `competitor_ads` (dedup `ad_archive_id`), `competitor_website_changes` (dedup `change_key`), `sage_pattern_campaigns` | `controllers/competitorAdSpyController.js`, `competitorSiteController.js`, `utils/patternIntelligence.js` |
| Feed readers | `getFeed` (Sage page), weekly briefing (Phase 1), Mission Control urgent card, Echo morning briefing | `sageController.js`, `sageBriefingController.js`, `missionControlV2Controller.js`, `utils/echoBriefing.js` |

**One correction to the blueprint:** the blueprint's phrase "feed becomes a view" is implemented as a **table migration + compatibility read path**, not a literal SQL VIEW (see §3.1) — a plain view cannot carry the partial unique index that the dedup contract requires.

---

## 2. Scope (exactly the P2 row — nothing more)

1. **Canonical intelligence store `sage_intel_items`** — the single write path for all *new* intelligence going forward; the existing feed data is migrated in, and every current reader keeps working unchanged.
2. **Junction-table discipline** — no uuid[] columns anywhere in the new schema (per W3). (Opportunity tables themselves are Phase 5; Phase 2 only establishes the store they will reference.)
3. **Ingestion redaction + `sensitive` flag** (W8) — code-enforced PII stripping at the single write chokepoint; sensitive items owner-only and excluded from any aggregation.
4. **Data-quality sentry** (Part 3 item 6) — nightly deterministic checks (no AI): conflicting active items, stale Company Truth vs. recent changes, coverage gaps → produces nudge rows, never fabricates.
5. **`sage_job_queue` claim table** (W7) — house-pattern `FOR UPDATE SKIP LOCKED` claim table so N workers can drain brands in parallel later; the scheduler enqueues, one in-process worker drains (no behavior change today, removes the future rewrite).
6. **Input-hash skip gates on ALL recurring AI jobs including the existing deep cycle** (W7b) — every job computes a deterministic hash of its actual inputs; unchanged hash = zero AI calls, logged as `skipped_unchanged`.

Explicitly **not** in Phase 2: opportunities, directives, decisions, diagnostics, memory, debate, scorecards (Phases 4–6); no adapters or dual-writes (removed per W2).

## 3. Design

### 3.1 Canonical store, no dual writes (W2)
- New table `sage_intel_items`: `item_id`, `brand_id`, `kind` (trend/competitor/regulation/opportunity_signal/…), `title/summary/why_it_matters/url`, `urgent`, `confidence` (`verified|reported|inferred` CHECK), `sensitive boolean`, `source` (which collector), `source_ref` (link to detail record: ad snapshot / site diff row — raw tables stay as detail stores, never re-synced), `signal_key`, `content_key`, `dismissed_at`, `expires_at`, `created_at`. Same dual-key dedup partial unique index as the feed (the proven pattern).
  - **As-built naming note (migration 117):** the legacy column NAMES are kept verbatim (`source_type` rather than `kind`, `summary`/`why_it_matters`/`source_title` rather than `title/...`), so every existing reader works against either relation by switching only the table name and selecting `item_id AS feed_id`. `utils/intelStore.feedTarget()` owns that switch. The blueprint's `kind`/`title` labels map onto `source_type`/`source_title` 1:1 — semantics unchanged.
- **Migration:** one-time idempotent backfill of existing `sage_intelligence_feed` rows into `sage_intel_items` (keys preserved, so dedup/soft-dismiss history survives). After cutover, `saveFeedItem` writes **only** the new table. `sage_intelligence_feed` is kept read-frozen for one milestone as a rollback net, then dropped in a later phase.
- **Readers:** the four read paths (Sage page, weekly briefing, Mission Control, Echo briefing) switch to one shared query helper over `sage_intel_items`. UI/API response shapes unchanged — zero client contract changes required (client changes limited to nothing or cosmetic).
- New collectors (competitor ad threat classifications, site-change findings) additionally emit an intel item pointing at their raw row via `source_ref` — one write path, raw detail preserved.

### 3.2 Redaction + sensitive flag (W8)
- `utils/intelRedaction.js`: deterministic stripping of emails/phones/names-in-known-fields before any item row is written; applied inside the single `saveIntelItem` chokepoint so no collector can bypass it. Items derived from conversations are written `sensitive=true`, readable only through owner-guarded endpoints, and unconditionally excluded from any aggregate query.

### 3.3 Data-quality sentry
- Nightly job (deterministic SQL only, zero AI): flags (a) contradictory active items (same `signal_key` family, conflicting urgency/claims → sets `conflict_of`, surfaces both), (b) approved Company Truth older than N days with newer material business changes, (c) coverage gaps (e.g. active campaigns but no analytics rows this week). Output = rows in `sage_data_quality_flags` that the existing nudge surfaces read; nothing invented, everything traceable to a rule id.

### 3.4 Job queue claim table (W7)
- `sage_job_queue(job_id, job_type, brand_id, run_key, status, claimed_at, finished_at, error)` with `UNIQUE(job_type, brand_id, run_key)` and `FOR UPDATE SKIP LOCKED` claiming — the exact house concurrency pattern already used elsewhere. Scheduler ticks **enqueue** per-brand jobs; the in-process worker **claims and drains** them serially exactly as today. Behavior identical at current scale; horizontal headroom unlocked without new infrastructure. Stale-claim rescue sweep included (house rule: mark failed with visible error, never auto-retry AI work).

### 3.5 Input-hash skip gates (all AI jobs, incl. existing deep cycle)
- `utils/inputHash.js`: each recurring AI job declares its input set (the exact rows/fields its prompt is built from); a stable SHA-256 of that set is compared to the last run's hash stored on the job-queue row (or a small `sage_job_hashes` table for jobs not yet on the queue). Unchanged → **no AI call**, run recorded as `skipped_unchanged` (honest, visible in admin). Changed → run and store the new hash.
- Applied to: sage-deep-research, sage-urgent-scan, sage-pattern-study, competitor scans ×3, weekly-analytics, autopilot study — every recurring AI job. Conservative rule: **if the hash cannot be computed, run the job** (fail-open on cost, never on staleness).

### 3.6 Feature flags & compatibility
- `SAGE_V2_INTEL_STORE` — cutover of writes/reads to the canonical store (OFF = today's paths untouched).
- `SAGE_V2_JOB_QUEUE` — scheduler enqueue/drain path (OFF = current direct loops).
- `SAGE_V2_SKIP_GATES` — input-hash gating (OFF = every job runs as today).
- `SAGE_V2_DQ_SENTRY` — nightly sentry (OFF = job no-ops).
- All default **OFF** (DB override → env → default, same as Phase 1). With all flags dark the platform is byte-for-byte unchanged; migration tables sit unused. Release-candidate rule honored.

## 4. Risks & mitigations
- **Backfill correctness** → migration is idempotent (`ON CONFLICT DO NOTHING` on preserved keys) + a regression test proving dismissed items stay dismissed and dedup keys still block re-inserts post-cutover.
- **Reader parity** → tests assert the shared helper returns byte-identical shapes to the legacy queries for the same seed data.
- **Skip-gate false skips** → hash covers *all* prompt inputs incl. Company Truth version; regression test: change one input field → job runs; change nothing → job skipped.
- **Queue starvation/stuck claims** → stale-claim rescue sweep + status-guarded terminal updates (house rules already in memory).

## 5. Verdict
No architectural conflicts discovered against the approved blueprint; one documented refinement (view → migrated table + compat read path, §3.1) with rationale. Proceeding to implementation under the four dark flags.
