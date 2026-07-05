---
name: EchoAI weekly briefing once-per-week guard
description: How the client prevents duplicate/unsolicited weekly strategy briefings across auto + manual triggers.
---

# EchoAI weekly strategy briefing — auto-play idempotency

The weekly spoken briefing has TWO client trigger paths in the voice engine: an
auto-play effect (once per ISO week, gated by enabled + autoBriefing) and a manual
"Weekly" button. Both are keyed by a per-ISO-week `localStorage` guard
(`echoai_weekly_<YYYY-Www>`). The client computes the same ISO-week key the server
returns as `weekKey`, so the guard survives logins/reloads (unlike the per-session
morning guard).

**Rule:** claim the week's guard **synchronously at enqueue time**, never only in
`onPlayed`.

**Why:** if the stamp is deferred to `onPlayed`, an auto-enqueued briefing plus a
manual click (or a component re-mount) can both enqueue before either writes the
guard → the owner hears the weekly twice back-to-back. Stamping synchronously means
a deliberate manual play "satisfies" the week and the auto effect's post-fetch
re-check sees the claim and bails.

**How to apply:**
- Manual button: always allowed (deliberate gesture, never gated by the guard) but
  it must still write the guard synchronously so auto won't add a second one.
- Auto effect: pre-check the guard BEFORE the AI request (don't spend a call you
  won't use), then re-check AND claim synchronously after the fetch, before enqueue.
- A blocked (autoplay-gated) item is re-queued in-session by the drain loop, so
  claiming up front does not lose the briefing within the session; only a hard
  reload before first playback skips that week (acceptable, matches the morning
  briefing's session-scoped model). Cross-tab simultaneous mounts remain a rare
  benign TOCTOU — not worth a lock.
