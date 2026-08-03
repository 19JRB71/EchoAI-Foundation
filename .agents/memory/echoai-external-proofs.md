---
name: EchoAI external_proofs evidence substrate
description: Platform-wide immutable provider-evidence table (Prompt 006) — design rules for writers and future proof runs.
---

# external_proofs (Prompt 006)

- Rows written ONLY from a real provider response (failed call = zero rows); evidence redacted via utils/externalProofs.js before persisting (credential keys word-boundary matched — plain `token`/`auth` substring regexes false-positive on `author`/`action`).
- (run_key, provider, action) unique = idempotency; writer returns existing row with created:false.
- **Append-only trigger vs FKs:** an immutable table must NOT have FK columns with ON DELETE SET NULL/CASCADE — the FK action is an UPDATE/DELETE and the trigger blocks it, which blocks deleting the referenced tenant. Tenant scope columns are plain UUIDs, no FK.
- **Why:** evidence must outlive tenants; user-deletion cascades otherwise fail with the append-only exception.
- Double-post safety: the proof post is claimed pre-publish via social_posts.proof_run_key (unique partial index, get-or-create). Never decide "already published?" from proof rows alone — a crash between publish and proof write would double-post.
- Two-stage live-action control: read-only preflight endpoint + STOP for owner approval before any provider mutation; publish/readback/delete are separate proof rows (failed stage = no row, report livePostId + cleanupIncomplete).
- Tests cleanup: disable trg_external_proofs_immutable, delete, re-enable.
