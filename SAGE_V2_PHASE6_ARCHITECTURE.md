# Sage V2 — Phase 6 Architecture Review (Milestone 6)

**Status: PROPOSED — awaiting CEO review. No implementation has begun.**
**Blueprint of record:** `SAGE_V2_CHALLENGE_REVIEW.md` Part 4 (revised phase plan).
**Gate check:** Phase 3 (outcome capture) and Phase 5 (opportunity queue, Directive
Bus, Change Diagnostics) are both implemented and approved. Gate satisfied.

Approved lifecycle applies: this Architecture Review → CEO approval →
Implementation → Testing → Architect self-review → Completion report → CEO
approval. All new behavior lands behind new flags, default OFF, dark until
enabled. Additive-only migration. Backward compatible. Every invariant from
Phases 1–5 (honesty, owner-only, evidence-first, AI→502, no fabrication)
carries forward unchanged.

## 1. Executive summary

Phase 6 turns Sage from "recommends individual opportunities" into "holds a
coherent, explainable strategy." Five capabilities, per the locked plan:

1. **Deterministic channel scorecards** — always-current per-channel views
   (spend, leads, cost/lead, conversions, ROAS, trend) computed by arithmetic
   from `analytics` + leads/outcome data. **No AI commentary in v1** (explicit
   REMOVE in the challenge review): numbers first.
2. **Honest forecasts** — range forecasts (low/expected/high) from the brand's
   own history using deterministic methods (trailing means + observed
   variance). Every forecast carries its basis, its assumption list, and an
   honest "insufficient history" state below a minimum-weeks threshold.
   Never a single fabricated point number, never AI-invented.
3. **Executive Debate** — for *significant* strategy items only (budget
   allocation, channel mix, quarterly priorities — NOT every opportunity):
   one Claude call generates ≥3 realistic options with tradeoffs, risks, and
   "do nothing" as a mandatory baseline. Stored on the strategy item
   (`options_considered` JSONB, written once, immutable) and shown to the
   owner. Cost guard: max 2 debates/brand/month, event-triggered, never
   scheduled.
4. **Top-3-bets strategy object** — ONE simple strategy record per brand:
   up to 3 named bets (each linked to opportunities/evidence), a budget
   line, and a review cadence. Owner approves/revises it. No table zoo
   (explicit SIMPLIFY): one table, minimal lifecycle.
5. **Self-eval scorecard** — Sage grades its own past recommendations from
   REAL measured results (Phase 5 measurement join + Phase 3 outcomes):
   approved vs declined, measured wins/losses/inconclusive, cost per approved
   recommendation. Deterministic; shown to the owner as trust surface
   ("here's my track record — including my misses").

## 2. Exact approved Phase 6 scope

In scope: the five items above; their endpoints, UI, scheduler touches,
flags, tests. Explicitly **NOT** in Phase 6 (Phase 7, gated): Experiment
Engine, Industry Playbooks, cross-brand aggregates. Also not in scope:
AI narration on scorecards, macro-economy monitoring, Department
Collaboration architecture (post-Phase-6 program, per CEO direction
July 19, 2026).

## 3. Dependencies (verified in code)

- `analytics` (brand_id, week_date, total_spend, total_leads, cost_per_lead,
  conversions, return_on_ad_spend — UNIQUE per brand+week) — scorecard and
  forecast input.
- Phase 3 outcome fields on `leads` — outcome coverage feeds scorecard
  honesty labels and the self-eval scorecard.
- Phase 5 `sage_opportunities`, `sage_decisions`, `sage_directives`
  (measured_result) — self-eval input; bets link to opportunities.
- Phase 5 `changeDiagnostics` — reused for scorecard trend arrows.
- Phase 4 `brand_constraints` — budget line on the strategy object is
  clamped/validated against constraints at approval (clamp point carries
  forward).
- `sage_job_hashes` skip gates (Phase 2) — debate and any AI step must
  register input hashes; unchanged inputs = zero AI calls.

## 4. Database additions (one migration, `121_sage_v2_phase6.sql`, additive only)

- **`sage_channel_scorecards`** — cached deterministic snapshot per
  (brand_id, channel, week_start): metrics JSONB, computed_at,
  source_row_counts (honesty: how much data backed it). UNIQUE
  (brand_id, channel, week_start). Cache only — always recomputable;
  truncation-safe.
- **`sage_forecasts`** — (brand_id, metric, horizon_weeks, low, expected,
  high, basis JSONB {method, weeks_of_history, assumptions[]}, computed_at).
  CHECK: low ≤ expected ≤ high. A row is only written when
  weeks_of_history ≥ 8; otherwise the API answers
  `{ sufficient: false, weeks_needed }` — nothing stored, nothing invented.
