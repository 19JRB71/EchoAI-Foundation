---
name: ElevenLabs language pin
description: Why Echo sometimes spoke another language and how TTS language is pinned
---
Rule: always send `language_code` ("en" by default, `ELEVENLABS_LANGUAGE_CODE` override) on ElevenLabs TTS requests when the model is a Turbo/Flash v2.5 variant.

**Why:** Flash/Turbo v2.5 are multilingual and auto-detect language from the text; long summaries with brand names/unusual words can misfire and Echo suddenly speaks another language (reported at end of brand discovery).

**How to apply:** `EchoAI/utils/elevenlabs.js` computes `LANGUAGE_CODE` from the model id — only v2.5 models get the param (other models 400 on it). Blank the env var to disable.
