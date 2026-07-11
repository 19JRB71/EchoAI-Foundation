---
name: EchoAI self-echo filtering
description: Preventing Echo from hearing and answering her own TTS via the mic
---

The speech recognizer can FINALIZE captures of Echo's own TTS audio several
seconds AFTER playback ends — far past any short (sub-second) post-TTS cooldown.
Also, tail-only matching (last N spoken words) misses leaks from the middle of
a long spoken line.

**Rule:** self-echo protection must be a **filter, not a deaf gate**: apply
`isSelfEcho` word-overlap matching to final chunks for a generous window
(~7s) after TTS end (track a `lastTtsEndAt` timestamp in the speak-end
callback), and match against the FULL spoken line (≥5-word, ~80% word-overlap
branch), not just the tail. Real, different commands spoken inside the window
must still pass — never blanket-drop.

**Why:** with only an 800ms cooldown + 12-word tail match, Echo asked a
question, heard her own delayed transcript, and answered herself in production.

**How to apply:** any change to the voice capture path that adds cooldowns or
echo checks: keep filtering (drop only matches), keep the post-TTS window on
FINAL chunks only (interims stay gated), and keep heard/spoken text normalized
through the same `normalizeSpeech` before word-set comparisons.

Related honesty rule from the same incident: setup-status probes must
distinguish "never connected" from "connected but broken" (any non-connected
row = they DID connect once → say "reconnect", never "connect one"), and a
spoken setup reminder must name the brand when the owner has >1 brand.
