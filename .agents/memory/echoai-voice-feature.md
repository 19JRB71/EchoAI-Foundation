---
name: EchoAI voice (TTS/STT) infrastructure
description: Existing voice endpoints + how to add voice UI without breaking sub-Pro / iframe / gated flows.
---

# EchoAI voice (speech) infrastructure

EchoAI already ships server-side voice: `config/openai.js` (Whisper STT +
OpenAI TTS models/voice) and `/api/voice/*` — `speech-to-text` (multipart audio
→ `{text}`) and `text-to-speech` (JSON `{text,voice}` → `audio/mpeg` MP3),
both `auth + featureGate("voice_chatbot")`; plus a public `/chat` loop for the
website chatbot. Don't rebuild this — reuse the endpoints.

**Gating constraint (non-obvious):** the two protected voice endpoints are
**Pro-gated** (`voice_chatbot`); admin bypasses all gates. So any voice UI you
add to an **all-tier or onboarding** flow (e.g. Brand Discovery, which every
tier runs) must **degrade gracefully** — catch 403 and keep the typed path
working, never hard-fail. Brand Discovery does this.

**Client wiring gotcha:** TTS returns **binary** and STT takes **multipart**, so
their `api.js` methods must **bypass the JSON `request()` wrapper** (which
sets `Content-Type: application/json` and JSON.stringifies) — use raw `fetch`
and attach the Bearer token manually (see `textToSpeech`/`speechToText`).

**Browser realities:** mic (`getUserMedia`) is blocked inside the embedded
Replit preview iframe (no `allow="microphone"`) — voice only works in a real
browser tab / deployed app; show a hint and fall back to typing. TTS autoplay
after an async fetch can be blocked; offer a per-message replay button.
