# Sage V2 Phase 6 — Completion Report (Final, for CEO Approval)

**Date:** July 19, 2026
**Built against:** `SAGE_V2_PHASE6_ARCHITECTURE.md` (approved July 19, 2026,
including your bet-structure refinement)
**Status:** Implemented, fully tested, architect-reviewed with all findings
fixed. **All four Phase 6 flags are OFF.** Nothing is visible to any customer
until you approve release.

---

## 1. Exact functionality implemented

Four capabilities, each behind its own independent flag:

1. **Channel Scorecards** — deterministic weekly per-channel performance
   scorecards computed from the brand's own analytics and lead history. No AI
   anywhere in this path.
2. **Honest Forecasts** — deterministic range forecasts (low / expected /
   high) for leads, spend, cost-per-lead, and conversions, computed only from
   the brand's own weekly history. No AI generates or adjusts any number.
3. **Top-3 Bets Strategy + Executive Debate** — owner-initiated (never
   scheduled) AI strategy drafting: one Claude call produces a debate of
   options plus up to 3 evidence-backed bets; everything is re-validated in
   code after generation. Owner approves, revises, or declines.
4. **Self-Evaluation Scorecard** — deterministic aggregation of Sage's own
   track record (wins, misses, inconclusive, cost per approved
   recommendation), denominators always stated.

## 2. Files created and modified

**New files**
- `EchoAI/models/121_sage_v2_phase6.sql` — migration (131 lines)
- `EchoAI/utils/channelScorecards.js` (210 lines)
- `EchoAI/utils/sageForecasts.js` (131 lines)
- `EchoAI/utils/sageSelfEval.js` (143 lines)
- `EchoAI/utils/sageStrategy.js` (616 lines)
- `EchoAI/prompts/strategyDraftPrompt.js` (79 lines)
- `EchoAI/controllers/sagePhase6Controller.js` (155 lines)
- `EchoAI/tests/sageV2Phase6.test.js` (546 lines, 29 tests)

**Modified files**
- `EchoAI/config/aiControls.js` — the 4 new flags registered (default OFF)
- `EchoAI/routes/sageRoutes.js` — 6 new owner-only routes
- `EchoAI/utils/scheduler.js` — 8 lines added to the existing nightly Sage
  maintenance job (self-eval cache refresh; SQL only; no-op while dark)
- `EchoAI/client/src/api.js` — 5 new API client methods
- `EchoAI/client/src/sections/Sage.jsx` — two new probe-gated tabs (+563 lines)
- `EchoAI/client/public/sw.js` — service-worker cache bumped to v139
- `EchoAI/client/dist/*` — rebuilt production bundle

## 3. Migration 121 — database changes (additive only)

Six new tables; nothing existing altered or dropped:

- **`sage_channel_scorecards`** — cache of computed scorecards; unique per
  (brand, channel, week); `metrics` JSONB carries values *or null + reason
  code*; `source_row_counts` states what data backed it.
- **`sage_forecasts`** — stored forecasts; DB CHECK constraints enforce
  `low ≤ expected ≤ high` and restrict metrics to the four allowed; unique
  per (brand, metric, horizon).
- **`sage_strategies`** — the strategy object: `bets` JSONB, optional
  `budget_line`, write-once `options_considered` (the debate),
  status CHECK (`draft/proposed/approved/declined/superseded/archived`),
  origin CHECK (`ai_draft/owner_revision`), `review_at`, `superseded_by`
  self-reference. **Partial unique index `uniq_sage_strategies_live`
  guarantees at most ONE proposed-or-approved strategy per brand at the
  database level.**
- **`sage_strategy_bet_opportunities`** — junction table binding every bet
  (index 0–2, CHECK-constrained) to real `sage_opportunities` rows with
  `ON DELETE RESTRICT` — evidence rows cannot be deleted out from under a
  bet. This is "no evidence, no bet" expressed as a foreign-key relationship,
  not just code. (House rule honored: junction table, no uuid[] arrays.)
