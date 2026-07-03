---
name: Node test runner preload
description: How to run setup code before test files (and before config/db) in node:test
---

`node --test <globs>` executes **each test file in a separate child process**.
Flags placed in the parent's `execArgv` — notably `--require <cjs>` and
`--import <esm>` — propagate to those child processes and run **before** the test
file is loaded.

**Why:** EchoAI's onboarding tests need a DB-safety guard to run before
`config/db.js` opens a pool (it reads `DATABASE_URL` at require time). Requiring
the guard from inside a test/helper is too late when another module (e.g. a
controller) pulls in `config/db` first. Preloading via `--require` in the `test`
npm script guarantees the guard runs first, in both the orchestrator process and
every child.

**How to apply:** put shared pre-test setup (env overrides, hard guards) in a
small module and reference it as `node --require ./path/guard.js --test "…"`.
`process.exit(1)` inside that preload fails the run fast. Verify propagation with
a throwaway preload that sets an env var and a test that asserts it.

**Gotcha — child processes inherit the parent's mutated env.** If the preload
*rewrites* an env var (e.g. redirects `DATABASE_URL` to a test DB), that mutated
value is inherited by every child, so the preload runs again in the child and can
re-derive from the already-changed value (double `_suffix_suffix`). Guard the
rewrite with a marker env var: set `__X_DONE=<value>` after the first rewrite and
short-circuit on it. `npm`'s `pretest` script runs in a *separate* process before
the test process, so it does NOT see that marker — recompute there independently.

**Physical DB isolation pattern (EchoAI onboarding suite).** Destructive tests
must never share tables with real data. The robust guarantee is a *separate
Postgres database* (distinct namespace), not naming heuristics: derive
`<db>_setup_test`, create it via the real DB as a maintenance connection
(`CREATE DATABASE` only), apply `models/schema.sql` (the base tables the numbered
migration runner deliberately skips) + migrations, then rewrite `DATABASE_URL`.
Still fail fast on production signals (NODE_ENV, REPLIT_DEPLOYMENT, prod-named
host/db, equality with PROD*_DATABASE_URL).
