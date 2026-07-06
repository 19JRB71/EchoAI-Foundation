---
name: EchoAI goal tracking (Target Goals & KPI)
description: Cross-cutting gotchas for the per-brand goals/KPI subsystem — field-name casing on brand writes, no-data snapshot semantics, and briefing/snapshot cron ordering.
---

# EchoAI goal tracking gotchas

- **Brand write field casing mismatch.** Client `api.js` and its callers POST
  `brand_type` (snake_case), but `brandController.updateBrand` historically
  destructured only camelCase keys. A snake_case-only body silently produced
  `400 "No fields provided to update"`. `updateBrand` now reads
  `req.body.brandType ?? req.body.brand_type`.
  **Why:** the client mirror returns fields camelCase (`data.brandType`) but the
  DB columns are snake_case, so client write payloads drifted to snake_case.
  **How to apply:** when adding a new updatable brand field, accept both casings
  (or standardize) — don't assume the client sends camelCase.

- **No-data goals must snapshot as NULL, not 0.** `goal_snapshots.percent_to_goal`
  is nullable (migration 061). Storing 0 for an unmeasured goal conflated "no
  data" with a real 0% miss, so the morning briefing (`echoBriefing.summarizeGoals`)
  counted it as at-risk and dragged the portfolio score down.
  **Why:** `summarizeGoals` skips rows where `percent_to_goal == null`; 0 is a
  measurable value it will not skip.
  **How to apply:** any writer of a percent/score snapshot that can be "not yet
  measurable" must persist NULL, and readers must treat NULL as no-data.
  Note: `goalAlerts` is unaffected — it uses live-computed `status` (no_data
  excluded from ALERT_STATUSES), not the stored snapshot column.

- **Snapshot-before-briefing cron ordering.** Daily goal tracking
  (`runDailyGoalTracking`: snapshot + alerts) runs at 05:45, *before* the 06:00
  morning-briefing warm (`warmMorningBriefings`), because the pre-generated
  briefing reads the latest stored snapshot. If snapshots ran after the warm, the
  briefing would serve yesterday's goal numbers all day.
