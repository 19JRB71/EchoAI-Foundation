---
name: EchoAI proactive suggestions
description: How Echo's weekly-briefing channel/tool suggestions must detect gaps and dedup, and the fail-closed rule.
---

# Echo proactive suggestions (weekly briefing)

Echo suggests channels/tools the owner hasn't set up, grounded ONLY in the
owner's OWN account state — never fabricated competitor/market data.

## Gap detection must fail CLOSED
A "gap" = the owner does NOT use a channel (probe query returns no rows). If the
probe query THROWS (missing table, transient DB error), you must NOT treat that
as "no usage" — that manufactures a false gap and surfaces an ungrounded
suggestion, violating the core requirement.

**Why:** an earlier version swallowed probe errors as `false` (= not used),
which could fabricate suggestions during any DB hiccup.

**How to apply:** the existence helper must let errors throw; the compute loop
catches per-channel and `continue`s (skips), so a probe failure removes that
channel from candidates rather than inventing a gap.

## Dedup policy (state table)
One row per (user, suggestion_key). Suppress a key when: shown < 30d ago, OR
declined < 90d ago, OR ever accepted. Delivering the briefing records "shown"
(resets 30d window) but must preserve an existing `accepted` (guard the upsert
with `WHERE status <> 'accepted'`). Decisions come via an owner-scoped endpoint;
reject any key not in the catalog (400, not 500).

## Read-only vs side-effect split
Gathering briefing data (used for AI narration) stays READ-ONLY — it only
computes candidates. Recording "shown" happens at delivery in the controller, so
briefing gathering has no side effects and stays testable.
