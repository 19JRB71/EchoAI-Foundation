---
name: EchoAI time-of-day greetings
description: Owner-required greeting windows and where greetings are sourced; timezone resolution rules.
---
Owner requirement: Echo greets by the user's LOCAL clock — morning 5:00–11:59, afternoon 12:00–16:59, evening 17:00–20:59, late 21:00–4:59 ("Working late Sir", never "Good morning"). Full morning briefing ONLY in the morning window; other logins get a greeting + offer of a quick day update (uncached status narrate).

**Why:** Owner explicitly complained about "Good morning" at night; wrong-time greetings break the assistant illusion.

**How to apply:**
- All greeting text flows through `utils/timeOfDay.js` (server) and the keyed `STANDBY_GREETINGS` pools (client). Never hardcode "Good morning" in a new greeting path — pass the part of day.
- EVERY variant in the late pool must start with "Working late" (tests enforce; architect flagged mixed "Good evening" late variants as a requirement violation).
- Timezone resolves from availability_schedules of non-demo brands (no LIMIT — a low LIMIT can skip the only valid row), fallback America/New_York.
- Scripted demo content (demoSeeder/demoScript) deliberately stays "Good morning" — it's a canned demo, don't "fix" it.
