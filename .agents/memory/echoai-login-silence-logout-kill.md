---
name: EchoAI login silence & logout audio kill
description: Owner rules for Echo voice — silent after login greeting until user initiates; logout must hard-kill all audio.
---

**Rule 1 — login silence.** On login Echo speaks ONLY the standby greeting, then nothing. All auto-spoken surfaces (pending alert poll incl. sage_urgent, weekly auto-briefing) are gated behind a per-session "user initiated" flag, set only by explicit engagement (wake-word command via `echoai:user-initiated` event, or an Echo button). Flag resets on deactivate.
**Why:** owner directive — Echo was reading the Sage report and navigating on every login; the user must initiate everything after the greeting.
**How to apply:** any NEW auto-spoken or auto-navigating surface must check the same gate; never add speech that fires unprompted right after login.

**Rule 2 — logout kill switch.** `handleLogout` dispatches a synchronous `echoai:logout` window event BEFORE clearing auth state (providers unmount right after — listeners must still be attached). Handlers: VoiceContext (stopAll + killWarmAudio + speechSynthesis.cancel, also on unmount cleanup), MusicContext (stop), EchoConversationContext (timers, recognition, SFX).
**Why:** the warm unlocked audio element and the SFX element are module-level singletons that outlive React unmounts — unmounting alone does NOT stop them.
**How to apply:** any new audio surface (new Audio element, player, synth) must add an `echoai:logout` listener that hard-stops it.
