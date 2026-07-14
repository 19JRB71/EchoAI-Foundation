---
name: EchoAI stale recognition closures
description: Long-lived SpeechRecognition sessions freeze voice-context state in their callback closures — read refs, never `voice.<state>`, inside the recognition chain.
---

**Rule:** Anything reached from the SpeechRecognition callback chain (onresult → handleResult → processCommand → speakAndWait) must read voice-engine state via refs (`voiceRef.current`, `activeRef.current`, `mutedRef.current`), never the `voice` context object or props captured in closures.

**Why:** A recognition session can run for minutes with the closures it was created with. Even though every useCallback dep array is correct and the context value refreshes, the LIVE rec instance keeps calling the old handlers until it ends/restarts. Real incident: owner unmuted the speaker ("speaker-unmuted" recorded) yet every reply was still skipped as "speaker-muted" for the rest of the session — Echo heard everything, said nothing.

**How to apply:** EchoConversationProvider keeps `voiceRef` (mirrors `useVoice()` each render via effect) plus `activeRef`/`mutedRef`/`enabledRef`. New code inside the recognition chain must use these refs. The flight recorder events `speech-skipped`/`speech-held`/`speech-not-played`/`speech-timeout` make this class of bug visible in the "Copy diagnostic report" output.
