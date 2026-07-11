---
name: Pooled pg client monkeypatch trap
description: Sabotaging a pool client's query in tests deadlocks later pool.query calls unless un-patched on release
---

Rule: any test that monkeypatches `db.pool.connect` or a checked-out client's
`query` must (1) pass the callback form of `connect(cb)` through untouched —
`pool.query` uses it internally, an async-only wrapper drops the callback and
hangs — and (2) restore the client's original `query` on `release()`, because
the patched client goes back into the pool and is reused by later
`pool.query` calls, which pass an internal callback the async wrapper drops.

**Why:** symptom is node:test "Promise resolution is still pending but the
event loop has already resolved" — a pure-JS deadlock with zero output, very
hard to attribute. Hit while testing the self-review rerun-reset atomicity.

**How to apply:** wrap `client.release` to swap back the real `query`/`release`
before delegating; see tests/selfReview.test.js "rerun reset is atomic" for
the working pattern. Also: `pkill -f <test file>` inside the agent bash tool
matches its own command line and kills itself (exit 143) — kill by ps/awk.
