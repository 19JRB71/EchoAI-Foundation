---
name: EchoAI instant-path vs weekly-batch parity
description: One-off/instant creation paths must populate the same AI-brief fields the weekly batch does, or downstream renders degrade to generic output.
---

**Rule:** When a subsystem has both a scheduled/batch generation path and an
instant/one-off path writing to the same table, the instant path must populate
every AI-brief column the batch path does (e.g. `visual_idea` on
`autopilot_batch_items`).

**Why:** Instant posts omitted `visual_idea`, so image rendering fell back to a
generic "eye-catching visual for: <post text>" description → repetitive
near-identical images, which the owner reported as a bug.

**How to apply:** When adding a new one-off creation endpoint next to an
existing batch generator, diff the INSERT column lists. Also: any random
1-of-N creative-variant pick on a RE-render should exclude the previously used
variant (parse it from the stored prompt), or ~1/N of regens look identical.
