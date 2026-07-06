---
name: EchoAI TTS provider fallback
description: How EchoAI picks a text-to-speech provider and keeps the wake-up intro non-blocking.
---

- All spoken audio flows through one chokepoint: `voiceController.synthesizeSpeech(text, style)`. Add new voice features by calling it, never a provider SDK directly.
- Provider order: ElevenLabs (single configured voice, streaming endpoint) first; fall back to OpenAI TTS when ElevenLabs is unconfigured OR throws. ElevenLabs ignores the OpenAI style→voice map by design (one brand voice).
- Gating split: `config/elevenlabs.ttsConfigured()` needs API key AND voice id; `soundConfigured()` needs only the key (sound generation is voice-less). `isVoiceConfigured()` is true if EITHER provider can speak.
- **Presentation Mode is strict single-voice.** During a live sales demo the voice must NEVER switch providers mid-presentation. `synthesizeSpeech(text, voice, {strict})` disables the OpenAI fallback and throws `err.code="tts_unavailable"` if ElevenLabs is unconfigured/errors; the speak endpoint maps that to `503 {code:"tts_unavailable"}` (still 502 for other upstream failures). The client shows a TEXT notice and advances instead of speaking in a different voice — never fall back audibly while presenting.
- Presentation state is client-driven: `VoiceContext` tracks `echoai:demo-start/stop` into a `presentationRef` and threads `{presentation}` through EVERY `api.echoVoiceSpeak` call in `speakItem` (all spoken surfaces funnel through the enqueue→drain→speakItem pipeline, so covering speakItem covers everything). The short-blob cache is mode-namespaced (`p|` vs `n|`) so a normal-mode (possibly OpenAI) blob can't replay during a presentation.

**Why:** the user wanted ElevenLabs everywhere but a guaranteed OpenAI safety net so voice never hard-fails — EXCEPT in Sales Presentation Mode, where a mid-demo voice switch is worse than silence, so there the safety net is a visible text notice, not a different voice.

**How to apply:** the morning-briefing wake-up music intro (`generateSound`, cached to `uploads/audio/wakeup-intro.mp3`, in-flight dedup) is strictly best-effort — server returns 204 on any failure, and the client intro fetch has an 8s AbortController timeout. Never let the intro block or fail the spoken briefing.
