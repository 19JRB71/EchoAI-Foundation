---
name: EchoAI voice content creation session
description: Lifecycle rules for the "let's create some content" voice review session (contentSessionRef).
---

# Voice content session (client)

**Rule:** any long-lived voice "pending session" ref (like `contentSessionRef`)
must be cleared AND its server session shelved (`voiceContentComplete(id, true)`
fire-and-forget + `echoai:content-session` null dispatch) at EVERY engine reset
site — there are more than the obvious ones:

1. interrupt inside `processCommand`
2. barge-in interrupt inside `handleResult` (separate code path!)
3. mute voice intent AND the `muteMic` button action (two paths)
4. logout kill switch
5. stuck-suspend watchdog force-reset
6. follow-up window timeout
7. nav/music command mid-session (command wins, session shelved)

**Why:** the first architect review failed precisely because barge-in and the
watchdog were missed — a stale ref hijacks later utterances as review verdicts.

**How to apply:** when adding any new multi-turn voice session, grep for all
sites that clear `pendingTransferOfferRef` and mirror the cleanup at each.

Other invariants: approve matcher is strict/exact (loose "yes"/"okay" must
never schedule); `normalizeSpeech` turns apostrophes into spaces, so matcher
regexes need `let ?s` / `that ?s` forms, never `let'?s`.
