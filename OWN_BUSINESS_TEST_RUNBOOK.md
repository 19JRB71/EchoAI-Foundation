# OWN_BUSINESS_TEST_RUNBOOK.md — Prompt 026 Phase H (TEMPLATE, Stage-1 draft)

**Status: DRAFT — Stage-1 deliverable (13d). NO step in this document is authorized for execution until the owner approves the runbook and separately authorizes Stage 2.**

One INSTANCE of this runbook is filled per business per environment:
- `SDS-H1` (South Dixie Storage, staging — ongoing-operation track)
- `BLACOR-H1` (Blacor Homes, staging — fresh full onboarding track)
- `SDS-H2` (production — fresh onboarding, after checkpoint + 13b resolution + smoke gate)
- `BLACOR-H2` (production — fresh onboarding, same gates)

Instance header (fill at start): instance id · environment + deployed SHA (from `/api/health`) · operator (OWNER — always the acting/approving human) · observer (Replit, read-only) · start date · I-30/GBP grant status at start (re-checked read-only) · I-29 status (per Section-5 rule: NON-GATING in every state).

## Governing rules (verbatim obligations)

- **R1 ZERO LIVE SPEND:** no intentional advertising spend in either environment. All ad objects PAUSED/$0 under the existing 015 protections at all times. No unpause authorization exists anywhere in 026.
- **R2 CLASSIFICATION BEFORE EXECUTION:** every external/public artifact is classified in this runbook BEFORE the write executes. DEFAULT = TEST (cleanup after evidence per Section 10). KEEP requires EXPLICIT owner designation recorded before the write. An unclassified write is a runbook violation; a TEST artifact left behind is a deviation to report.
- **R4 ONE ATTEMPT** per external action, all providers: failures recorded honestly and STOPPED for owner decision — no retry improvisation.
- **R5:** every external write flows through Section-8 approval (unified inbox 019 or the surface's explicit owner action). Replit never approves, never triggers a provider write, never acts as the owner.
- **R6 AD CHAIN — STRICT I-48 RULE (verbatim):** "026 may exercise AT MOST ONE PAUSED/$0 owner-driven ad chain per environment, and only where the proof matrix genuinely requires it. Because the owner-driven launcher does NOT carry Prompt 033's evidence-gated idempotency (I-48, filed, NOT fixed here), the chain is STRICTLY SINGLE-ATTEMPT: no automatic retry; no second owner click; no retry after timeout; no retry after network failure; no retry after ambiguous provider acknowledgment; no retry merely because the local response is uncertain. ANY ambiguous outcome = STOP AND REPORT, then inspect authoritative provider/evidence state (Ads Manager + ledger + task + proofs) before anything further happens. Ad-chain cleanup is owner-performed in Ads Manager (I-47's documented manual path), deletion responses recorded."
- **Evidence rule:** NO step may be marked passed without its evidence reference (row ids / provider ids / log refs). Echo cross-check recorded where applicable. Deviations → 06_OPEN_ISSUES with D-15 severity. D-23 redaction on all captured material.
- **Blocking bug:** narrow D-43(7) definition; blocked step → STOP the runbook, report, owner authorizes fix, D-18 PR + regression test + D-32 review, deploy verified, resume on the deployed fix.

## Step table format

Every step row records: `# · Actor · Surface · Action · Expected behavior · Evidence source (authoritative) · Pass criterion · R2 classification (n/a for reads) · Result (PASS/FAIL/UNVERIFIED-…/DEVIATION) · Evidence ref (row ids) · Echo cross-check (where applicable)`

---

## PHASE 0 — Instance preflight (read-only; observer may run)

| # | Action | Evidence source | Pass criterion |
|---|---|---|---|
| 0.1 | Record deployed SHA + environment from `/api/health` | health JSON | matches expected deploy |
| 0.2 | Re-check GBP grant status (read-only `google-preflight`) | preflight JSON | recorded (granted → GBP rows armed; not granted → GBP rows = UNVERIFIED-PENDING-I30) |
| 0.3 | Record I-29 status per Section-5 rule | I-29 record | recorded; NON-GATING |
| 0.4 | 015 spend protections: brand daily caps + $25/day platform pilot row present (read-only before/after snapshots) | ad_spend_caps / platform cap row SQL | caps present and enforced posture confirmed; ANY cap bypass = STOP |
| 0.5 | Integration availability table snapshot (FB / Google / email / GBP / skipped: SMS, voice, Stripe-live) | preflight JSON + config | recorded honestly |
| 0.6 | Cross-brand baseline: list brands visible to owner account | app UI + SQL | only expected brands |

## PHASE 1 — ONBOARD (BLACOR-H1; both businesses in H2)

| # | Actor | Action | Expected / Evidence / Pass |
|---|---|---|---|
| 1.1 | OWNER | Create/onboard the business through product surfaces only (no fixtures) | tenant + brand rows created via product paths; evidence: brand row ids |
| 1.2 | OWNER | Sage research (022) with 023 locationHint where the interview supplies context | research draft w/ field provenance + hint persistence; evidence: brand_knowledge_versions row + provenance fields |
| 1.3 | OWNER | Review screen: approve/correct knowledge (011) | corrected fields create new version with frozen provenance; evidence: versions/revisions rows |
| 1.4 | OWNER | Adaptive interview (023): gap-only behavior with reason codes; RE branch live for Blacor (brand_type gating) | only genuine gaps asked, reason codes recorded; evidence: interview session rows |
| 1.5 | OWNER | First win: arm/consent → connect → auto-publish → EXTERNALLY_VERIFIED → exactly-one celebration (024) | armed-authorization record, task spine states, external_proofs row, exactly one celebration row; R2: classify the published artifact BEFORE arming (default TEST) |
| 1.6 | Replit (read-only) | Echo cross-check on 1.5 | Echo narrates only what evidence supports; created_paused never "running"; unverified never "verified" |

## PHASE 2 — OPERATE (all instances)

| # | Actor | Action | Expected / Evidence / Pass | R2 |
|---|---|---|---|---|
| 2.1 | OWNER | Organic FB post via inbox approval (019) → spine → publish → read-back proof | approval record + task states + external_proofs read-back; provider post id | classify BEFORE write (default TEST) |
| 2.2 | OWNER | **Ad chain (AT MOST ONE per environment, R6 verbatim above)** — owner-driven launcher, PAUSED/$0 | all four object ids · verify read-back · proof rows · caps verified before launch step (Phase 0.4 re-snapshot) | TEST; owner-performed Ads Manager deletion at cleanup (I-47) |
| 2.3 | OWNER | Email send via spine ONLY to owner-controlled inbox | Message-ID proof + spine correlation | TEST (inbox message may remain; record) |
| 2.4 | OWNER | GA4 pull (016 proven path) | analytics evidence (property id, real data) — read-only | n/a |
| 2.5 | OWNER | GBP items — CONDITIONAL ON I-30: read-only pulls first; a review REPLY is a provider write requiring Section-8 approval + Section-7 classification | granted → evidence rows; not granted → record UNVERIFIED-PENDING-I30, never simulated | reply (if any): classify BEFORE write |
| 2.6 | OWNER | Any step Echo cannot verify (025 ceilings) | row records the honest "per our records" ceiling — never upgraded | n/a |

## PHASE 3 — VERIFY (all instances)

| # | Action | Pass criterion |
|---|---|---|
| 3.1 | Echo narration cross-check per external step | narration matches evidence exactly |
| 3.2 | Cross-brand negative checks (both directions: brand A surfaces show nothing of brand B) — live 014/D-20 rehearsal | zero leakage; evidence: UI + read-only SQL |
| 3.3 | Ops dashboard tiles reflect the runs (021) | tiles match evidence |
| 3.4 | Registry/agent surfaces honest (025) | no claim beyond evidence |

## PHASE P — PRODUCTION ENTRY (H2 instances only; sequence is mandatory)

| # | Gate | Rule |
|---|---|---|
| P.1 | Owner checkpoint after H1 | H2 never begins on H1's authorization alone |
| P.2 | Production read-only preflight (13b re-run) | every discrepancy resolved or owner-dispositioned; any discrepancy discovered DURING H2 that 13b missed = STOP |
| P.3 | **PRODUCTION SMOKE GATE (6A)** — ONE minimal, reversible, NON-SPEND smoke action through real deployed production machinery, separately owner-authorized | authoritative evidence/read-back + full internal trail; TEST artifact cleaned after evidence; CLEAN pass required; failure or ambiguity = STOP AND REPORT — never a workaround, never a retry |
| P.4 | Owner go/no-go | only then the full H2 matrix |

## PHASE C — CLOSE (per instance)

| # | Action | Rule |
|---|---|---|
| C.1 | Cleanup per R2 classification | provider-side deletion via existing paths where they exist; deletion responses recorded separately (D-24 I); ad chain: owner-performed Ads Manager deletion, responses recorded verbatim |
| C.2 | SURVIVORSHIP CHECK (033 pattern, read-only) | tasks, events, ledger rows, proofs, knowledge versions, campaigns history intact after every cleanup batch; recorded |
| C.3 | KEEP artifacts listed with designation records | in final report |
| C.4 | Real business knowledge created during 026 | REAL DATA — never cleaned up |
| C.5 | Deviations register complete; owner sign-off | required to close the instance |

## Notes-for-027 register

Any step that "feels like it should be a script" is recorded here as a NOTE FOR 027 — never built in 026.
