---
name: EchoAI Stripe seat-item sync
description: Every Stripe subscription mutation must resync the per-seat add-on line item, including initial creation.
---

# EchoAI seat-item sync invariant

EchoAI bills seats beyond a tier's included count as a single extra Stripe
line item ($50/seat). The helper that reconciles that item from
`users.team_size` must be called on **every** path that creates or changes a
subscription — not only the explicit "update team size" endpoint.

**The rule:** any place that creates or swaps a Stripe subscription
(create, upgrade/change, team-size update, applying a deferred downgrade) must
resync the seat line item afterward, or the customer is mis-billed until the
next seat edit.

**Why:** subscription creation originally only added the base tier price and
skipped the seat sync, so a user who signed up with `team_size` already above
the included count was undercharged for the whole first cycle. Caught in the
Prompt 39 architect review.

**How to apply:** when adding a new code path that touches the Stripe
subscription, call the seat-sync helper after the mutation. The helper no-ops
gracefully when the seat price id env var is unset, so the call is always safe.

## Every tier includes exactly 1 seat (no more Enterprise-unlimited)

As of the Prompt 65 pricing change, all three sellable tiers include exactly
**1** seat; extra seats are $50/seat/mo on **every** tier (Starter,
Professional, Enterprise). `config/plans.js` and client `lib/tiers.js`
PLAN_META set `includedSeats: 1` for all three.

**Why:** Enterprise used to be "unlimited seats" via `includedSeats: null`,
which several call sites branched on to *exempt* Enterprise from seat charges
(TeamManagement seat-confirm dialog, `syncSeatItem`/`additionalSeats`). Setting
it to 1 makes Enterprise bill add-on seats through the same path as the other
tiers — no special-casing.

**How to apply:** `includedSeats == null` no longer maps to any real tier; treat
it only as a defensive skip (effectively just the platform admin). Do NOT
re-introduce "Enterprise = unlimited/free seats" copy or logic anywhere
(onboarding StepSubscription, landing pricing table, TeamManagement comments).
