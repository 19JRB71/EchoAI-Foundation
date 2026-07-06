---
name: EchoAI API quota monitor honesty
description: Persisting third-party quota snapshots without fabricating numbers; Postgres NUMERIC string coercion on the client.
---

# EchoAI API credit/quota monitor (Sentinel)

Hourly sweep checks provider credit levels, upserts one snapshot row per provider,
and alerts the admin owner by voice + push at low (20%) / critical thresholds.
Only providers with a real usage API return numbers (ElevenLabs `/user/subscription`,
Twilio `Balance.json`); OpenAI/Anthropic/Google honestly report `unavailable` /
`not_configured` with no numbers.

## Honesty-rule trap: null→0 fabrication on persist
A `numOrNull(v)` that only did `Number.isFinite(Number(v)) ? Number(v) : null`
silently fabricated `0` for unavailable providers, because `Number(null) === 0`
(finite). That wrote `used/remaining/pct_remaining = 0` into the snapshot table —
a made-up quota level, violating EchoAI's "never fabricate numbers" convention.

**Rule:** any helper coercing optional numerics before a DB write must short-circuit
`null`/`undefined`/`""` to `null` BEFORE `Number()`, or nullable "no data" fields
become 0.
**How to apply:** guard `if (v === null || v === undefined || v === "") return null;`
first. Applies anywhere a provider/API returns null-meaning-"not applicable".

## Postgres NUMERIC comes back as a string
`pg` returns `NUMERIC` columns as JS strings over JSON (e.g. `"99.74"`). Client
formatters that check `typeof x === "number"` silently render nothing. Coerce with
`Number(x)` before `.toFixed()` on any NUMERIC field surfaced to the UI.

## Restart to pick up util changes
The server serves a long-running workflow process; editing a `utils/*.js` file does
NOT take effect until the `artifacts/api-server: EchoAI` workflow is restarted.
A live smoke test right after an edit will show STALE behavior until restart — and
snapshot/upsert rows written by the stale process persist until the next (fixed)
sweep overwrites them.
