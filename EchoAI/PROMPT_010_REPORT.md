# Prompt 010 — End-of-Prompt Report (v2, with claims/skips clarification)

**Status: PARTIALLY COMPLETE**
- Code + tests: **COMPLETE** (full suite green, 990/990).
- Deployment to staging: **NOT STARTED** — deploys run from Railway on a git push, which happens from the owner's Git panel, not from this environment.
- 24h telemetry window: **NOT STARTED** — per the binding clarification it may not begin until the migration + wrapper are confirmed active on staging.
- Final acceptance: **PENDING** the two items above.

## 1. Preflight verification (reproduced findings)
- Unconditional scheduler start confirmed at `server.js:462` (`startScheduler()` inside `app.listen`).
- Job inventory: **42 registered jobs** (see §7). The audit's count of "43 scheduleJob registrations" matched 43 occurrences of `scheduleJob({` in `utils/scheduler.js`, but one of those is the **function definition itself** (`function scheduleJob({ name, ... })`). Actual registrations: 42 (24 AI-gated, 18 operational) — verified by loading the module and counting `listScheduledJobs()`.
- Jobs that already had internal claims (Sage's `claimRun` on `sage_research_runs`, per-brand): **4** — `sage-deep-research` (deep), `sage-urgent-scan` (urgent), `sage-pattern-study` (patterns), `sage-opportunity-synthesis` (opps). These remain untouched; the new job-level claim wraps them additionally at the tick level.
- No run telemetry existed anywhere (no `job_runs` or equivalent) — confirmed.
- Railway replica count today: **UNVERIFIED** — no Railway API access from this environment. Believed to be a single web service (which is why `RUN_SCHEDULER` defaults to true), but must be confirmed in the Railway dashboard.

## 2. Boot gate (`RUN_SCHEDULER`)
- `startScheduler()` now returns immediately when `RUN_SCHEDULER` is set to `false`/`0`/`no`/`off` (case-insensitive), logging: `Scheduler DISABLED on this instance (RUN_SCHEDULER=...) . No cron jobs registered here.`
- Unset / empty / any other value ⇒ enabled (default **true**, documented for today's single web service), logging `Scheduler ENABLED on this instance (RUN_SCHEDULER=unset, default true).`
- Gate logic lives in `schedulerEnabled()` (exported, unit-tested). With the gate off, no `cron.schedule` call ever happens.

## 3. Migration
- **`models/125_job_runs.sql`** (additive, idempotent):
  - `job_runs(run_id identity PK, job_name text, tick_key text, started_at timestamptz default now(), finished_at timestamptz, outcome text default 'running' CHECK (running|success|skipped|failed), error text, duration_ms int, UNIQUE(job_name, tick_key))`
  - index `idx_job_runs_name_started (job_name, started_at DESC)`.
- Applied automatically by the existing `npm run migrate` start sequence.

## 4. Claimed + recorded wrapper (semantics)
- `tickKeyFor()` truncates the fire time to the UTC minute (cron granularity), so replicas firing the same tick race for the same row.
- `claimJobRun()` = `INSERT ... outcome 'running' ... ON CONFLICT (job_name, tick_key) DO NOTHING RETURNING run_id` — the insert **is** the claim and the canonical row (generalized Sage pattern).
- Loser: executes nothing, inserts nothing, logs a duplicate-claim skip locally only.
- Winner: runs via the unchanged `executeJob` (all gating semantics preserved), then finalizes the same row: `skipped` (with the gate reason) when gating declined, `failed` (error text captured, never thrown) on throw, else `success`; `finished_at` + `duration_ms` set.
- Claim-query failure fails closed: job does not run, error logged.
- Existing per-iteration sweep-guard behavior inside jobs is untouched; existing sweep-guard tests stay green.

## 5. Tests (`tests/jobRuns.test.js`, real isolated test DB)
- **Duplicate-claim race:** two concurrent `runClaimedJob` calls, same (job, tick) → exactly one executed AND exactly one `job_runs` row (loser inserted nothing). ✅
- **Failed:** job throws → wrapper does not throw; single row with `outcome='failed'` and the error text. ✅
- **Skipped:** claimed but AI-gated tick → `outcome='skipped'` with reason, never `success`; job body never ran. ✅
- Plus tick-key bucketing and `RUN_SCHEDULER` parsing tests.
- Full suite: **990 pass / 0 fail** (includes all existing sweep-guard and `executeJob` gating tests).
- These three tests are also the required success/skipped/failed telemetry examples until staging rows exist.

## 6. Deployment + 24h telemetry window — what remains
1. Owner pushes to Railway staging (Git panel). Deployed SHA = that commit.
2. Confirm active on staging: boot log shows `Scheduler ENABLED...` and `+ applied 125_job_runs.sql` in deploy logs; `SELECT count(*) FROM job_runs` grows within minutes (`social-publish` runs every minute).
3. Restart test: kill/restart the staging service → jobs resume; verify no duplicate rows: `SELECT job_name, tick_key, count(*) FROM job_runs GROUP BY 1,2 HAVING count(*)>1;` must return 0 rows.
4. **Only then** record the 24h window: deployed SHA, UTC start, UTC end (= start + 24h). Extract at the end: `SELECT job_name, tick_key, outcome, started_at, finished_at, duration_ms, error FROM job_runs WHERE started_at >= <window start> ORDER BY started_at;`
- Window status: **PENDING — not started; UTC start/end will be recorded at deploy confirmation.**

## Rollback
- Set `RUN_SCHEDULER=false` to stop all cron registration on an instance (no code change).
- Code rollback: revert this task's commit; the app runs exactly as before.
- The migration is additive; the `job_runs` table can be left in place harmlessly, or `DROP TABLE job_runs;` + `DELETE FROM schema_migrations WHERE filename='125_job_runs.sql';` to fully remove.

## 7. Full job inventory (42)
| job | cron | ai | control | pre-existing internal claim |
|---|---|---|---|---|
| weekly-analytics | 0 8 * * 1 | yes | WEEKLY_AI_STACK_ENABLED | — |
| social-publish | * * * * * | no | — | — |
| follow-up-touchpoints | */5 * * * * | no | — | — |
| drip-emails | 0 * * * * | no | — | — |
| email-blasts | */5 * * * * | no | — | — |
| health-monitor-sweep | 0 * * * * | no | — | — |
| api-quota-sweep | 0 * * * * | no | — | — |
| objections-mining | 30 4 1 * * | yes | — | — |
| data-quality-sentry | 30 3 * * * | no | — | — |
| autonomous-timeout-sweep | */15 * * * * | no | — | — |
| email-inbox-sweep | */15 * * * * | yes | — | — |
| voice-reminders | * * * * * | no | — | — |
| personal-reminders | * * * * * | no | — | — |
| daily-task-sweep | 0 9 * * * | no | — | — |
| closing-summaries | 0 18 * * * | yes | — | — |
| autonomous-growth | 0 7 * * * | yes | AUTONOMOUS_GROWTH_ENABLED | — |
| autonomous-growth-summary | 0 20 * * * | yes | AUTONOMOUS_GROWTH_ENABLED | — |
| portfolio-health-snapshots | 0 6 * * * | no | — | — |
| morning-briefing-warm | 0 6 * * * | yes | — | — |
| goal-tracking | 45 5 * * * | no | — | — |
| beta-program-sweep | 30 9 * * * | no | — | — |
| cross-business-intelligence | 15 8 * * 1 | yes | WEEKLY_AI_STACK_ENABLED | — |
| weekly-learning-study | 0 5 * * 1 | yes | WEEKLY_AI_STACK_ENABLED | — |
| weekly-self-review | 15 7 * * 1 | yes | WEEKLY_AI_STACK_ENABLED | — |
| weekly-autopilot | 30 6 * * 1 | yes | WEEKLY_AI_STACK_ENABLED | — |
| sage-opportunity-synthesis | 30 5 * * 1 | yes | WEEKLY_AI_STACK_ENABLED | **yes (claimRun "opps")** |
| sage-opportunity-maintenance | 20 2 * * * | no | — | — |
| competitor-scan | 0 5 * * * | yes | COMPETITOR_RESEARCH_ENABLED | — |
| competitor-ad-scan | 45 5 * * * | yes | COMPETITOR_RESEARCH_ENABLED | — |
| competitor-site-monitor | 0 4 * * * | yes | COMPETITOR_RESEARCH_ENABLED | — |
| vision-daily-study | 30 4 * * * | yes | — | — |
| competitor-site-digest | 30 8 * * 1 | no | — | — |
| social-connection-reverify | 30 */6 * * * | no | — | — |
| sage-deep-research | 15 6 * * * | yes | SAGE_RESEARCH_ENABLED | **yes (claimRun "deep")** |
| sage-urgent-scan | */30 * * * * | yes | SAGE_URGENT_ENABLED | **yes (claimRun "urgent")** |
| sage-pattern-study | 45 5 * * 2 | yes | SAGE_RESEARCH_ENABLED | **yes (claimRun "patterns")** |
| re-listing-promotion | 20 * * * * | yes | — | — |
| re-seller-lead-ads | 30 7 * * * | yes | — | — |
| re-open-house | 30 7 * * * | no | — | — |
| re-content-morning | 0 9 * * * | yes | — | — |
| re-content-midday | 0 13 * * * | yes | — | — |
| re-content-evening | 0 17 * * * | yes | — | — |

## Future option (recorded, not done)
- Splitting cron into a dedicated Railway service: run one instance with `RUN_SCHEDULER=true` and the web replicas with `RUN_SCHEDULER=false`. The per-tick claims make this safe even during the transition overlap.
