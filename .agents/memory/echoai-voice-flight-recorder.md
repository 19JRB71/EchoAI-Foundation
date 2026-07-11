---
name: EchoAI voice flight recorder
description: In-memory voice diagnostic log for debugging live-site voice bugs from one pasted report
---

The voice engine has an always-on flight recorder (`client/src/voice/flightRecorder.js`, 400-event in-memory ring): every TTS start/end, every final transcript with the decision made about it (accepted / dropped-as-echo-of-self / barge-in / wake-word), command dispatch, mic errors, and mic restarts (zombie recycle + start failure). Owner copies a human-readable report from Settings → Voice ("Voice diagnostic report", works even with voice toggled off).

**Why:** live-site voice bugs (self-echo, ignored commands, "went silent") were impossible to diagnose from verbal descriptions; the recorder captures the causal chain with wall-clock ms timestamps and ≥1.5s gap markers.

**How to apply:**
- When James reports a live voice bug, FIRST ask him to reproduce it and paste the diagnostic report — don't guess from the description.
- Any NEW voice decision point (a new drop/accept/gate branch) must call `recordVoiceEvent` too, or the report goes blind to it.
- Keep it in-memory + manual-copy only; never add automatic upload (privacy promise is in the UI copy).
- `recordVoiceEvent` must stay never-throw — a broken recorder must not break the voice engine.