- **`sage_debates`** — immutable debate records; `trigger_event`
  CHECK-constrained to `new_strategy / budget_change / quarterly_review`.
- **`sage_self_eval`** — self-evaluation cache, unique per (brand, period).

Plus the house `updated_at` trigger on `sage_strategies` (the only table that
mutates in place).

## 4. Feature flags and flags-off behavior

| Flag | Gates |
|---|---|
| `SAGE_V2_SCORECARDS` | Channel scorecards endpoint + tab |
| `SAGE_V2_FORECASTS` | Forecasts endpoint + tab section |
| `SAGE_V2_STRATEGY` | Strategy read/generate/decide endpoints + Strategy tab |
| `SAGE_V2_SELF_EVAL` | Self-eval endpoint + card + nightly cache refresh |

All four default **OFF**. While dark: every endpoint answers exactly
`{ "enabled": false }` (byte-identical dark responses — confirmed by test);
the client probes and hides both tabs entirely; the scheduler branch no-ops;
the six new tables stay dormant. **Confirmed: all four flags are OFF right
now** — dev preview verified, and the flags ship OFF in the migration.

## 5. Channel scorecards — calculations and null-not-zero safeguards

- **"All channels" card** from the brand's `analytics` weekly rows: current
  week spend / leads / cost-per-lead / conversions / ROAS, 4-week trailing
  averages, and week-over-week deltas that reuse the Phase 5 Change
  Diagnostics decomposition (one "why" engine, not two).
- **Per-channel cards** from `leads.first_touch` over 60 days: leads last
  30d vs prior 30d, and Phase 3 outcomes (won / lost / measured).
- **Null-not-zero safeguards:**
  - A single `num()` guard converts `null`/`undefined`/`''` to `null` before
    any arithmetic — this is the fix for the `Number(null) === 0` bug (§20).
  - `analytics` has no per-channel spend, so per-channel spend and
    cost-per-lead are **honestly null with reason
    `no_per_channel_spend_data`** — nothing apportioned or invented.
  - No analytics history at all → `{ unavailable: true, reason:
    "no_analytics_history" }`, never a zero-filled card.
  - Missing cost-per-lead / ROAS carry explicit reason codes.
  - Every card stores `source_row_counts` so the owner can see what backed it.
- Cached 60 minutes per (brand, channel, week); recomputable at any time.
  Not a new weekly report (the W6 gate is preserved).

## 6. Forecasts — method, minimum history, ranges, stored assumptions

- **Method** `trailing_linear_trend_v1`: least-squares linear trend over up
  to 26 weeks of the brand's own weekly history; expected value = projection
  to the midpoint of the next 4 weeks; the band (low/high) = the observed
  standard deviation of residuals around the brand's own trend.
- **Minimum-history rule enforced:** fewer than **8 weekly data points** for
  a metric → the response is `{ sufficient: false, weeks_available,
  weeks_needed: 8 }` — **nothing stored, nothing invented** (test-verified).
- Non-negative metrics clamp `low` at zero (a declining series can never
  forecast negative leads); `low ≤ expected ≤ high` is enforced both in code
  and by the DB CHECK.
- **Stored assumptions:** every persisted forecast carries `basis` JSONB —
  method, weeks of history, observed variance, and plain-English assumptions
  ("Assumes recent weekly trend continues; no seasonality modeled in v1",
  etc.). The UI labels every range **"Estimated range from your own
  history"** (Phase 1 ROI-label convention).

## 7. Executive Debate

- **Generation:** produced in the same single Claude call as the strategy
  draft (one call, not two). Validated in code afterward:
  - **≥ 3 options**, each with title, description, tradeoffs, risks, and
    expected effect — all non-empty;
  - **exactly one "do nothing" baseline option is mandatory** (zero or two
    baselines both reject the draft);
  - the chosen option must match a real option, with a stated reason.
  Any failure → the entire draft is rejected (502), nothing partial stored.
