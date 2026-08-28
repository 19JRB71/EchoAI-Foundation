---
name: EchoAI digest-bound activation consent
description: Two-phase (preview→digest-bound approve) consent pattern for calendar activation; client + setup-agent halves.
---
The calendar-activation boundary requires a `confirmDigest` matching the versioned SHA-256 of the canonical artifact: calendar ID, eligible post identity/time/platform/destination/exact text/media refs, and exact stale/unbound membership. No digest ⇒ 409 + preview; stale/v1 digest ⇒ 409 + fresh preview.

**Why:** SDS-H1 — silent zero-approval activation scheduled posts the owner never saw.

**How to apply:**
- Any new path that activates/schedules owner content must go through the SAME digest-guarded boundary (setup agent's social_schedule does — R26), never a parallel flip.
- Client side: Activate is two-phase (fetch preview → render artifact → approve with digest); a 409 on approve re-fetches a fresh preview ("schedule changed"), never errors out.
- Consent-review editors in both hosts use the existing post writer with a draft-only precondition; Save invalidates/refetches the preview, while the normal post-onboarding editor intentionally keeps its prior scheduled-edit behavior.
- Consent echo is written into each activated post's spine task meta (content_calendars has no JSONB column).
- Setup agent handoffs of this kind are `needs_connection` type `activate_calendar`; the e2e loop skips handoffs, so e2e asserts 0 scheduled + drafts remain.
