---
name: EchoAI goal tracking (Target Goals & KPI)
description: Durable rules for the per-brand goals/KPI subsystem — no-data snapshot semantics, snapshot/briefing cron ordering, demo exclusion, and multi-alert-per-goal dedup.
---

# EchoAI goal tracking rules

- **No-data goals snapshot as NULL, never 0.** A percent/score snapshot that
  "isn't measurable yet" must persist NULL; readers must treat NULL as no-data
  and skip it. Storing 0 conflates "no data" with a real 0% miss, so aggregators
  (briefing score, at-risk lists) wrongly count it and drag the portfolio down.
  **How to apply:** any writer of a snapshot column that can be unmeasurable
  writes NULL; any reader that averages/classifies it filters NULL first.

- **Snapshot before you read snapshots (cron ordering).** Daily goal tracking
  (snapshot + alerts) must run *before* anything that pre-generates/warms output
  from the latest stored snapshot (e.g. the morning-briefing warm). Otherwise the
  warmed artifact serves yesterday's numbers all day.
  **How to apply:** when adding a job that reads the newest snapshot, order it
  after the snapshot writer, not before.

- **Owner-facing alert sweeps exclude demo brands.** Any background sweep that
  emits real owner notifications (voice/push) must filter `brands.is_demo = false`.
  **Why:** demo/sample data must never generate real alerts for the admin who
  owns the demo brand. **How to apply:** join `brands` and add the demo filter in
  the sweep's brand query — the per-route featureGate/ownership guards don't run
  on background paths.

- **A goal can raise several alerts per day; dedup per (goal, kind, day).** Goal
  alerts are two independent axes: a status alert (hit / exceeding / behind-pace,
  the latter split early vs urgent by projected percent) AND a momentum alert (a
  large single-day swing up/down in percent-to-goal). Each gets its own dedup key
  `goal_alert:<goalId>:<kind>:<date>` so they don't suppress each other.
  **How to apply:** momentum needs the *prior* day's percent — read the previous
  snapshot BEFORE writing today's, then compare. Alert copy is keyed by `kind`,
  not by the raw `status`, so new kinds need their own copy branch + dedup suffix.

- **Atlas optimization guardrails follow the brand's goal type.** The campaign
  optimizer passes active goal targets into the prompt as guardrails: cost-per-lead
  and ROAS for ad-performance brands, plus referrals and commission for
  affiliate/referral brands (the affiliate metrics in `config/goals.js` — there is
  no CTR/CPA metric in this system). **How to apply:** when adding a goal metric
  that should steer optimization, extend both the controller's `IN (...)` metric
  filter and `describeGoalTargets` in the prompt.
