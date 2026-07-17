---
name: EchoAI skip gates scope
description: Input-hash skip gates may suppress only AI/aggregation COST, never customer-visible deliverables.
---

Rule: a skip gate (unchanged-input hash → skip the recurring AI job) may suppress
only the expensive work (AI calls, external re-fetch, re-aggregation). Any
owner/customer-facing obligation attached to the run (weekly report email, push,
webhook) must still fire — on skip, reuse the latest stored result (e.g.
`latestStoredAnalytics`) so the deliverable goes out built from still-accurate data.

**Why:** the first wiring of `gateJob("weekly-analytics")` left `analytics=null`
on skip, and the `if (analytics)` guard silently dropped the owner's weekly
report — a product regression, not a cost saving. Caught by architect review.

**How to apply:** whenever adding a gate to a sweep, trace everything downstream
of the gated call; anything user-visible needs a stored-result fallback on the
skip branch, plus a regression test. Gates fail OPEN (gate_off/gate_error no-op),
and outside-data jobs carry freshness time buckets so they can never go
permanently stale.
