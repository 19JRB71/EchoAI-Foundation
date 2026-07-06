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

**ElevenLabs-first TTS fallback policy (do not regress):** all spoken audio
prefers ElevenLabs, but the fallback to OpenAI TTS is intentionally NARROW.
`utils/elevenlabs.js` tags HTTP failures: 4xx = `reachableButRefused`
(bad key / **quota_exceeded** / unknown voice — a FIXABLE account problem),
5xx/network = unreachable. `voiceController.synthesizeSpeech` falls back to
OpenAI ONLY on unreachable; on a 4xx refusal it throws `elevenlabs_error`
(status attached) and the HTTP handlers return **502** with the exact ElevenLabs
message — never masking a fixable refusal behind a different-sounding voice.
Every call logs `[voice:<label>] provider=elevenlabs|openai`. **Why:** a
silent OpenAI fallback made "ElevenLabs isn't being used" undiagnosable; the real
cause is usually the ElevenLabs account being out of credits, which only the
owner can fix (add credits / upgrade plan) — no code change makes it speak.

**Browser realities:** mic (`getUserMedia`) is blocked inside the embedded
Replit preview iframe (no `allow="microphone"`) — voice only works in a real
browser tab / deployed app; show a hint and fall back to typing. TTS autoplay
after an async fetch can be blocked; offer a per-message replay button.

**Setup Agent voice input (separate from the Pro-gated chatbot voice):** the
Setup Agent adds its own `POST /api/setup-agent/transcribe` (Whisper fallback,
used only when the browser lacks the Web Speech API). It reuses
`voiceController.transcribeAudio` + the shared `middleware/audioUpload.js` multer
(25MB, `audio/*` only), but is **owner-only setup, NOT `voice_chatbot`-gated** —
onboarding runs on every tier, so gating it would break Starter setup.
Whisper failure → **502** (setup-agent AI convention), not 500. Web Speech is
primary/real-time; method is detected once on load. **jsdom has no
SpeechRecognition/MediaRecorder → voice `supported=false` → text mode**, which is
why the placeholder `Type your answer…` and the existing SetupAgent tests stay
green; force voice on by mocking `window.SpeechRecognition` + setting the
`echoai_setup_voice_mode` localStorage key.

**Echo voice navigation (always-on conversation engine):** `matchNavIntent` in
`conversationHelpers.js` runs BEFORE the server AI in `processCommand`; unmatched
commands fall to the server which says "I can't navigate", so any new nav phrase
must be added there. It returns section ids OR `dept:<agent>` keys — departments
MUST route through `openDepartment` (via the `echoai:navigate-section` event
listener in App.jsx), NOT `handleSelectSection` (which clears the department).
Two non-obvious traps: (1) verb-less/"standalone" aliases must be guarded so
questions ("how is my social media") don't navigate, and (2) common-word aliases
(e.g. bare "social") hijack unrelated speech — pin to specific phrases
("social media") only. Confirmations must end in "." (not "?") or isQuestion adds
the follow-up gate.

**Full-coverage routing rule (every section + department voice-reachable).** A
section and its owning department are BOTH reachable, so they need DISTINCT
triggers: agent PROPER NAMES + distinctive role titles → `dept:<agent>`
(standalone ok); FEATURE phrases → the section (verb required). So "campaigns"→
campaigns section, "atlas"/"advertising manager"→dept:atlas; "social media"→social
section, "nova"/"social media manager"→dept:nova. **Why:** an earlier iteration
routed "campaigns"→dept:atlas / "social media"→dept:nova, which left the actual
sections unreachable hands-free (one tool-card click away). **How to apply:**
keep sections `standalone:false` (verb-gated) so short answers ("yes launch the
campaign") fall through to the server pending_action approver; make generic
single-noun dept aliases (advertising, crm, competition, oversight) their OWN
`standalone:false` entries — a bare noun standalone hijacks ordinary talk
("competition is rough"). Order multi-word/distinctive phrases before generic
single words ("voice settings" before "settings"; "content calendar" before
"calendar"; "sentinel health"/"health monitor" before bare "sentinel"). Reqs that
already existed and needed NO change: verbal "yes" executing a pending action
(server `classifyApprovalUtterance`+`runExec`), auto morning briefing on login
(`autoBriefing` defaults **true**, once/session guard), and music voice
(`matchMusicIntent`, evaluated before nav).
