---
name: EchoAI AI-call 502 mapping
description: Why every Anthropic/OpenAI call site in EchoAI must wrap the call to force 502, not rely on a status heuristic.
---

# EchoAI AI-call → 502 mapping

**Rule:** At every AI agent call site, wrap the `anthropic.messages.create` /
OpenAI call in its own try/catch and re-throw a typed error with
`statusCode = 502`. Do NOT rely on a generic `statusFor(err)` heuristic that only
maps errors carrying a numeric `err.status >= 400`.

**Why:** Anthropic/OpenAI SDK and network/runtime failures do **not** always carry
a numeric `.status` (timeouts, aborted sockets, SDK-internal throws). A
status-mapping heuristic lets those fall through to a generic **500**, which
violates EchoAI's documented invariant "AI upstream failures → 502, never mocked,
never a generic 500." This was caught in code review on the Ad Creative Studio
(`/api/ad-studio`) build; the controller's `statusFor()` only mapped `err.status`.

**How to apply:** Wrap the create call:
```js
let response;
try {
  response = await anthropic.messages.create({...});
} catch (err) {
  const wrapped = new Error(err.message || "AI request failed");
  wrapped.statusCode = 502;
  throw wrapped;
}
```
Parse/validation helpers should likewise throw with `statusCode = 502`. Keep
`statusFor` as a backstop but never as the sole 502 path.

**Related convention:** Any "save"/persistence endpoint that accepts AI output
from the client must **re-validate** it before insert (independent of the generate
endpoint), since save can be reached directly. A bad client payload there is a
**400** (client error), not a 502 (only fresh AI calls map to 502).
