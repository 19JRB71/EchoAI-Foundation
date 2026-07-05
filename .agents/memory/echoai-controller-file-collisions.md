---
name: EchoAI controller file-name collisions
description: Before creating a "new" EchoAI controller/route, check it doesn't already exist and serve a different feature.
---

EchoAI reuses generic, feature-neutral names across unrelated subsystems, so a
"new" file may already exist and be wired into `server.js`. Writing it fresh
silently drops the pre-existing exports and the server fails at boot with
`Route.<method>() requires a callback function but got [object Undefined]`.

**Concrete example:** `controllers/demoController.js` originally held the public
landing-page `submitDemoRequest` (mounted `/api/demo/request` via
`routes/demoRoutes.js`). The Demo/Presentation-Mode work overwrote it and boot
broke until `submitDemoRequest` was merged back in and re-exported.

**Why:** `write` overwrites in full; unrelated features can share a name.

**How to apply:** Before `write`-ing any controller/route/util that sounds
generic (demo, admin, health, support, feedback, intelligence…), first
`ls`/`git show HEAD:EchoAI/<path>` to see if it exists. If it does, `edit` to
add functions rather than overwrite, and keep every existing `module.exports`
entry. Note: from repo root, git paths need the `EchoAI/` prefix even when the
workflow `cd`s into `EchoAI`.
