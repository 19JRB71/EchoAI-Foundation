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
