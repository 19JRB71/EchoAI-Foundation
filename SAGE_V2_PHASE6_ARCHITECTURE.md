# Sage V2 — Phase 6 Architecture Review (Milestone 6)

**Status: APPROVED by CEO July 19, 2026 — with one refinement (bet structure, §7): each
bet carries Objective, Expected timeframe, Primary KPI, Success threshold, and an
Automatic review date, forming the objective basis for self-evaluation and outcome
measurement.**
**Blueprint of record:** `SAGE_V2_CHALLENGE_REVIEW.md` Part 4 (revised phase plan).
**Gate check:** Phase 6 gates on Phases 3 and 5. Phase 3 (outcome capture,
approved July 17, 2026) and Phase 5 (opportunity queue, Directive Bus, Change
Diagnostics, approved July 19, 2026) are both implemented and approved.
**Gate satisfied.**

Approved lifecycle applies without exception: this Architecture Review → CEO
approval → Implementation → Testing → Architect self-review → Completion
report → CEO approval. All new behavior lands behind new feature flags,
default OFF, dark until you enable them. One additive-only migration. Fully
backward compatible. Every invariant from Phases 1–5 (honesty, owner-only
access, evidence-first, AI failure → 502, no fabrication, no silent
fallbacks) carries forward unchanged.

---

## 1. Executive summary

Phase 6 turns Sage from "recommends individual opportunities" into "holds a
coherent, explainable strategy with a public track record." Five
capabilities, exactly per the locked blueprint:

