---
name: EchoAI social connection re-verify sweep
description: Semantics of the periodic credential re-verify sweep and the calendar "needs attention" banner.
---

# Social connection re-verify sweep

The scheduler re-verifies every stored social connection (real brands only) and reconciles `connection_status`; the calendar views render a "needs attention" banner (with Reconnect buttons via the shared `openReconnect` wiring) for any account in `'error'`.

**Rules:**
- Only HARD verification failures (auth rejections, missing credential fields, undecryptable ciphertext) flip a row to `'error'`. Transient failures (network blip / 429 / 5xx — same `isTransientPublishError` classifier as publishing) never flip a working connection: false alarms would train owners to ignore the banner.
- Success on a previously-`'error'` account restores it to `'connected'` (owner may reauthorize platform-side without re-entering credentials).
- Both flips are status-guarded in the WHERE clause (`<> 'error'` / `= 'error'`) so an owner reconnecting mid-sweep can't be clobbered by a stale result.
- Per-row work goes through `module.exports.reverifyAccountRow` so the sweep-guard seam is stubbable in tests (standard sweep-guard pattern).
- A real `connected → 'error'` flip (guarded UPDATE rowCount > 0) push-alerts the brand owner via the shared failed-send helper (per-account tag, reconnect deep link to the social calendar). A 0-row flip returns `"already-flagged"` — no re-alert on repeated sweeps over a still-broken account; transient skips and demo brands stay silent.

**Why:** the banner warns owners BEFORE the next scheduled post fails; a sweep that flips on transient errors would surface bogus warnings, and an unguarded flip could resurrect an error state the owner just fixed.

**How to apply:** any new code that touches `social_accounts.connection_status` (or adds alerting on top of the sweep) must alert only on real `connected → 'error'` transitions (branch on UPDATE row count), keep transient-skip silent, and preserve the status guards.
