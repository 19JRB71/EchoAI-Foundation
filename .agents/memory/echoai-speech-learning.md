---
name: EchoAI speech-pattern learning
description: Voice slang/accent normalization, per-owner learned phrases, and speech-confidence lifecycle rules.
---

# Speech-pattern learning (Echo voice)

- All accent/slang canonicalization lives inside `normalizeSpeech` (single choke point) so every matcher — wake word, yes/no, interrupt, briefing, nav, music, learned phrases — sees the same normalized text. Never normalize in individual matchers.
- Learned phrases are per-owner exact-match (≤6 words, normalized) rewrites applied at the TOP of processCommand, mapping to a canonical utterance (LEARNED_CANON) rather than invoking actions directly — so downstream branch logic stays single-sourced.
- Server side: action allowlist + phrase normalization/length bounds re-validated at the endpoint; upsert bumps `hits`; owner-scoped reads.

**Speech-confidence lifecycle rule:** the recognition-confidence ref must be reset at EVERY fresh capture boundary (processCommand snapshot, goActive wake transition, follow-up window open). If it only resets at consume time, low-confidence ambient/wake audio leaks into the next command and falsely triggers the "say that again" clarification.

**Why:** confidence is per-chunk and accumulates as a minimum; capture windows don't align 1:1 with commands.

**How to apply:** whenever adding a new listening-mode transition or capture window, reset confRef there too; clarify/learn refs (misheardRef, clarifyRetryRef) likewise clear at every exit site (soft-close, muteMic).
