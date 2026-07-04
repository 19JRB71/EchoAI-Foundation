---
name: EchoAI AI timeout + retry (config/anthropic.createMessage)
description: How AI-heavy generations get longer timeouts + retries, and why that's lease-safe in the setup agent.
---

# EchoAI AI timeout + retry

`config/anthropic.js` exports `createMessage(params, { timeout, attempts, label })`
plus `DEFAULT_AI_TIMEOUT_MS` (2m), `HEAVY_AI_TIMEOUT_MS` (5m), `DEFAULT_AI_ATTEMPTS`
(3), and `isTransientAiError`. It wraps `anthropic.messages.create` with a
per-request timeout and its own exponential-backoff retry on **transient** upstream
errors only (timeouts / 429 / 5xx / "overloaded"); deterministic 4xx (auth/quota)
fail immediately. AI-heavy multi-part JSON generations (e.g. the email drip
sequence) use the HEAVY timeout + 3 attempts.

**Do NOT re-enable the SDK's own retry on these calls.** `createMessage` passes
`{ maxRetries: 0 }` per request so the wrapper is the *single* source of retry.
**Why:** the client default is `maxRetries: 2` with a ~10m default request
timeout; stacking that under our loop would double-retry and blow up worst-case
latency (was ~30m before this wrapper existed).

**Retry only wraps the API call, not the JSON validation.** Malformed AI output
is still detected *after* `createMessage` returns (thrown with `err.aiInvalid`)
and maps to **502** — it is intentionally NOT retried. If you ever want to
re-roll on malformed output, wrap the whole generator, not just the API call.

**Long AI calls are lease-safe in the setup agent.** The setup runner holds a
300s execution lease renewed by a **60s-interval `setInterval` heartbeat**, not a
between-steps renew. Because the heartbeat is timer-based, it keeps firing during
an `await`ed AI call, so a step blocking for minutes (even worst-case 3×5m)
**won't lose the lease**. Don't "protect" the runner by adding a short per-step
timeout — that would defeat the point and reintroduce the drip-step failures.

**The drip generator is shared** by the setup agent step AND the synchronous
`POST /api/email-marketing/generate-drip` UI route, so the heavy timeout applies
to both; the sync route's worst case is still lower than the pre-wrapper SDK
default. If interactive latency ever matters, thread a lighter AI profile through
the controller rather than shrinking the setup-agent profile.
