---
name: EchoAI sweep per-item guard + test seam
description: Pattern for keeping one broken row from silencing recurring loop-over-items sweeps, and how to make the guard testable.
---

# Recurring sweep per-item guards

**Rule:** every recurring job that loops over brands/users/rows (schedulers,
crons, sweeps) must contain each iteration's body in a try/catch that logs and
continues. A sweep that runs multiple sub-sweeps sequentially must also isolate
each sub-sweep so the first one's query failure can't silence the second.

**Why:** these jobs are the "best-effort throughout" contract — one malformed
row/customer must never stop alerts, reports, or reminders for everyone else.
A full audit (goal sweep, health sweep, weekly analytics, drip emails,
touchpoints, social publish, autonomous growth, briefing warm, closing
summaries, reminder sweeps) confirmed all now follow it; the reminder sweeps
were the last gap.

**How to apply (test seam):** extract the per-row body into an exported helper
and invoke it via `module.exports.<helper>(row)` inside the guarded loop. Tests
then stub the helper to throw for row 1 (delegating to the original for the
rest) with a fake `db.query`, and assert row 2's insert still landed. Reference
implementations: `EchoAI/utils/goalAlerts.js` + `EchoAI/test/goals.test.js`,
`EchoAI/utils/echoVoiceReminders.js` + `EchoAI/test/echoVoiceReminders.test.js`.
Don't rely on a callee that "never throws" instead of the guard — that
invariant is one refactor away from breaking.
