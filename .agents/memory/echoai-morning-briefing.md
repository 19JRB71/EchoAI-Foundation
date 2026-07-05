---
name: EchoAI morning voice briefing
description: How the login greeting fires and how the empty-account welcome is built
---

# Morning voice briefing (Echo greeting on login)

## Fire-on-every-login guard
- The auto-play briefing must speak on **every login**, not once/day, and regardless of whether the account has data.
- Client `VoiceContext.jsx` deliberately does **not** honor the server's `alreadyDeliveredToday` flag for auto-play (that field/`markBriefingDelivered` are informational only now).
- Reload-vs-login distinction is done with a **token-scoped** sessionStorage guard key (`echoai_briefing_<jwt-tail>`), NOT a fixed key.
  - **Why:** a fixed-key guard cleared only in the `active=false` teardown effect fails — on logout the whole authed subtree (incl. VoiceProvider) unmounts, so that effect body never runs and the key persists, suppressing the next login's greeting.
  - **How to apply:** a fresh login mints a new JWT → new key absent → greeting plays; a bare page reload keeps the same token+sessionStorage → key present → suppressed. No unmount cleanup needed.

## Empty-account welcome content
- `utils/echoBriefing.js` `hasActivity(data)` decides empty state; empty → warm welcome + Facebook-connect nudge instead of "No new leads…".
- FB connection checked via `facebookConnected(userId)` = `api_integrations WHERE platform='facebook' AND connection_status='connected'` (user-scoped, parameterized).
- Empty copy pattern: "Good morning <name>. Your marketing department is ready and standing by. Connect your Facebook account so Atlas can start bringing you leads. Your team is here and ready to work for you." (drop the FB sentence when already connected).
- The AI `narrate("morning", …)` goal branches on empty state so the AI version also warmly welcomes + nudges FB and does NOT recite zero counts. getBriefing narration uses a tight 1.5s/1-attempt budget then template fallback so speech starts ~fast.
