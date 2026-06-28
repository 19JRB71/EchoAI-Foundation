---
name: EchoAI idempotent public record endpoints
description: Race-safe pattern for public "fill once" endpoints (survey responses, etc.) — trust the atomic UPDATE row count, never a stale pre-read.
---

# Idempotent public record endpoints

For public endpoints that fill a pre-created row exactly once (e.g. survey
response submission `POST /api/feedback/r/:responseId`), the **single
conditional `UPDATE ... WHERE <col> IS NULL` is the only source of truth** for
whether this request won the write.

**Rule:** after the UPDATE, branch on `result.rows.length` alone. If the row was
already confirmed to exist and the update touched 0 rows → it was already filled
by a concurrent/earlier request → return **409**.

**Why:** the obvious-but-wrong version reads the row first, then gates the 409 on
that pre-read value (`updated.rows.length === 0 && row.answers`). Under a
concurrent double-submit, both requests read the row as still-NULL; the loser
sees `updated.rows.length === 0` but its stale pre-read says `answers` is empty,
so it falls through and wrongly returns 201/"recorded". A code reviewer caught
this; the fix is to drop the stale pre-read condition entirely.

**How to apply:** any new public "submit once" / claim-a-row flow in EchoAI —
don't combine the atomic guard with a separately-read snapshot to decide
success vs. already-done. Trust the row count from the guarded write.
