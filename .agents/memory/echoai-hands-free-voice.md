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
