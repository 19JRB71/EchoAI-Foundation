---
name: EchoAI Forge Creative Director
description: Strategy-brief engine for Autopilot content — memory/learning rules and traps.
---

Rule: creative memory and performance learning must count only briefs that were
actually USED (linked to a real batch item). Planned-but-unused briefs (failed
batch, AI short output) stay orphaned and are excluded from history.

**Why:** planBriefs persists rows fail-open BEFORE generation; if unlinked rows
counted, failures would pollute recency blocking and engagement weighting with
content that never existed (architect flagged this).

**How to apply:** any new consumer of forge_creative_briefs history must filter
`item_id IS NOT NULL`. Multi-week batches must seed earlier weeks' just-planned
(not-yet-linked) briefs into later planBriefs calls — DB history can't see them.
Test DB needs `node tests/setupTestDb.js` re-run after adding a migration or the
new table silently fail-opens in tests.