- **`sage_strategies`** — the Top-3-bets object: brand_id, status
  (`draft → proposed → approved → superseded/archived` — CHECK-constrained,
  code-guarded transitions like Phase 5), bets JSONB (≤3, each
  {title, thesis, opportunity_ids[], success_metric}), budget_line JSONB,
  `options_considered` JSONB (Executive Debate output, written once),
  review_at, decided_at, owner note. Partial unique index: one
  proposed-or-approved strategy per brand.
- **`sage_strategy_bet_opportunities`** — junction (no uuid[] arrays, house
  rule W3) linking bets' cited opportunities → real `sage_opportunities`
  rows. "No evidence, no bet": chokepoint rejects a bet citing zero valid
  opportunities/intel items.
- **`sage_debates`** — one row per Executive Debate run: brand_id,
  strategy_id, trigger_event, options JSONB (≥3 incl. mandatory
  do-nothing), created_at. Debate cost guard enforced in code under the
  per-brand advisory lock: COUNT in current month ≥ 2 → refuse.
- **`sage_self_eval`** — cached per (brand_id, period): counts + cents
  aggregates from decisions/directives/outcomes; deterministic, recomputable.

## 5. Feature flags (all default OFF)

- `SAGE_V2_SCORECARDS` — scorecard compute + endpoints + UI card.
- `SAGE_V2_FORECASTS` — forecast compute + endpoints + UI.
- `SAGE_V2_STRATEGY` — Top-3-bets object + Executive Debate + endpoints + UI.
- `SAGE_V2_SELF_EVAL` — self-eval scorecard + endpoint + UI.

Dark behavior identical to Phase 5: endpoints answer `{ enabled: false }`,
client probes and hides surfaces entirely, scheduler branches no-op.

## 6. Flows

- **Scorecards/forecasts:** computed on read with a short cache
  (always-current views, NOT weekly reports — one-weekly-output rule W6
  preserved; the Monday briefing may reference them but they generate no
  new report).
- **Strategy:** owner opens Strategy card → if no active strategy, Sage
  drafts one from approved opportunities + Company Truth (AI, flag-gated,
  failure → 502, nothing fabricated) → Executive Debate stores
  options_considered → owner approves/revises → approved bets may issue
  directives through the EXISTING Phase 5 Directive Bus (all department
  controls and clamps still apply — approval remains separate from
  execution).
- **Debate triggers (event-only):** strategy draft/major revision; budget
  line change > 25%; quarterly review date. Never cron-scheduled.
- **Self-eval:** recomputed by the existing nightly maintenance job
  (extends `sage-opportunity-maintenance`; no new per-brand recurring AI
  job — W7 scale rule: zero new AI jobs, debate is event-driven).

## 7. Honesty & safety invariants (carried forward + new)

- Scorecards and self-eval are 100% deterministic; no AI writes numbers.
- Forecasts: ranges only, basis stored, insufficient-history is a first-class
  honest state. UI labels every forecast "Estimated range from your own
  history" (Phase 1 ROI-label convention).
- Debate options are stored verbatim and immutable — the owner always sees
  what was considered and why the recommendation won.
- Strategy budget line validated against `brand_constraints` at approval
  (clamp), and again at directive time (existing Phase 5 clamp point #2).
- Owner-only routes throughout; brand ownership via `getOwnedBrand`.
- Nothing executes autonomously: strategy approval issues directives at
  most; departments keep their own approval/execution controls.

## 8. API & UI (sketch)

Owner-only under `/api/sage`: `GET /scorecards`, `GET /forecasts`,
`GET /strategy`, `POST /strategy/generate`, `POST /strategy/:id/decide`,
`GET /self-eval`. Client: Scorecards + Strategy additions inside the
existing Sage section (new tabs/cards, probe-gated like Phase 5); executive
labels client-side only.

## 9. Testing strategy

Node:test suites per unit: scorecard arithmetic, forecast range math +
insufficient-history refusal, debate cost-guard atomicity, strategy status
transitions (invalid jumps rejected), bet-evidence chokepoint, self-eval
aggregation; vitest for label mapping + dark-tab hiding. All three
validation gates must stay green.

## 10. Risks and mitigations

- **Forecast misread as promise** → ranges + assumptions + "estimated"
  labels; no forecast below 8 weeks history.
- **Debate cost creep** → hard monthly cap in code, atomic under advisory
  lock; skip-gate hash on inputs.
- **Strategy vs opportunity confusion** → strategy is a container of ≤3 bets
  linked to existing opportunities; it introduces no second recommendation
  pipeline.
- **Self-eval vanity** → misses shown with the same weight as wins;
  inconclusive is its own honest bucket.

## 11. Recommendation

Approve this architecture as Phase 6 scope. Estimated shape: one migration,
four flags, ~4 server utils + controller + routes, two client surfaces,
no new recurring AI jobs. On approval, implementation proceeds under the
standard lifecycle with everything dark until your release decision.
