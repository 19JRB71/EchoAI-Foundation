---
name: EchoAI TTS provider fallback
description: How EchoAI picks a text-to-speech provider and keeps the wake-up intro non-blocking.
---

- All spoken audio flows through one chokepoint: `voiceController.synthesizeSpeech(text, style)`. Add new voice features by calling it, never a provider SDK directly.
- Provider order: ElevenLabs (single configured voice, streaming endpoint) first; fall back to OpenAI TTS when ElevenLabs is unconfigured OR throws. ElevenLabs ignores the OpenAI style→voice map by design (one brand voice).
- Gating split: `config/elevenlabs.ttsConfigured()` needs API key AND voice id; `soundConfigured()` needs only the key (sound generation is voice-less). `isVoiceConfigured()` is true if EITHER provider can speak.

**Why:** the user wanted ElevenLabs everywhere but a guaranteed OpenAI safety net so voice never hard-fails.

**How to apply:** the morning-briefing wake-up music intro (`generateSound`, cached to `uploads/audio/wakeup-intro.mp3`, in-flight dedup) is strictly best-effort — server returns 204 on any failure, and the client intro fetch has an 8s AbortController timeout. Never let the intro block or fail the spoken briefing.
