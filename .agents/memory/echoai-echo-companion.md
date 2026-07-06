---
name: EchoAI Echo companion
description: How the persistent Echo companion panel drives post-setup activation by reusing feature controllers in-process.
---

# Echo companion (post-setup activation + ongoing mode)

Echo is a persistent dashboard panel (`/api/echo`, `client/src/companion/`) that,
after setup, walks the OWNER through activating their marketing: welcome →
connect Facebook (OAuth hand-off) → preview+approve first ad campaign →
preview+approve content calendar → ongoing mode (chat, voice, daily briefing).

**Reuse pattern (do not re-invent):** Echo executes real work through the SAME
synthetic-req/res `invoke(controllerFn, userId, {body})` + `ensureOk` pattern the
Setup Agent uses. Approving a preview launches a real campaign / activates a real
calendar — nothing is mocked.

**Invariant — never block the journey.** A single failed activation step (build
throw OR approve-exec throw) is recorded as skipped with a friendly message and
the flow continues. Same rule the Setup Agent follows.

**Facebook connection step must NOT self-complete while unconnected.** It stays
`needs_connection` and re-runs on each advance; only when `api_integrations` shows
facebook connected does it return an info result that marks it complete. The
client resumes the loop by detecting `?fb=connected` on mount (FB callback
redirects to `/dashboard?fb=connected|error`).

**Owner-only, both sides.** Routes are `auth → lockout → requireOwner`. The client
panel MUST also be gated (`!isTeamMember`) — mounting it for team members would
guarantee 403s and a broken UI.

**Panel is manual-open ONLY — it must NEVER auto-open.** The FAB click is the sole
path that sets `open=true`. Removed every automatic open (fb-return, activation
incomplete, voice-command handler, in-conversation effect). Background activation
(`runActivation`) still progresses silently when `activationStatus !== "active"`
and nothing awaits approval, so the panel is ready when the owner opens it; all
user-facing Echo output (briefings, alerts, conversation) is voice-only.
**Why:** an auto-opening panel was intrusive; the product intent is that Echo works
in the background and speaks, and the chat panel is an optional manual interface.

**Voice feedback loop (Echo talking to itself).** The always-on SpeechRecognition
picks up Echo's own TTS through the speakers. `EchoConversationContext` gates the
mic with `speakingRef` driven by the shared `echoai:tts-start`/`echoai:tts-end`
window events (covers ALL Echo audio, not just replies): true on start, held
`SPEAK_COOLDOWN_MS` (2s) after audio ends, plus a `POST_QUESTION_MS` (3s) grace
after a question (set in `openFollowupWindow(indefinite)`). `handleResult` early-
returns while gated. A `SPEAK_SAFETY_MS` watchdog force-clears the gate if tts-end
is ever missed so the mic can't lock up. All `getUserMedia` audio uses
echoCancellation/noiseSuppression/autoGainControl.
