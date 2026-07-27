---
name: EchoAI scheduler claims + job_runs telemetry
description: Cross-replica per-tick claims and run telemetry for all scheduled jobs; RUN_SCHEDULER boot gate.
---

Every scheduled tick now flows through `runClaimedJob` in `utils/scheduler.js`: the INSERT of the canonical `job_runs` row (unique on job_name + tick_key, `ON CONFLICT DO NOTHING`, outcome starts `running`) IS the atomic cross-replica claim. Losers execute nothing and insert nothing (local log only). Winner finalizes the same row: `skipped` when `executeJob` gating declines (never `success`), `failed` with the captured error (never thrown), else `success`.

**Why:** with >1 Railway replica, every cron job double-runs; and "job ran" claims must come from `job_runs` rows, not logs. A gated tick must not be classified `success` just because no exception occurred.

**How to apply:**
- New jobs registered via `scheduleJob` get claiming/telemetry automatically — never call `run` directly from a cron callback.
- Tick key = fire time truncated to the UTC minute (`tickKeyFor`); replicas seconds apart race for the same row.
- Claim-query failure fails CLOSED (job does not run).
- `RUN_SCHEDULER=false/0/no/off` disables all cron registration on an instance (default true, single web service today); boot log always states enabled/disabled.
- The job inventory is 42 jobs, not 43 — the audit's grep counted the `scheduleJob` function definition line. The 4 Sage cycles keep their per-brand `claimRun` claims underneath the tick-level claim.
- Tests: `tests/jobRuns.test.js` (race, failed, skipped, gate parsing).
