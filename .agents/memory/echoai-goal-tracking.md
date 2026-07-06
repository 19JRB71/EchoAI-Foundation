---
name: EchoAI goal tracking (Target Goals & KPI)
description: Durable rules for the per-brand goals/KPI subsystem — no-data snapshot semantics, snapshot/briefing cron ordering, demo exclusion, multi-alert-per-goal dedup, aim-higher raise suggestions, and complete weekly goal narration.
---

# EchoAI goal tracking rules

- **Achieved goals must challenge the owner to aim higher, not just celebrate.**
  When a goal hits/exceeds target, Echo's spoken alert appends a raise-the-target
  suggestion for next cycle. Suggested basis: for cumulative goals use the
  projected end-of-month pace (captures "at this rate you'll reach X"); for rate
  goals stretch from the current beat; always at least +10% over the old target;
  decrease/cost goals tighten ~10% lower. Round to human-friendly numbers by unit.
  **How to apply:** the suggestion helper gates on percentToGoal >= 100 and returns
  null when the ambitious target isn't meaningfully different. Only hit/exceeding
  spoken copy carries it (never the short push body). CRITICAL: any spoken value
  formatter must cover EVERY unit (currency/ratio/percent/count) — a missing
  percent branch silently drops the `%` and mis-rounds CTR/rate suggestions.

- **Every weekly briefing must carry a complete per-brand, per-goal progress
  read.** For each active brand, each measurable goal gets its own plain-English
  sentence: percent-to-goal plus a pace assessment (percent-to-goal vs percent of
  the month elapsed) for cumulative goals; cost/decrease goals framed as % below/
  above target. The goal section renders BEFORE opportunities, is included even on
  otherwise-quiet weeks, and no goal is ever omitted for length (the AI word/token
  budget scales with goal count). **How to apply:** gather goals best-effort with a
  per-brand try/catch so one brand's failure never aborts the whole briefing;
  goals with no measurable reading are skipped, and a brand with no measurable
  goals drops out of the section entirely.

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

- **Department goal panels are strict per-category (Atlas=campaign, Nova=content,
  Pulse=lead+appointment, ROI=revenue).** Each department maps to ONLY its spec
  categories — no cross-contamination (Atlas is campaign-only, ROI is
  revenue-only; affiliate goals intentionally have no department panel). **Why:**
  the spec assigns exact categories; leaking revenue into Atlas or campaign into
  ROI surfaces goals in the wrong dashboard. **How to apply:** never widen a
  department's categories without re-checking the spec.

- **Every cross-brand goal aggregate excludes demo brands.** Not just the alert
  sweep — the Mission Control Goals Overview must also filter out demo brands, or
  demo data pollutes the portfolio score and attention list.

- **Mission Control's Goals Overview lists EVERY goal for every real business.**
  The spec wants the full per-goal listing (per-goal status + progress) grouped by
  business, not just per-brand summary chips or a truncated at-risk list. **How to
  apply:** render all goals the overview returns; don't cap or collapse them to a
  summary.

- **The post-onboarding goal wizard is conversational + AI-parsed, and MUST be
  non-blocking.** The owner's plain-English goals go to the AI via a
  catalog-constrained prompt; the parser drops anything not in the brand's metric
  catalog so a goal is never fabricated. Upstream AI failure → 502, and the wizard
  falls through to manual selection on ANY error so onboarding never stalls.
  **How to apply:** keep the parse-vs-save split — parsing only suggests; the
  owner confirms before anything persists.

- **A tier-forked dashboard entry point must render shared panels on BOTH
  branches.** The ROI dashboard forks: lower tiers get the basic dashboard,
  Enterprise gets the advanced one. A panel added to only one branch (the basic
  one) silently vanishes for the other tier. **How to apply:** put cross-tier
  panels (e.g. the revenue goals panel) in the parent/entry point, or add them to
  every branch — never assume one branch covers all tiers.

- **Logged alerts must be read back into a visible feed, not only dispatched.**
  Writing an alert row + firing voice/push is not "surfaced in the UI" — the
  Mission Control attention feed must actually query the alert log and render it.
  **How to apply:** when a spec says an alert is "shown/logged in <panel>", wire a
  read path into that panel's data source, not just the outbound notification.

- **Alert claim rows double as the owner-facing feed — dismiss flags, never
  deletes.** The per-(goal, kind, day) claim row IS the feed row owners review;
  dismissing sets a `dismissed_at` flag so the claim still dedups re-run ticks.
  Muting a goal skips the whole alert loop for it (no claim, no channel) but the
  goal is still snapshotted daily so history/trend keeps accruing — and the mute
  lookup fails OPEN to alerting (a lookup error must not silence real alerts).
  **How to apply:** never DELETE from the alert log to "clear" the feed, and
  never gate snapshots on mute state.

- **The daily alert fan-out is claimed channel-agnostically per (goal, kind,
  day).** Before dispatching ANY channel (voice / web push / mobile push), win an
  atomic unique-row claim for that (goal, kind, day); only the winning tick
  dispatches. **Why:** the per-user voice dedup key only de-dupes voice, so
  push/mobile would double-send on overlapping or re-run ticks — and gating push
  on the voice enqueue instead would wrongly suppress push when a user has voice
  notifications off. **How to apply:** the claim, not the voice enqueue result,
  gates the push fan-out.

- **Testing the sweep's best-effort guards: the voice enqueuer never throws.**
  `enqueueOwnerVoiceEvent` swallows all errors internally (returns null), so a
  test that wants a dispatch-path throw must force it at another call inside the
  same per-alert try (e.g. a synchronous throw from the push stub). Per-brand
  failure is simulated by making the fake db's metric query throw for that brand
  (it escapes `snapshotBrandGoals` into the per-brand catch). **How to apply:**
  extend `makeGoalSweepDb` (seed `failMetricsForBrands`) rather than trying to
  monkey-patch the destructured voice import — it's captured at module load.

- **Atlas optimization guardrails follow the brand's goal type — affiliate = CTR
  + CPA (this is a literal spec requirement, not an interpretation).** The campaign
  optimizer passes active goal targets into the prompt as guardrails: cost-per-lead
  and ROAS for standard ad brands; click-through rate (`ctr`) and cost per
  acquisition (`cpa`), plus referrals/commission, for affiliate brands. CTR/CPA
  live in the `affiliate` category so only affiliate brands can set them → only they
  inject them, matching the spec's "when the brand is configured as an affiliate
  business." **Why:** an earlier pass wrongly concluded "no CTR/CPA metric exists"
  and mapped affiliate to referrals/commission only; the spec explicitly says
  "Atlas specifically optimizes for click through rate and cost per acquisition"
  for affiliate brands — do not drop CTR/CPA again. **Data source:** CPA derives
  from `analytics` (`total_spend / conversions`); CTR needed a real source, so the
  weekly analytics writer now stores `clicks/impressions/ctr` from FB insights
  (`ctr` column added). **How to apply:** when adding a goal metric that should
  steer optimization, extend the controller's `IN (...)` filter, `describeGoalTargets`
  in the prompt, `METRIC_SQL` in goalMetrics, and the client `formatValue` unit.
