---
name: EchoAI audio autoplay unlock
description: Why Echo's morning briefing needs a login-gesture "warm audio element" to auto-play, and how to keep it working.
---

# Echo voice autoplay unlock

Browsers block programmatic `audio.play()` until the user has interacted with the
page. A fresh page load with a persisted session (auto-auth, no click) therefore
**cannot** legally autoplay audio — that is browser policy, not a bug, and there
is no code workaround for the zero-gesture case.

**The reliable pattern:** keep ONE reusable `<audio>` element and play it (a short
silent clip) synchronously inside a genuine user gesture. Once an element has
played under user activation, that SAME element may `play()` again later with no
further gesture, indefinitely (Chrome + Safari).

**How it applies here:** `client/src/voice/audioUnlock.js` owns the warm element;
`unlockAudio()` is called in the Login form submit handler (the login click is the
gesture). `VoiceContext.speakItem` must REUSE `getWarmAudio()` for every chunk —
never `new Audio()` — or Safari re-locks. Cleanup uses
`removeAttribute('src')+load()` (not `src=''`) since the element is shared.

**Why:** morning briefing auto-play kept failing after login; the enqueue worked
but `play()` returned blocked → `needsGesture`. Priming on the login gesture +
element reuse fixes genuine logins. The `blocked → requeue → needsGesture → first
gesture resumes` fallback is still required for persisted-session reloads.

**Gotcha:** viewing the app inside the canvas/mockup iframe blocks audio autoplay
regardless (cross-origin iframe without `allow="autoplay"`). Test in a real tab.

**Live-triage signature (July 2026):** owner reports Echo "not responding" to
voice while the panel says "Listening" and typed chat works — after a hard
refresh on a persisted session there was no gesture, so Echo could hear but
couldn't SPEAK; replies were silently blocked. Any UI click (he happened to
click Core Lab) restores everything. Triage order: typed chat first, then ask
"did you click anything since the reload?" before suspecting the mic.
