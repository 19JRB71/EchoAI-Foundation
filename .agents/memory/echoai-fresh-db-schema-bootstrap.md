---
name: EchoAI fresh-DB schema bootstrap
description: Why a brand-new database (e.g. new Railway/prod deploy) fails until the migration runner applies models/schema.sql first.
---

# Fresh-database bootstrap must apply schema.sql

The production start path is `npm run migrate && node server.js`. `npm run migrate`
= `utils/runMigrations.js`, which applies `models/*.sql` in filename order. The
base schema (`models/schema.sql` — core tables users/brands/subscriptions/etc.,
`pgcrypto`, and the enum types) is separate from the numbered migrations, which
build on top of those base tables.

**The trap:** on a brand-new database (new Railway service, fresh prod DB, any
environment where nothing pre-applied schema.sql), if the runner does NOT apply
schema.sql first, the numbered migrations run against a database with no base
tables and the first one fails → `npm run migrate` exits non-zero → the server
never starts → deploy goes green but the healthcheck fails with no useful runtime
logs (the process dies before printing its "listening" line).

It works fine locally/in CI only because those DBs were bootstrapped with
schema.sql earlier (tests: `tests/setupTestDb.js` applies it explicitly), masking
the bug.

**The rule:** the migration runner must apply `schema.sql` FIRST, then the sorted
numbered migrations, recording schema.sql in `schema_migrations` so it executes
once. This is safe because schema.sql is fully idempotent (every CREATE uses
`IF NOT EXISTS`; enum `CREATE TYPE`s are wrapped in DO-block guards).

**Why:** a "deploys green but healthcheck fails / empty deploy logs" symptom on a
fresh DB is almost always a startup crash in the migrate step, not a port/binding
or missing-API-key issue. Only DATABASE_URL/JWT_SECRET/SESSION_SECRET/
ENCRYPTION_KEY are boot-critical (`config/env.js`); every API key is a feature var
that only warns and degrades to 503 — missing keys never crash boot.

**How to apply / verify:** to reproduce the fresh-DB path locally, create a
throwaway database and run ONLY `node utils/runMigrations.js` against it (do NOT
pre-apply schema.sql) — it must finish with 0 errors and `to_regclass('public.users')`
must be non-null. `config/db.js` builds the pool from DATABASE_URL with NO ssl,
which is correct for Railway's internal `${{Postgres.DATABASE_URL}}` (private
network, no SSL).
