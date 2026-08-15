---
name: EchoAI digest-bound activation consent
description: Two-phase (preview→digest-bound approve) consent pattern for calendar activation; client + setup-agent halves.
---
The calendar-activation boundary (activateCalendar) requires a `confirmDigest` matching the SHA-256 of the canonical activation artifact (utils/calendarActivationDigest.js). No digest ⇒ 409 confirmationRequired + preview; stale digest ⇒ 409 digestMismatch + FRESH preview. Empty calendars use computeActivationDigest([]).

**Why:** SDS-H1 — silent zero-approval activation scheduled posts the owner never saw.

**How to apply:**
- Any new path that activates/schedules owner content must go through the SAME digest-guarded boundary (setup agent's social_schedule does — R26), never a parallel flip.
- Client side: Activate is two-phase (fetch preview → render artifact → approve with digest); a 409 on approve re-fetches a fresh preview ("schedule changed"), never errors out.
- Consent echo is written into each activated post's spine task meta (content_calendars has no JSONB column).
- Setup agent handoffs of this kind are `needs_connection` type `activate_calendar`; the e2e loop skips handoffs, so e2e asserts 0 scheduled + drafts remain.