1. **Deterministic channel scorecards** — always-current per-channel views
   (spend, leads, cost/lead, conversions, ROAS, week-over-week trend)
   computed by pure arithmetic from the brand's own `analytics` and
   leads/outcome data. **No AI commentary in v1** — the blueprint explicitly
   removed it ("deterministic numbers first; narration adds cost, not
   information").
2. **Honest forecasts** — range forecasts (low / expected / high) computed
   deterministically from the brand's own history. Every forecast stores its
   method, the weeks of history behind it, and its assumption list. Below
   the minimum-history threshold Sage says "insufficient history" — it never
   invents a number.
3. **Executive Debate** — for *significant* strategy items only (budget
   allocation, channel mix, quarterly priorities — NOT every opportunity):
   one Claude call generates ≥3 realistic options with tradeoffs and risks,
   including a mandatory "do nothing" baseline. The full comparison is
   stored immutably on the strategy and shown to the owner. Cost guard:
   maximum 2 debates per brand per month, event-triggered, never scheduled.
4. **Top-3-bets strategy object** — ONE simple strategy record per brand: up
   to 3 named bets (each evidence-linked), a budget line, and a review
   cadence. The owner approves or revises it. No "table zoo" — the blueprint
   explicitly simplified this to one object.
5. **Self-evaluation scorecard** — Sage grades its own past recommendations
   from REAL measured results: approved vs declined, measured wins, misses,
   inconclusive, and cost per approved recommendation. Deterministic, shown
   to the owner as the trust surface: "here is my track record, including my
   misses."

## 2. Exact Phase 6 scope — included and excluded

**Included:** the five capabilities above; their database tables, endpoints,
UI surfaces, one scheduler extension, four feature flags, and full test
coverage.

**Explicitly excluded (and why):**

| Excluded item | Reason |
|---|---|
| Experiment Engine | Phase 7, hard-gated (coverage >50%, 6 months history, P6 adoption evidence) |
| Industry Playbooks | Phase 7, same gate; must come from real aggregates, never web research |
| Cross-brand aggregates / benchmarks | Phase 7+; premature below ~100 brands per industry |
| AI commentary on scorecards | Blueprint REMOVE — numbers first |
| New recurring per-brand AI jobs | Blueprint scale rule W7 — none allowed beyond the weekly synthesis |
| Full strategy lifecycle "table zoo" | Blueprint SIMPLIFY — one Top-3-bets object |
| Macro-economy monitoring | Blueprint REJECTED — stays rejected |
| Department Collaboration architecture | Post-Phase-6 program per CEO direction (July 19, 2026) — see §21 |

## 3. Dependencies from Phases 1–5 (verified in code)

- `analytics` table (brand_id, week_date, total_spend, total_leads,
  cost_per_lead, conversions, return_on_ad_spend; UNIQUE per brand+week) —
  scorecard and forecast input. No new data collection required.
- Phase 3 outcome fields on `leads` (measurement-only rule now lifts for
  this approved consumer) — outcome data feeds scorecard coverage labels and
  the self-eval scorecard.
- Phase 5 `sage_opportunities`, `sage_decisions`, `sage_directives`
  (`measured_result`) — self-eval input; strategy bets cite opportunities.
- Phase 5 Change Diagnostics — reused unchanged for scorecard trend
  decomposition (no duplicate "why" engine).
- Phase 4 `brand_constraints` — the strategy budget line is validated and
  clamped against constraints (see §9).
- Phase 4 Company Truth (approved version only) + Executive Memory — context
  for strategy drafting and debate prompts.
- Phase 2 `sage_job_hashes` skip gates — every AI step registers input
  hashes; unchanged inputs = zero AI calls.
- Phase 2 job-queue claim pattern + house advisory-lock pattern — debate cap
  and strategy generation claims are atomic.

## 4. Channel scorecard architecture

- **Inputs:** `analytics` weekly rows (per brand), lead counts and Phase 3
  outcomes per channel/source, active campaign state.
- **Computation:** pure arithmetic in a new `utils/channelScorecards.js` —
  per channel: spend, leads, cost/lead, conversions, ROAS, 4-week trailing
  averages, week-over-week deltas (delta terms reuse the Phase 5 Change
  Diagnostics decomposition — one "why" engine, not two).
- **Honesty labels baked into the data:** every scorecard carries
  `source_row_counts` (how many weeks/rows backed it) and the brand's
  outcome-coverage figure; thin data renders as "Limited data — based on N
  weeks," never as a confident number.
- **No AI anywhere in this path.** If a metric cannot be computed, the field
  is `null` with a reason code — never zero-filled (the null→0 fabrication
  trap is explicitly avoided, as in the quota monitor).
- **Delivery:** always-current views computed on read with a short-lived
  cache row (`sage_channel_scorecards`, recomputable at any time). They are
  NOT a new weekly report — the one-weekly-customer-output rule (W6) is
  preserved; the Monday briefing may reference them but generates nothing
  new.

## 5. Forecasting: method, minimum-history rules, assumptions storage

- **Method (deterministic, v1):** for each metric (leads, spend, cost/lead,
  conversions), compute the trailing trend from the brand's own weekly
  history (trailing mean with linear trend component) and the observed
  week-to-week variance. `expected` = trend projection; `low`/`high` =
  projection ± observed variance band. CHECK constraint: `low ≤ expected ≤
  high`. No AI generates or adjusts any number.
- **Minimum-history rule (hard):** forecasts require **≥ 8 weeks** of
  analytics history for the metric. Below that, the API answers
  `{ sufficient: false, weeks_available, weeks_needed }` and the UI shows an
  honest "Not enough history yet — Sage needs N more weeks" state. Nothing
  is stored, nothing is invented.
- **Assumptions storage:** every stored forecast row carries a `basis` JSONB:
  `{ method, weeks_of_history, variance_observed, assumptions: [ ... ] }`
  (e.g. "assumes spend stays near the trailing 4-week average," "does not
  model seasonality in v1"). The UI displays the assumptions with the range.
- **Labeling:** every forecast surface is labeled "Estimated range from your
  own history" — the Phase 1 ROI-label convention.
- **Recompute:** on read with cache, and refreshed when a new analytics week
  lands. Forecasts are never pushed as alerts; they are a view.

## 6. Executive Debate: flow, option rules, "do nothing" baseline

- **When it runs (event-only, never scheduled):**
  1. Sage drafts a new strategy (or a major revision).
  2. The strategy budget line changes by more than 25%.
  3. A quarterly review date arrives *and the owner opens the strategy*.
- **Option-generation rules (enforced in code after the AI call):** exactly
  one Claude call; the response must contain **≥ 3 options**, each with
  `{ title, description, tradeoffs, risks, expected_effect }`; **one option
  must be the "do nothing" baseline** with the honest cost of inaction.
  The chosen recommendation must reference which option it is and why it
  beat the alternatives. If validation fails (missing baseline, <3 options,
  empty fields) the result is rejected → 502 to the caller; nothing partial
  is stored. AI failure never fabricates a debate.
- **Storage & immutability:** the validated options array is written once to
  `sage_debates` and mirrored to the strategy's `options_considered` JSONB;
  application code never updates it afterward (write-once guard in the
  single write path). The owner always sees exactly what was considered.
- **Cost guard:** before any AI call, under the per-brand advisory lock,
  count this month's `sage_debates` rows; ≥ 2 → refuse with an honest
  "debate limit reached this month" response. Input-hash skip gate applies
  on top: identical inputs = no second call.

## 7. Top-3-bets strategy object

One record per brand in `sage_strategies`:

- **bets** — up to 3, each (CEO refinement, July 19, 2026):
  `{ title, thesis, objective, expected_timeframe, primary_kpi,
  success_threshold, review_date, opportunity_refs }` — objective = what the
  bet is trying to achieve in plain English; expected_timeframe = when
  results should show; primary_kpi = the ONE metric that judges it;
  success_threshold = the concrete pass/fail line on that KPI;
  review_date = automatic date when Sage re-examines the bet against its
  threshold (feeds self-eval win/miss classification). All five fields are
  REQUIRED — the write chokepoint rejects any bet missing one (refs resolved
  through the junction table, §8).
- **budget_line** — a single plain-English budget allocation statement plus
  structured per-channel amounts (integer cents, house rule).
- **options_considered** — the Executive Debate output (§6), write-once.
- **status** — `draft → proposed → approved → superseded | archived`,
  CHECK-constrained in the schema AND transition-guarded in code (the Phase
  5 lifecycle pattern: every UPDATE carries the expected prior status in its
  WHERE clause and branches on row count).
- **review_at / decided_at / owner_note** — cadence and decision record.
- A partial unique index allows at most one proposed-or-approved strategy
  per brand; a new approved strategy supersedes the old one atomically in a
  transaction (never two live strategies).

## 8. "No evidence, no bet" — code AND database enforcement

- **Database:** `sage_strategy_bet_opportunities` junction table (no uuid[]
  arrays — house rule) with FKs to `sage_strategies` and
  `sage_opportunities`. A bet's evidence is real rows, not free text.
- **Code (chokepoint):** strategy persistence goes through ONE function that,
  inside the write transaction, verifies every bet cites ≥1 opportunity or
  intel item that exists, belongs to the same brand, and is not expired or
  dismissed. Any bet failing the check rejects the whole strategy draft
  (aiInvalid → 502 when AI-drafted; 400 when owner-edited). This mirrors the
  Phase 5 evidence-first chokepoint exactly — the AI cannot talk its way
  past it, because enforcement happens after generation, at the write.

## 9. Strategy approval flow and Directive Bus handoff

1. Owner opens the Strategy card. If none exists, they may request a draft:
   Sage composes bets from existing approved opportunities + Company Truth +
   Executive Memory (AI, flag-gated; failure → 502; nothing fabricated).
2. Executive Debate runs (§6); options stored.
3. Strategy enters `proposed`. The owner **approves, revises, or declines**.
   Revisions re-validate evidence and constraints; a >25% budget change
   re-triggers debate (within the monthly cap).
4. **At approval:** the budget line is validated against Phase 4
   `brand_constraints` (clamp point 1 — violations block approval with a
   plain-English explanation, never silently altered).
5. **Handoff:** approved bets may issue directives **through the existing
   Phase 5 Directive Bus only** — same tables, same constraint clamp at
   directive time (clamp point 2), same department-side controls. Phase 6
   adds no new execution path.

## 10. Confirmation: approval remains separate from execution

Approving a strategy **executes nothing**. It records the owner's decision
and, at most, creates advisory directives on the existing bus. Every
receiving department (Atlas, Nova, etc.) retains its own approval and
execution controls, spend limits, and guardrails exactly as built in Phase 5
and before. No Phase 6 code spends money, publishes, or changes campaigns.
This is unchanged from the approved Phase 5 principle.

## 11. Sage self-evaluation scorecard

- **Inputs (all real, all existing):** `sage_decisions` (approved /
  declined / expired), `sage_directives.measured_result`, Phase 3 lead
  outcomes, and the AI-cost ledger (cost per approved recommendation — the
  efficiency metric the blueprint tracks from P5).
- **Computation:** deterministic aggregation in `utils/sageSelfEval.js`;
  cached per (brand, period) in `sage_self_eval`; recomputable at any time.
- **Presentation:** owner-facing card in the Sage section: recommendations
  made / approved / declined; of the approved-and-measured ones — wins,
  misses, inconclusive; measurement coverage; cost per approved
  recommendation. Misses render with the same visual weight as wins.

## 12. Wins, misses, inconclusive, and insufficient data — exact handling

| Result class | Definition (deterministic) | Displayed as |
|---|---|---|
| **Win** | Measured result met or beat the opportunity's stated success metric within its window | "Worked" |
| **Miss** | Measured result clearly fell short of the stated metric | "Didn't work" — never hidden or reworded |
| **Inconclusive** | Measured, but confounded (overlapping changes flagged by Change Diagnostics) or too small to attribute | "Inconclusive" — its own first-class bucket, never counted as a win |
| **Insufficient data** | Approved but no measurable outcome captured (coverage gap) | "Not yet measurable — N of M approved recommendations had trackable outcomes" |

The scorecard always states its denominator ("measured 4 of 7") — it never
computes a win rate over only the measurable subset without saying so.

## 13. Database migration plan (`121_sage_v2_phase6.sql`, additive only)

Six new tables, idempotent (`IF NOT EXISTS`), no changes to existing tables:

1. `sage_channel_scorecards` — cache: brand_id, channel, week_start, metrics
   JSONB, source_row_counts JSONB, computed_at; UNIQUE (brand, channel,
   week_start).
2. `sage_forecasts` — brand_id, metric, horizon_weeks, low, expected, high,
   basis JSONB, computed_at; CHECK (low ≤ expected AND expected ≤ high).
3. `sage_strategies` — §7 columns; CHECK-constrained status; partial unique
   index on live status per brand.
4. `sage_strategy_bet_opportunities` — junction with FKs (§8).
5. `sage_debates` — brand_id, strategy_id, trigger_event, options JSONB,
   created_at; index on (brand_id, created_at) for the monthly-cap count.
6. `sage_self_eval` — brand_id, period, aggregates JSONB (integer counts,
   cents), computed_at; UNIQUE (brand, period).

Rollback-safe: all tables are new; dropping them (or leaving them dark)
affects nothing existing. Runner: existing `utils/runMigrations.js`,
per-file transaction.

## 14. New APIs, services, schedulers, and UI changes

**Server (owner-only, `auth → lockoutCheck → owner guard`, flag-gated):**
- `GET /api/sage/scorecards?brandId=` — computed scorecards + honesty labels.
- `GET /api/sage/forecasts?brandId=` — ranges or `{ sufficient: false }`.
- `GET /api/sage/strategy?brandId=` — current strategy + options_considered.
- `POST /api/sage/strategy/generate` — draft (AI; 502 on failure).
- `POST /api/sage/strategy/:id/decide` — approve / revise / decline
  (atomic status-guarded transitions).
- `GET /api/sage/self-eval?brandId=` — the scorecard.

**New utils:** `channelScorecards.js`, `sageForecasts.js`,
`sageStrategy.js` (draft + debate + evidence chokepoint),
`sageSelfEval.js`. One controller + route additions to the existing Sage
route group.

**Scheduler:** NO new jobs. The existing nightly `sage-opportunity-
maintenance` job gets a flag-gated branch to refresh self-eval caches
(deterministic SQL only, no AI). Debate is event-driven from owner actions.

**Client (`sections/Sage.jsx` + subcomponents):** two new probe-gated
surfaces inside the existing Sage section — "Channels & Forecasts"
(scorecard grid + forecast ranges + honest empty states) and "Strategy"
(Top-3 bets, debate options viewer, approve/revise controls, self-eval
scorecard). Executive labels remain a pure client mapping. Hidden entirely
when flags are dark. Client rebuild + sw.js cache bump on ship.

## 15. Feature flags and flags-off behavior (all default OFF)

- `SAGE_V2_SCORECARDS` — scorecards compute + endpoint + UI.
- `SAGE_V2_FORECASTS` — forecasts compute + endpoint + UI.
- `SAGE_V2_STRATEGY` — strategy object + debate + endpoints + UI.
- `SAGE_V2_SELF_EVAL` — self-eval + endpoint + UI.

Flags-off behavior identical to Phase 5's verified dark pattern: endpoints
answer `{ enabled: false }` (no schema hints, byte-identical dark
responses), the client probe hides every surface, the scheduler branch
no-ops, zero AI calls, zero writes. Resolution order: DB override → env →
default, per the existing flag helper.

## 16. Privacy, ownership, and access controls

- Every route is owner-only for the brand (existing owner-guard pattern) and
  brand-scoped via `getOwnedBrand(userId, brandId)` — 404 on foreign brands;
  all mutations join to `brands` on `user_id`.
- All data is per-brand from the brand's own history. No cross-brand reads
  anywhere in Phase 6.
- Sensitive-flagged intel items (Phase 2 redaction rules) keep their
  owner-only visibility when cited as bet evidence.
- Demo brands (`is_demo`) are excluded at the data-gathering layer from all
  scorecard/forecast/self-eval computation, per the standing rule.
- No new PII is collected or stored; debate prompts use the same redacted
  context layers as existing Sage AI calls.

## 17. Explainability and audit trail

- **Scorecards:** every number is arithmetic over rows the owner can see;
  `source_row_counts` shows exactly how much data backed it.
- **Forecasts:** basis + assumptions stored and displayed; the owner can see
  *why* the range is what it is.
- **Debate:** the full option set — including the rejected options and the
  do-nothing baseline — is stored immutably and permanently visible. This is
  the direct answer to "why this, what else was considered, what's the risk,
  what does doing nothing cost."
- **Strategy:** every status change records who decided and when
  (`decided_at`, owner note); bets link to their evidence rows; superseded
  strategies are kept, never deleted.
- **Self-eval:** the audit trail *of Sage itself* — decisions, results, and
  costs traceable to the underlying decision/directive/outcome rows.

## 18. Testing and rollback plan

**Testing (all three validation gates must stay green):**
- node:test — scorecard arithmetic incl. null-not-zero handling; forecast
  math, band ordering, and the 8-week refusal; debate validation (missing
  baseline rejected, <3 options rejected, monthly cap atomic under
  concurrent calls); strategy status transitions (invalid jumps rejected via
  row-count branching); evidence chokepoint (foreign/expired/dismissed
  citations rejected); self-eval aggregation incl. denominators and
  inconclusive bucketing; flags-dark byte-identical responses.
- vitest — dark surfaces fully hidden; honest empty/insufficient states
  render; label mapping.
- Standard AI mocking pattern; no test calls real AI.

**Rollback:** flags OFF restores current behavior instantly (dark = today's
production behavior, verified byte-identical). Migration is additive-only;
tables can sit empty indefinitely or be dropped without touching any
existing feature. Each milestone remains a release candidate and a rollback
point, per the standing rule.

## 19. Scale and AI-cost safeguards

- **Zero new recurring AI jobs** (blueprint rule W7). The only new AI calls
  are strategy drafting and debate — both owner-initiated events.
- Debate hard cap: 2/brand/month, enforced atomically; drafts also pass the
  input-hash skip gate (unchanged inputs = no call).
- Scorecards, forecasts, and self-eval are pure SQL + arithmetic —
  negligible cost at any brand count; caches keep reads cheap.
- All AI calls go through the existing `createMessage` wrapper (timeout,
  transient-only retry, 502 mapping) and the AI-cost ledger.

## 20. Architectural conflicts or deviations from the locked blueprint

**One deviation to flag (report-before-change rule):** the blueprint's
Phase 3 standing rule says outcomes are "measurement-only — no
recommendation, strategy, or learning behavior may consume them until the
approved later phase." **Phase 6 is that approved later phase** for two
consumers: scorecard outcome-coverage labels and the self-eval scorecard
(both read-only aggregation; still no recommendation *generation* consumes
outcomes). Approving this document approves that planned lift. No other
conflicts identified: no existing table changes, no department boundary
changes (Atlas keeps execution-time optimization), one-weekly-output rule
preserved.

## 21. Scope confirmations

- **No Phase 7 functionality is included.** No Experiment Engine, no
  Playbooks, no cross-brand aggregates; the Phase 7 gate (coverage >50%,
  6 months history, Phase 6 adoption evidence) stands.
- **Department Collaboration remains post-Phase 6**, per CEO direction of
  July 19, 2026. Nothing in this phase begins that architecture; the
  Directive Bus handoff reuses only what Phase 5 already built.

## 22. Final implementation-readiness recommendation

The architecture is implementation-ready: gates satisfied, all inputs exist
in production schema today, no new data collection, no new recurring AI
jobs, one additive migration, four dark flags, and every honesty and safety
invariant carried forward with specific enforcement points named. Estimated
shape: one migration, four utils, one controller extension, six endpoints,
two client surfaces, ~no scheduler risk.

**Recommendation: approve this architecture as the locked Phase 6 scope.**
On your approval, implementation proceeds under the standard lifecycle —
everything stays dark behind flags until your release decision.

---

## 23. As-built notes (July 19, 2026)

Implemented exactly per the locked scope, with these clarifications:

- **Migration**: `EchoAI/models/121_sage_v2_phase6.sql` — 6 tables + 4 flags
  (all default OFF). Dark endpoints answer `{ enabled: false }`.
- **CEO refinement enforced**: every bet requires `objective`,
  `expected_timeframe`, `primary_kpi`, `success_threshold`, `review_date`;
  the validator + evidence chokepoint reject drafts and revisions missing any.
- **Draft concurrency (hardened post-review)**: the live-strategy check and
  monthly debate cap both run under the per-brand advisory lock BEFORE the AI
  call; the check is repeated under the lock inside the write transaction
  (the AI call runs unlocked), and a unique-index collision is mapped to the
  same honest 409 `live_strategy_exists` — never a raw 500, never wasted spend
  persisted.
- **Honesty fix found by tests**: `channelScorecards` originally fabricated a
  0 for NULL numerics (`Number(null) === 0`); now null-guarded — missing data
  reports as null with a reason.
- **Client**: two probe-gated tabs in `Sage.jsx` — Channels & Forecasts
  (honest empty states, "won't guess" forecast messaging, demo-excluded
  notice) and Strategy (Top-3 bets, debate viewer, approve / revise inline
  editor / decline, self-eval scorecard with stated denominators).
- **Validation**: server 909/909, Phase 6 suite 29/29, client 372/372,
  client build clean. Architect review findings (field-binding mismatches,
  missing revise UI, draft race) all fixed.
