---
name: EchoAI multi-turn voice sessions
description: Durable rules for any multi-turn voice session/pending ref in the conversation engine.
---

# Multi-turn voice sessions

**Rule 1:** any long-lived voice session state must be cleared AND its
server-side session shelved (cancelled, fire-and-forget) at *every* engine
reset path — not just the obvious interrupt. The engine has several
independent reset paths (barge-in during speech, watchdog force-reset, mute
via voice AND via button, logout, follow-up timeout, competing command
categories that win mid-session), and each one is a separate code path.

**Why:** a review failed precisely because two of the less obvious reset paths
were missed — a stale session ref silently hijacks later utterances and
misinterprets them as session commands.

**How to apply:** before shipping a new multi-turn voice flow, enumerate every
place existing pending refs are cleared and mirror the cleanup at each one.

**Rule 2:** any voice command that commits/schedules something must match a
strict, explicit phrase — loose agreement ("yes", "okay") must never commit.

**Rule 3:** speech normalization converts apostrophes to spaces before
matchers run, so matcher regexes must accept the space-split contraction form
("let ?s", "that ?s"), never the literal apostrophe form.
