---
name: Unique-index migration upgrade trap
description: Why "CREATE UNIQUE INDEX IF NOT EXISTS" can silently fail to enforce uniqueness on upgraded DBs.
---

When an earlier migration created a **non-unique** index, and a later revision
tries to make it unique with `CREATE UNIQUE INDEX IF NOT EXISTS <same_name>`, the
statement is a **no-op** on already-upgraded databases — Postgres sees an index
of that name already exists and skips it, leaving the old NON-unique index in
place. Fresh DBs get uniqueness; upgraded DBs silently do not.

**Why:** this bit the EchoAI Twilio phone-agent inbound routing — uniqueness on
`twilio_config.phone_number` is what makes an incoming dialed number resolve to
exactly one brand. A non-unique index left cross-tenant routing ambiguous on
upgraded installs even though the migration "looked" applied.

**How to apply:** to actually enforce a new constraint on an existing index name,
DROP then recreate:

```sql
DROP INDEX IF EXISTS idx_name;
CREATE UNIQUE INDEX idx_name ON tbl (col);
```

This also makes the migration **fail loudly** if duplicate rows already exist —
which is the desired behavior for cross-tenant collisions (resolve by hand, don't
silently keep ambiguity). Migrations stay idempotent because DROP+CREATE re-runs
cleanly when no duplicates exist.
