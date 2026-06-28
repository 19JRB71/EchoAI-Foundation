---
name: Appointment booking safety
description: Invariants for EchoAI's AI appointment booking (chatbot/phone) so writes never double-book.
---

# Appointment booking safety (EchoAI)

- **Every write path that reserves a time must serialize under the per-brand
  advisory lock** `pg_advisory_xact_lock(hashtextextended('appt:'||brandId,0))`
  inside a transaction, then re-check overlap, then insert/update. This applies to
  initial booking AND reschedule — a plain overlap check without the lock lets two
  concurrent writers both pass and collide. The partial unique index is only a
  backstop, not the primary guard.
  **Why:** reschedule originally skipped the lock and only checked appointment
  overlap, so concurrent booking+reschedule could double-book.

- **Slot validation for the AI path must fail closed on Google Calendar outages.**
  `computeOpenSlots(..., {strict:true})` throws (`err.calendarUnavailable`) when the
  owner's calendar lookup fails for a real reason (not `notConnected`); `bookForLead`
  catches it and returns `{invalid:true}`. Offering slots (`getSlotsForBrand`) stays
  best-effort/non-strict, but booking re-validates strictly.
  **Why:** silently ignoring busy times on a transient failure books over the
  owner's real calendar.

- **Owner-initiated reschedule may fall outside published hours** (like manual
  dashboard booking) — it is intentionally NOT re-validated against computed open
  slots, only overlap-checked under the lock. Only the AI path (`bookForLead`) must
  match a computed open slot.

- **Chatbot must score temperature on the user's message BEFORE generating the
  reply**, so scheduler-prompt injection + booking fire the same turn the lead turns
  hot. Using the prior-turn `session.temperature` lags one turn. (Phone is implicitly
  Pro since only Pro+ owners configure Twilio.)
