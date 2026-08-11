---
name: EchoAI evidence accounting
description: Where owner-report numbers must come from, and the first-win retained-evidence lineage.
---

**Rule 1:** Any test count or file inventory quoted in an owner acceptance report must be measured in the D-37 fresh clone of the exact verified SHA — never from the dev-workspace workflows. **Why:** the workspace tree silently drifts behind staging (Prompt-025 acceptance was held because a workspace run reported 410/38 while the real tip held 430/41). **How to apply:** run the suite inside the fresh clone and cite its HEAD SHA next to the numbers.

**Rule 2:** `honestStatus.forFirstWin` narrates a verified first win through TWO deterministic lineages: consumed authorization → post → task → proof, and (fallback) retained `onboarding_first_win_celebrations.proof_id → external_proofs`. **Why:** the accepted Prompt-024 cleanup deletes authorization rows; celebration+proof are the retained records. **How to apply:** never add brand-level "any proof" joins; if celebration owner rows are deleted, the evidence is orphaned — report it, never re-attach it to another account.

**Rule 3:** Any authored text (post copy, email, etc.) interpolated into Echo's system prompt must neutralize `[[` → `[ [` and carry an untrusted-data fence sentence, mirroring the inbox-context pattern.
