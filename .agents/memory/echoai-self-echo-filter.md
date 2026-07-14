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

**Window size (third incident):** live flight-recorder data showed TRUE leaks
always finalize within ~1.5s of audio end, while the owner's genuine answers
that reuse Echo's words ("give me the rundown" answering "want me to give you
the rundown?") arrive 2.5–5s after. Window reduced 7s→3s. If tuning again,
demand flight-recorder evidence — the two failure modes (Echo answers itself
vs Echo eats real answers) pull the window in opposite directions.

**Glued-answer salvage:** the recognizer often finalizes Echo's leak + the
owner's fast answer as ONE chunk ("…give you the rundown yes"). Salvage the
trailing words not present in any echoed line, but FAIL CLOSED: only accept an
exact match against a short-answer whitelist (yes/no/stop/go ahead… optional
"sir" suffix) — open-ended salvage promotes ASR-hallucinated trailing tokens
into fake commands.

**Recency rule (second production incident):** only match against lines whose
audio is still playing or ended within the echo window. Echo verbally SUGGESTS
commands ("say 'switch to another business' anytime"); when the owner obeyed
minutes later, the command matched the stale greeting still in the recent-lines
buffer and was dropped as self-echo. Buffer entries are `{text, endedAt}`
(stamped at tts-end); the match site filters by recency before `isSelfEcho`.
Old lines can't physically leak speaker→mic — never match them.

Related honesty rule from the same incident: setup-status probes must
distinguish "never connected" from "connected but broken" (any non-connected
row = they DID connect once → say "reconnect", never "connect one"), and a
spoken setup reminder must name the brand when the owner has >1 brand.
