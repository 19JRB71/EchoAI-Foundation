---
name: EchoAI stale-claim rescue
description: Non-transactional status-flip claims need a stale-row rescue sweep; mark failed, never retry.
---

Any cron that claims work by flipping a status (e.g. `scheduled` → `publishing`) in a plain non-transactional UPDATE strands rows forever if the process dies before the terminal write. Transactional claimers (touchpoints, drip emails) roll back automatically; status-flip claimers do not.

**Why:** social posts stuck in `publishing` after a crash never published and never surfaced as failed — the customer's post silently vanished.

**How to apply:**
- At the top of the cron tick, sweep rows stuck in the in-flight status past a generous window (10+ min when a normal tick takes seconds), keying staleness off `updated_at` (the claim UPDATE bumps it via the table trigger).
- Mark rescued rows **failed with an explanatory owner-visible error — never retry/re-queue** — because the crash may have happened after the external platform call succeeded; retrying risks double-posting/double-sending.
- The window must comfortably exceed a fresh concurrent tick's in-flight time so legitimate in-progress claims are left alone.
