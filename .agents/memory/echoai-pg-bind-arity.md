---
name: Postgres bind-parameter arity
description: pg rejects extra bind params; SQL-map runners must bind exactly the placeholders each query uses
---

Rule: when a runner executes queries from a SQL map (e.g. per-metric SQL) with a shared params array, it must bind exactly as many params as the query's highest `$n` placeholder — pg/Postgres hard-errors on extras ("bind message supplies 2 parameters, but prepared statement requires 1").

**Why:** Goal metrics broke ONLY in production: dev brands had no "latest-rate" goals (ctr) whose SQL uses just `$1`, so the always-two-params call never hit the failing path locally. Data-dependent — tests and dev both looked green.

**How to apply:** derive arity from placeholders (`sql.matchAll(/\$(\d+)/g)`) and slice the params array; keep a regression test that stubs db.query and asserts params.length == highest placeholder for every entry in the SQL map. Also: for prod-only 500s with generic messages, an admin-only `detail: err.message` on the 500 response (gated on `req.user.isPlatformAdmin`) is a fast, safe way to read the real error off Railway.
