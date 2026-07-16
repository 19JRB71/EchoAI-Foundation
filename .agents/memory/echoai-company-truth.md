---
name: EchoAI Company Truth (Layer 1)
description: Sage versioned Company Intelligence Report — approval gate, lifecycle indexes, Layer-2 consumption rule
---

- Lifecycle enforced by partial unique indexes on company_truth_reports: at most one `generating`, one `pending_approval`, one `approved` per brand. Generate claims via INSERT (23505 → 409); failed generation DELETEs the claim; finalize/approve are single transactions (supersede old, row-count flip; 0 rows → 409).
- **Approval gate is absolute:** `getApprovedCompanyTruth(brandId)` (controllers/companyTruthController.js) is the ONLY read path for downstream consumers (Layer 2 prompt injection); it returns approved rows only, null otherwise — never drafts/pending.
- Section contract is defined twice: `SECTION_KEYS` in utils/companyTruth.js and `TRUTH_SECTIONS` in Sage.jsx — must stay in sync. `missingInformation` may be empty; all other sections must be non-empty (aiInvalid → 502).
- Research flow: requestResearch stores a note on the pending draft; regeneration consumes then nulls it.
- **Why:** the pole-barn-vs-storage misclassification incident — the report must state excluded categories and missing info explicitly, and nothing reaches AI prompts until the owner approves.
- **How to apply:** Layer 2 injects only via getApprovedCompanyTruth (treat null as "no truth yet"); Layer 3 department profiles derive from the approved report, same gate.
