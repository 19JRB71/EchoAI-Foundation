---
name: EchoAI Autonomous Growth Mode
description: Guardrail engine that autonomously acts on campaigns daily; the concurrency, guardrail-escalation, and money-unit invariants it must uphold.
---

# EchoAI Autonomous Growth Mode

Daily scheduler engine: within owner guardrails, adjusts budgets, pauses losers +
reallocates to winners, refreshes fatigued ads, tunes follow-up timing, learns
from conversion data. In-guardrail moves auto-execute; anything beyond a guardrail
becomes a `proposed` action the owner approves/declines.

## Invariants (every one caused a real fix)

- **Per-day run must be claimed atomically, not read-then-run.** Two scheduler
  ticks / workers can otherwise move the same brand's budgets twice in a day.
  Claim with `INSERT ... ON CONFLICT (brand_id) DO UPDATE ... WHERE last_run_at IS
  NULL OR last_run_at::date < CURRENT_DATE RETURNING` — only the row-returner runs.
  **Why:** budget/pause actions compound; idempotency backstops aren't enough.

- **Approve/decline must be one atomic status flip, side-effects after winning.**
  `UPDATE ... SET status='approved' WHERE ... AND status='proposed' RETURNING`,
  then run the FB/DB change only if a row came back. A read-then-write approve can
  execute *after* a concurrent decline. Decline mirrors it (`WHERE status='proposed'`).

- **Every guardrail must be enforced in the engine, not just documented.** Geo was
  the miss: `geoAllowed()` existed but wasn't called. Each capability that could
  breach a guardrail (budget cap/approval threshold, geo) must check it and escalate
  to `proposed` when breached — a pure helper existing ≠ enforced.

- **Money units: DB budgets are dollars; Facebook `daily_budget` is cents.** Every
  path that pushes a budget to `graphPost` (auto-apply AND owner-approve) must
  `Math.round(dollars * 100)`. Missing the ×100 on any one path silently mis-bills.

- **Per-brand/per-capability best-effort.** Wrap each capability + each brand in
  try/catch so one AI/FB/DB failure logs and continues — never aborts the whole
  daily sweep.

## Wiring notes
- Follow-up timing factor lives in `growth_brand_state.followup_timing_factor`
  and is applied in `followUpController.persistSequence` by scaling each
  touchpoint's dayOffset (defaults 1.0; wrapped in try/catch so the column being
  absent can't break enrollment).
- Daily summary deduped per (user, day) via a unique key on `growth_daily_summaries`
  claimed with `ON CONFLICT DO NOTHING RETURNING` before sending email + voice.
