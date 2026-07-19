---
name: Sage V2 Phase 6 strategy layer
description: Draft-concurrency, honesty, and client-contract lessons from the Top-3-bets strategy + debate + scorecards phase.
---

- **AI-call race window**: a pre-AI advisory-lock check is not enough when the AI call itself runs unlocked (~2 min). Repeat the "does a live row already exist" check under the same lock inside the write transaction, AND map the unique-index 23505 backstop to the same honest 409 refusal — never a raw 500.
  - **Why:** two racing drafts both passed the precheck, both paid for AI, one crashed at insert.
  - **How to apply:** any expensive-generate-then-insert-singleton flow (one live strategy/report per brand).
- **Client field-binding drift**: new API surfaces built in the same session still shipped with 3 wrong field names (`metrics.won` vs `metrics.outcomes.won`, `leads_30d` vs `leads_60d`, `proposed` vs `recommendations_proposed`). Grep the server response-shaping code and bind against it literally before writing JSX; architect review caught these, tests did not (tabs had no client tests).
- **Number(null) === 0** fabricates zeroes — null-guard every numeric coercion in honesty-critical scorecards.
- Revise flow = supersede old row + insert new `origin='owner_revision'` proposed row under the brand advisory lock; client sends full bets (with opportunity_ids) back.
