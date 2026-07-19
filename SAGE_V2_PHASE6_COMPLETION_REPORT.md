# Sage V2 Phase 6 — Completion Report

**Date:** July 19, 2026
**Status:** Implemented, tested, architect-reviewed, awaiting CEO approval.
**All 4 feature flags are OFF.** Nothing changes for any customer until you flip them.

## What was built (per the approved architecture, including your refinement)

1. **Channel Scorecards** (`SAGE_V2_SCORECARDS`) — deterministic weekly per-channel
   scorecards from your customers' own analytics and lead history. No AI. Any metric
   Sage can't measure is shown with an honest label ("No per-channel spend data") —
   never a fabricated zero. A real fabrication bug (`Number(null) === 0`) was found
   by the tests and fixed.
2. **Forecasts** (`SAGE_V2_FORECASTS`) — ranges ("Estimated range from your own
   history") computed only from the brand's real history. Not enough weeks of data →
   Sage says so and refuses to guess.
3. **Top-3 Bets Strategy + Executive Debate** (`SAGE_V2_STRATEGY`) — owner-initiated
   only (never scheduled). One live strategy per brand. Pre-AI refusals: live strategy
   exists, monthly debate cap (2), no evidence, unchanged inputs. **Your refinement is
   enforced at the chokepoint:** every bet must carry an objective, expected timeframe,
   primary KPI, success threshold, and review date — drafts and revisions missing any
   are rejected. Approval executes nothing by itself; budget violations block approval
   with a plain-English explanation. Owner can Approve, Revise (inline editor), or
   Decline. Revise supersedes the old strategy and creates a new proposed one marked
   as your revision.
4. **Self-Evaluation Scorecard** (`SAGE_V2_SELF_EVAL`) — Sage's own track record,
   including misses, with denominators stated ("measured N of M approved").

## Client

Two new probe-gated tabs inside Sage: **Channels & Forecasts** and **Strategy**
(bets, debate viewer, approve/revise/decline, self-eval card). Demo brands see an
honest exclusion notice. Flags off → tabs don't appear at all.

## Verification

- Server tests: **909/909 pass** (29 new Phase 6 tests).
- Client tests: **372/372 pass**; client build clean; service-worker cache bumped.
- Architect review: performed; all three findings fixed —
  1. client field bindings corrected to match the API contract,
  2. Revise flow added to the Strategy tab,
  3. strategy-draft race hardened (live-strategy check under the advisory lock
     before AND after the AI call, unique-index collision mapped to an honest 409).

## Release control

Flip flags per brand or globally when you decide. Recommended order:
scorecards → forecasts → self-eval → strategy.
