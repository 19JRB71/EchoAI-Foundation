---
name: EchoAI email drip failure classification
description: How email send failures are classified permanent-vs-transient so owners know what to retry vs fix
---

# Email failure permanence classification

Failed email-marketing recipient rows carry a permanence flag beside the raw
error, mirroring the SMS `error_permanent` pattern, so the failed-recipient UI
can steer owners: permanent = fix/remove the contact, transient = safe to retry.

**Classification rule:** SMTP 5xx reply codes (hard bounce / invalid mailbox) =
permanent; 4xx (greylisting) and connection/timeout/auth = transient. With no
usable reply code, fall back to a bounce-signature regex on the message text;
everything else defaults to transient (safe). Coerce numeric-string codes
("550") to numbers before matching — some transports emit them as strings.

**Why:** retrying a dead address just fails again; transient defaults keep owners
from being discouraged from legitimate retries. Unclassified (NULL) rows group
with transient in the UI.

**How to apply:** every failure-flip path that marks a recipient failed must set
the flag, and every retry/reset path must clear it back to NULL, or a re-queued
row keeps a stale permanence label.

**Task-text gotcha:** the ticket wording said "5xx = transient" but that
contradicts its own "bounce/invalid-address = permanent" — SMTP 5xx *is* the
hard bounce. Follow the semantic intent, not the literal wording.