- **Immutable storage:** the debate is written once to `sage_debates` and
  copied into the strategy's `options_considered` at insert; there is no
  code path that updates either afterward (single write chokepoint).
- **Monthly cap:** maximum **2 debates per brand per month**, counted under
  the per-brand advisory lock **before** any AI call — the refusal is cheap
  and honest ("Sage runs at most 2 executive debates per brand per month to
  keep costs honest").
- **Event triggers:** `new_strategy` (owner requests a draft),
  `quarterly_review` (owner-initiated), and `budget_change` (reserved in the
  schema for the >25% budget-change re-debate; the enum and cap logic are in
  place). All triggers are owner-initiated — none are scheduled.

## 8. Top-3 Bets strategy object

Up to 3 bets; each bet is **rejected at the write chokepoint unless it
carries all of** (your refinement, enforced field-by-field — a test proves
each field is individually required):

- **Objective** — what the bet is trying to achieve
- **Expected timeframe** — how long before results should show
- **Primary KPI** — the one number that judges it
- **Success threshold** — the specific value that counts as success
- **Review date** — a valid `YYYY-MM-DD` date; the **earliest bet review
  date automatically becomes the strategy's `review_at`**

plus title, thesis, and at least one evidence reference.

**"No evidence, no bet" — enforced twice:**
- **In code:** the evidence chokepoint runs *inside the write transaction*
  and verifies every cited opportunity exists, belongs to the same brand,
  and is not expired/declined/archived. One bad reference rejects the entire
  draft (502 if AI-drafted, 400 if owner-edited). Enforcement happens after
  generation, at the write — the AI cannot talk its way past it.
- **In the database:** the `sage_strategy_bet_opportunities` junction table
  makes each bet→evidence link a real foreign key with `ON DELETE RESTRICT`.

## 9. Strategy lifecycle and controlled status transitions

`proposed → approved | declined | superseded`; every transition is a
row-count-branched UPDATE whose WHERE clause carries the prior status — a
strategy that was already decided cannot be decided again (honest
`invalid_transition` refusal, test-verified). The DB partial unique index
guarantees at most one live strategy per brand no matter what the code does
(also test-verified by direct SQL).

## 10. Revision flow

Owner edits bets (and optionally the budget line) in an inline editor. The
revision is re-validated exactly like an AI draft — all five required fields
per bet, evidence chokepoint, budget shape — but failures return 400 (owner
error), not 502. In one transaction under the brand advisory lock: the old
strategy flips to `superseded` (status-guarded), a new `proposed` row with
`origin='owner_revision'` is inserted, `superseded_by` links them, junction
rows are rewritten, and the original debate is carried over unchanged
(write-once — the debate records what was considered at drafting time).

## 11. Constraint validation and Directive Bus handoff

- **At approval (clamp point 1):** the budget line total is checked against
  Phase 4 `brand_constraints.monthly_budget_cents`. A violation **blocks
  approval with HTTP 422 and a plain-English explanation** ("…exceeds your
  stated monthly budget limit… Sage never silently changes your numbers").
  Nothing is silently altered.
- **Directive Bus:** Phase 6 adds **no new execution path**. Approved bets
  may only ever issue directives through the existing Phase 5 Directive Bus
  (same tables, same constraint clamp at directive time, same
  department-side controls). Phase 6 code itself emits no directives.

## 12. Confirmation: approval executes nothing

Approving a strategy records your decision (status, timestamp, optional
note) — **and does nothing else**. No Phase 6 code spends money, publishes,
creates campaigns, or changes anything. Every receiving department retains
its own approvals, spend limits, and guardrails exactly as built in Phase 5
and before.

## 13. Self-evaluation scorecard

Deterministic SQL over real rows only (`sage_opportunities` terminal
statuses, `sage_decisions`, the AI-cost ledger):

- **Wins** = opportunities measured `succeeded`; **misses** = `failed`;
- **Inconclusive is its own first-class bucket — never counted as a win**
  (test-verified);
- **Insufficient data reports as insufficient, never as zero wins**: cost
  with no ledger rows → `null` with reason `no_cost_ledger_rows`; no
  approved recommendations → `null` with reason
  `no_approved_recommendations_yet` (test-verified);
- **Denominators always stated:** `measured_of_approved: { measured: N,
  of: M }` plus a `not_yet_measurable` count — the win rate is never quoted
  over only the measurable subset without saying so.
- Periods: 90 days (default) and all-time. Cached per (brand, period).

## 14. APIs and UI surfaces added

**Six endpoints**, all mounted under `/api/sage`, all `auth + requireOwner`,
all flag-gated, all ownership-checked via `getOwnedBrand` (404 on foreign
brands), demo brands excluded with an honest `demoExcluded` marker:

| Endpoint | Purpose |
|---|---|
| `GET /scorecards` | channel scorecards |
| `GET /forecasts` | range forecasts |
| `GET /strategy` | live strategy + debates remaining this month |
| `POST /strategy/generate` | owner-initiated draft (201) |
| `POST /strategy/:id/decide` | approve / decline / revise |
| `GET /self-eval` | self-evaluation scorecard |

**Two client tabs** inside the Sage section (probe-gated — invisible while
flags are dark): **Channels & Forecasts** (honest empty states, reason-code
labels, "Estimated range from your own history", demo-exclusion notice) and
**Strategy** (Top-3 bets with all five required fields displayed, debate
viewer including the do-nothing baseline, approve / inline revise editor /
decline, debates-remaining counter, self-eval card with stated denominators).

## 15. Scheduler changes — no new recurring AI jobs

**Zero new scheduled jobs and zero new recurring AI work.** The only change
is 8 lines inside the *existing* nightly Sage opportunity-maintenance job:
a self-eval **cache refresh** that is deterministic SQL only, skips demo
brands, no-ops entirely while `SAGE_V2_SELF_EVAL` is dark, and is
error-guarded per the sweep-guard rule. Strategy drafting is owner-initiated
only — it can never run on a schedule.

## 16. AI-cost controls

- Exactly **one** Claude call per strategy draft (debate + bets together).
- **Pre-AI refusals** (no tokens spent): live strategy exists; monthly
  debate cap reached (2/brand/month, counted under the advisory lock); no
  live evidence; inputs unchanged since the last draft (input-hash skip
  gate: "a new draft would reach the same conclusion").
- Scorecards, forecasts, and self-eval use **no AI at all**.
- Every AI call goes through the standard `createMessage` wrapper (ledger,
  timeout 120s, 502 mapping) with feature tag `sage_strategy_draft`.
- Sage may itself return `insufficient: true` and decline to force a
  strategy — surfaced honestly as a refusal, and the input hash is recorded
  so the same inputs don't trigger a paid retry.

## 17. Tests, build, and server status

- **29 new Phase 6 tests** in `tests/sageV2Phase6.test.js` covering: dark-flag
  responses; scorecard null-not-zero rules (four tests); forecast
  minimum-history refusal, band ordering, and zero clamping; debate
  validation (five tests incl. the mandatory baseline); per-field bet
  requirement enforcement; budget-cents validation; evidence chokepoint;
  status transitions; constraint-violation blocking; revision flow; the DB
  one-live-strategy guarantee (direct SQL); and self-eval honesty rules.
- **Final totals: server 909/909 pass · client 372/372 pass · client build
  clean** (all three registered validation gates passed at completion).
- Dev server running clean; the new routes are mounted and auth-gated
  (verified by live smoke check).

## 18. The `Number(null) === 0` issue

Found **by the Phase 6 tests during implementation**: JavaScript's
`Number(null)` is `0`, so a week with no reported cost-per-lead would have
been displayed as $0 — a fabricated zero. Fixed with a single `num()` guard
in `channelScorecards.js` that maps `null`/`undefined`/`''` to `null` before
any arithmetic; every metric read goes through it. **Regression protection:**
two dedicated tests pin the behavior ("missing cost_per_lead stays null with
a reason code", "no analytics history is reported, never zero-filled"), plus
the self-eval null-cost test — any future regression fails the suite.

## 19. Architect review — findings and exact fixes

An independent architect review (with full diff) returned three findings;
all were fixed and re-verified:

1. **Client field-binding mismatches** — the new tabs bound three fields
   that didn't match the API contract. Fixed to the literal server names:
   `metrics.outcomes.won`, `source_row_counts.leads_60d`,
   `aggregates.recommendations_proposed`.
2. **Revise flow missing from the UI** — the backend supported revision but
   the Strategy tab only offered approve/decline. Fixed: full inline bet
   editor (all five required fields + evidence refs + budget line), wired to
   the decide endpoint with `action: "revise"`, state reset on brand change.
3. **Strategy-draft race condition** — the live-strategy check originally
   ran only at insert time. Fixed as described in §20.

## 20. Concurrency and race-condition protections

- **Strategy drafting:** the live-strategy check and the monthly debate cap
  run under the per-brand advisory lock **before** the AI call (two racing
  drafts serialize; the loser refuses cheaply without paying for AI). Because
  the AI call itself runs outside the lock (~up to 2 minutes), the
  live-strategy check is **repeated under the lock inside the write
  transaction**; and if a concurrent draft still slips in, the DB unique
  index rejects it and the error is mapped to the same honest 409
  ("Another strategy draft finished first") — never a raw 500, never a
  partial write.
- **One live strategy per brand** is a database-level guarantee (partial
  unique index), independent of application code.
- **Revision** runs in one transaction under the advisory lock with
  `SELECT … FOR UPDATE` on the old row and a status-guarded supersede.
- **All decisions** (approve/decline) are row-count-branched atomic UPDATEs.
- **Cache writes** (scorecards, forecasts, self-eval) use `ON CONFLICT`
  upserts — concurrent reads can never duplicate rows.

## 21. Architectural deviations

None of substance. Implemented as approved, with two recorded clarifications:
(a) the bet-requirement fields are enforced at the code chokepoint rather
than as DB CHECKs because they live inside JSONB (anticipated in the
architecture); (b) the `budget_change` debate trigger exists in the schema
and cap logic, with the >25%-budget-change auto-re-debate wiring deferred to
when the flag goes live (the revise path currently carries the budget line
forward and re-validates it at approval).

## 22. Known limitations (stated honestly)

- Forecasts model a linear trend only — **no seasonality in v1** (stated in
  every forecast's stored assumptions).
- Per-channel spend/cost-per-lead are null by design: the analytics source
  has no per-channel spend dimension. Sage says so rather than apportioning.
- Self-eval depends on Phase 3 outcome coverage — brands that don't record
  lead outcomes will honestly show low "measured of approved" counts.
- Strategy quality depends on the live opportunity queue; an empty queue
  refuses with "no evidence, no bet" rather than inventing bets.

## 23. Confirmations

- ✅ **All four Phase 6 flags are OFF.** Nothing customer-visible changes
  until you flip them (recommended order: scorecards → forecasts →
  self-eval → strategy).
- ✅ **No Phase 7 work and no Department Collaboration work was started.**
  Nothing in this phase begins that architecture; the Directive Bus
  reference reuses only what Phase 5 already built. No further Sage work
  will begin until this report is reviewed and Phase 6 receives your final
  approval.

## 24. Final readiness recommendation

Phase 6 is complete, dark, and safe: additive-only migration, byte-identical
dark responses, zero new recurring AI jobs, hard cost caps, every honesty
invariant enforced at chokepoints the AI cannot bypass, database-level
backstops on the two riskiest invariants (one live strategy; evidence
foreign keys), and full test/build/review verification.

**Recommendation: approve Phase 6 as complete.** Release remains entirely
your call — flip the flags per brand or globally whenever you decide.
