---
name: EchoAI hands-free "Hey Echo" voice conversation
description: Always-on wake-word voice mode wiring, gotchas, and the section-key drift trap for voice nav intents.
---

# EchoAI always-on voice ("Hey Echo")

Owner-only hands-free voice: Web Speech continuous recognition for the wake word,
a passive→active→processing→speaking state machine, follow-up countdown, and
ElevenLabs personality stings served best-effort from the server.

## Voice nav intents must use REAL App section ids
`matchNavIntent` maps spoken commands to `App.jsx` section keys. These keys are
NOT always the obvious word:
- SEO/Google → section id is **`googleseo`**, not `seo`.
- Voice Settings → **`voicesettings`**. Reputation → `reputation`, Settings → `settings`.
**Why:** a wrong key silently no-ops navigation (the switch has no matching case).
**How to apply:** cross-check every nav key against `lib/departments.js` +
`lib/tiers.js` + the `section === "..."` switch in `App.jsx`, and add a unit test
per key in `conversationHelpers.test.js` to catch drift.

## Every new AI agent must be added to the voice nav map
Adding a new agent to the roster (`lib/departments.js`) does NOT make it
voice-navigable. `matchNavIntent` has its own `NAV_TARGETS` list plus a
`DEPT_NAMES` label map — both must be updated by hand, or "go to <agent>"
falls through to Echo's AI, which then says it can't navigate (looks like a
broken feature, not a missing entry).
**Why:** a real bug — the 9th agent Sage and the Voice agent both returned
`null` from `matchNavIntent`: Sage had no `NAV_TARGETS` entry at all, and
`dept:voice`'s regex listed only role aliases (receptionist/answering service),
never the bare agent word "voice".
**How to apply:** for each agent, add a `dept:<id>` target AND a `DEPT_NAMES[id]`
label. Same trap for non-section actions: "connect Facebook"/"Facebook setup" had
NO nav target at all, so Echo's AI improvised refusals — fixed with an
`action:facebook` target that App.jsx handles by opening the FB wizard, plus a
server prompt line forbidding "cannot navigate" replies. Bare agent names that are also common English words (e.g. "voice") must be
`standalone:false` (nav verb required) so casual speech can't hijack nav. Watch
`NAV_TARGETS` ORDER — first match wins, so a new alias containing an
earlier-listed word collides (e.g. "industry intelligence" matched the
Customer-Intelligence `intelligence` target; Sage uses "industry brief/report"
instead). Verify by feeding every command through the real `matchNavIntent`.

## Best-effort sound endpoints (204, never error)
`GET /api/echo-voice/sound/:name` (auth+lockout+requireOwner) returns **204** for
an unknown name, when ElevenLabs sound generation isn't configured, or on upstream
failure — the client just skips the sting. Success = `audio/mpeg` from a disk
cache under `uploads/audio/sfx-<name>.mp3` (wake riff key is versioned, e.g.
`wakeup-intro-v2`). `uploads/` is NOT gitignored and some files are intentionally
committed, so any test that exercises the "configured" path writes a fake mp3
there — delete it in the test `after` hook or it pollutes git.

## Preview limitation (unchanged constraint)
Web Speech API + mic are blocked in the Replit preview iframe → hands-free only
works deployed or in a new tab. Always keep push-to-talk as the graceful fallback.
