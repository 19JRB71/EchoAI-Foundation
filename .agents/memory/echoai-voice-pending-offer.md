---
name: EchoAI voice pending yes/no offers
description: Rules for ask-before-reading voice offers (pending brief state) in the Echo conversation loop.
---

Rule: when Echo asks a yes/no question ("Want me to walk you through them?"), the pending state must never hijack real commands or survive stale.

**Why:** review found "please open settings" matched as yes (bare `please` in YES_RE) and pending state survived a manual top-bar mute.

**How to apply:**
- Before interpreting yes/no, check `matchNavIntent`/`matchMusicIntent` first — a clear new command always wins and falls through as a fresh command.
- Bare `please` is NOT an affirmation; only `yes please` / `please do` count.
- Clear the pending ref on EVERY exit path: voice mute intent, top-bar `muteMic()`, and the follow-up timeout soft close.
- Yes/no regexes match post-`normalizeSpeech` text (apostrophes → spaces: "i m good", "that s ok").
- Data-backed offers/briefs (leads/campaigns/sage) come from deterministic owner-only server endpoints (no AI, demo brands excluded); generic sections fall back to a static question + the AI pipeline on yes.
- Catch-all answer states are the worst trap: the briefing-choice handler maps ANY leftover utterance to a "specific briefing topic", and the morning-standby go-ahead bark `\bready\b` matches inside longer sentences ("I'm ready to do a facebook post"). Every workflow-starting intent (content creation etc.) must be added to the "real command wins" guard of BOTH — nav/music alone is not enough.
