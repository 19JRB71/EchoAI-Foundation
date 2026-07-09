---
name: EchoAI voice latency streaming
description: Rules for the streamed Echo voice reply pipeline (sentence streaming, instant acks, double-speak prevention).
---

- **Sentence streaming double-speak rule.** When a reply streams sentence-by-sentence, the final full reply must NEVER also be spoken: server tracks raw-emitted text and only emits a post-processed leftover when it's a prefix-compatible tail; client skips the full-reply speak when any partial was spoken and instead awaits all queued partial plays. A stream failure AFTER the first spoken sentence must NOT fall back to the non-streaming endpoint (that replays the whole reply).
  **Why:** two overlapping voices reading the same answer is the worst possible UX regression.
  **How to apply:** any change to the hidden-marker post-processing or the streaming fallback must preserve both guards.
- **Instant acks are non-blocking.** Spoken acks ("Got it, Sir.") play only from already-preloaded blobs — a cache miss is a silent skip (fall back to the thinking sting), never a network wait. Server caches per (phrase, voice) on disk via the synthesizeSpeech chokepoint, 204 best-effort.
- **Recognizer fast-commit.** When the browser recognizer delivers a FINAL result, commit the command on a short pause (~450ms); interim-only text keeps the longer pause. Don't collapse the two — interim-only fast-commit cuts users off mid-sentence.
