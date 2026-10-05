# I-80 R1 — C1 accounting and C2 repetition evidence

## Authority and immutable inputs

- Approved Stage-2 base: `de8e996f55fd5139a5488f75f7d96078f9dc25c6`.
- Prior review commit: `1a8c2191d4f78fcbeb6c286210c36d866ede1537`.
- Pinned implementation / required evidence-child parent: `f55c294be47261837a2b7b001d8648bf39a812a6`.
- Pinned implementation tree: `52bcd3de5d245a6b24dbe457c3e1a105f6a00388`.
- Fresh independent clone checked out detached at exactly that commit/tree before execution.
- This work adds evidence only. No implementation, test source, package, route, migration, bundle or service-worker edits. C3 is already closed by the architect; it is not reopened here.

Role labels below describe the standing September 24 / September 28 / September 30 boundaries as retained in the architect-approved pinned implementation. They are audit descriptions, not new authority or purported verbatim quotations. September 28 expressly separates the C1 Store-2 writer, C3 Store-3 mutation boundary, generic-brand bypass closure and explicit-bound reputation reads. September 30's carried client scope covers the existing picker, C3 capture and thin API contracts; the October 5 approval is pinned to the exact implementation above. Current authorization permits only evidence under review_package/docs/.

## C1: distinguish the two comparisons

The **final 13-file change** is `1a8c2191..f55c294b`: one production file, one test file, eleven evidence files. It is not the complete Stage-2 change from the original approved base. The **cumulative Stage-2 inventory** is `de8e996f..f55c294b`: 45 files, comprising nine production source files, fourteen test files, five explicitly excluded mechanical artifacts, and seventeen evidence files.

Both comparisons were generated directly with `git diff --numstat <base> <pin>`, not inferred from prior reports or added across overlapping diffs. In the table, “Stage-2” means the original approved base; “final change” means the prior review commit. Plus/minus are added/deleted lines, and ceiling cost is additions PLUS deletions, never net lines.

## Final 13-file accounting

Every row's determination covers **every hunk** of that file's cumulative Stage-2 diff and its final-change diff. Evidence files have one all-added hunk, with no application code effect.

| Exact path | Class | Stage-2 + / − | Final change + / − | Authorized role | Hunk determination |
|---|---|---:|---:|---|---|
| `EchoAI/controllers/socialController.js` | production | 111 / 65 | 6 / 0 | Existing C1 sole Store-2 confirmed writer; exact grant/token resolution including legacy rows; serialized removal and access-loss blocking. Final six lines align prepared-post/auth lock acquisition with the existing content editor. | PASS — every hunk belongs to C1 destination safety, its execution consumers, or required transaction/error handling; no role-external hunk. |
| `EchoAI/tests/i80.facebookBoundary.test.js` | test | 498 / 0 | 147 / 4 | Real HTTP/auth/PostgreSQL H, R-S3 and R-REP acceptance coverage; isolated fixtures, provider spies and actual lock-backed consent races. Final change adds corrupt-record, transient refresh, nonce-expiry/return-step and six race cases. | PASS — every hunk is test setup, cleanup or explicit destination/consent regression evidence; no production writer or unrelated test behavior introduced. |
| `review_package/docs/I80_STAGE2_H_CLOSURE.md` | evidence | 75 / 0 | 75 / 0 | Mandatory H mapping, defect explanation, totals, boundaries and merge-gate disclosure. | PASS — every hunk is review documentation; no role-external hunk. |
| `review_package/evidence/I80_H_SHA256SUMS.txt` | evidence | 12 / 0 | 12 / 0 | Reproducible integrity checks for reviewed source and evidence. | PASS — every hunk is checksum evidence; no role-external hunk. |
| `review_package/evidence/I80_H_base-suite.txt` | evidence | 2541 / 0 | 2541 / 0 | Complete existing-server partition results, 1534 passes. | PASS — every hunk is recorded test output; no role-external hunk. |
| `review_package/evidence/I80_H_base-test-files.txt` | evidence | 167 / 0 | 167 / 0 | Exact existing-server partition inventory, excluding only the separately run boundary file. | PASS — every hunk is test inventory; no role-external hunk. |
| `review_package/evidence/I80_H_boundary-final.txt` | evidence | 47 / 0 | 47 / 0 | Final boundary run, 22 passes, including all six races. | PASS — every hunk is recorded test output; no role-external hunk. |
| `review_package/evidence/I80_H_build.txt` | evidence | 88 / 0 | 88 / 0 | Client production-build verification. | PASS — every hunk is recorded build output; no role-external hunk. |
| `review_package/evidence/I80_H_client-final.txt` | evidence | 827 / 0 | 827 / 0 | Complete client-suite result, 535 passes. | PASS — every hunk is recorded test output; no role-external hunk. |
| `review_package/evidence/I80_H_db-setup.txt` | evidence | 152 / 0 | 152 / 0 | Isolated test-database setup and unchanged 148-migration inventory. | PASS — every hunk is setup output, not new DDL or migration source; no role-external hunk. |
| `review_package/evidence/I80_H_deadlock-before.txt` | evidence | 45 / 0 | 45 / 0 | Preserved pre-fix concurrency failure; not counted as a post-fix pass. | PASS — every hunk is red-test output; no role-external hunk. |
| `review_package/evidence/I80_H_numstat.txt` | evidence | 34 / 0 | 34 / 0 | Prior cumulative accounting snapshot. Its omission of then-untracked H evidence is explicitly superseded by this complete accounting. | PASS — every hunk is historical accounting evidence; its limitation is disclosed, not treated as a complete final inventory. |
| `review_package/evidence/I80_H_preservation.json` | evidence | 143 / 0 | 143 / 0 | Historical bank checksum comparison, 23/23; not live SDS certification. | PASS — every hunk is preservation evidence; no live mutation or role-external hunk. |

The two source rows in this 13-file table are not added again to the cumulative totals below. The eleven H-closure evidence files are all enumerated here; none is omitted merely because it was previously untracked.

## Cumulative production-source reconciliation

Paths below are relative to `EchoAI/`. Every hunk was reviewed against the named role; necessary imports, exports, error paths and transaction cleanup are included, not excluded as “overhead.”

| Path | + | − | Cost | Authorized role / determination |
|---|---:|---:|---:|---|
| `controllers/facebookOAuthController.js` | 71 | 118 | 189 | PASS — scoped owner/nonce/expiry context; no automatic Page destination; grant-only refresh; exact prior consent delegates to C1; destination-null stays pending; zero-write listing; separate C3 consented write/removal boundary. All hunks within role. |
| `utils/onboardingFirstWin.js` | 96 | 50 | 146 | PASS — shared context/grant/collision validation and serialization; remove private Store-2 creation; scoped claim preserves consent and reuses C1 transaction. All hunks within role. |
| `controllers/socialController.js` | 111 | 65 | 176 | PASS — C1 confirmed Store-2 writer, exact grant/legacy execution guard, removal serialization, access-loss behavior and six-line lock-order correction. All hunks within role. |
| `controllers/brandController.js` | 4 | 0 | 4 | PASS — one property-presence guard rejects generic Store-3 writes AND clears, including naming variants. No general brand refactor. |
| `controllers/reputationController.js` | 9 | 30 | 39 | PASS — replace first-managed-Page enumeration with owned business's explicit Store-2 Page and grant validation; pass brandId at caller. No reputation redesign. |
| `client/src/onboarding/SetupAgent.jsx` | 29 | 3 | 32 | PASS — preserve scoped OAuth return context, reject wrong-business/session return, carry exact authorization and invoke C1 after explicit picker selection. All hunks within role. |
| `client/src/sections/social/ConnectedAccounts.jsx` | 12 | 13 | 25 | PASS — existing picker has no inferred selection, disables occupied/unavailable Pages and retains selectionOnly without a writer. All hunks within role. |
| `client/src/onboarding/guided/AdsDestinationCapture.jsx` | 55 | 38 | 93 | PASS — existing C3 flow explicitly confirms save/change/removal, uses dedicated Store-3 writer and authoritative readback, removes singleton preselection. All hunks within role. |
| `client/src/api.js` | 7 | 7 | 14 | PASS — thin existing-route request contracts carry brand, consent and return context; no new route or behavior outside these contracts. |
| **Total** | **394** | **324** | **718 / 750** | **554 server + 164 client; no unauthorized file or role-external hunk found.** |

## Cumulative test-source reconciliation

All paths below are relative to `EchoAI/`. PASS in each row means every changed hunk is within the stated testing role; these are accounting determinations, not claims of new full-suite executions.

| Path | + | − | Cost | Authorized role / determination |
|---|---:|---:|---:|---|
| `client/src/onboarding/SetupAgent.pm8.test.jsx` | 82 | 3 | 85 | PASS — pending/wrong-business return, explicit zero/one/many/occupied picker, selectionOnly and C1-only confirmation. |
| `client/src/onboarding/SetupAgent.test.jsx` | 18 | 1 | 19 | PASS — OAuth context for owned/foreign/absent/reconfirmation/error authorization; existing mocks adapted to scoped initiation. |
| `client/src/onboarding/guided/AdsDestinationCapture.test.jsx` | 104 | 26 | 130 | PASS — R-C3 consented save/change/removal/readback, no generic or Store-2 write, no singleton inference; adapt old split-write expectations to dedicated atomic writer. |
| `test/deliveryCrons.test.js` | 8 | 1 | 9 | PASS — publishing fixtures now supply explicit Page identity and current grant instead of legacy-token bypass. |
| `test/facebookAccountsContract.test.js` | 5 | 1 | 6 | PASS — zero-write candidate listing returns no selected Page and exposes availability truth. |
| `test/facebookUnified.test.js` | 24 | 7 | 31 | PASS — exact grant, explicit C1 intent and transaction-aware stubs; preserve Page-ID-only credentials and truthful reconnect errors. |
| `test/setupAgent.owneraction.test.js` | 8 | 8 | 16 | PASS — generic Store-3 write and clear attempts rejected; row remains unchanged. |
| `test/socialMediaUpload.test.js` | 6 | 0 | 6 | PASS — existing publisher test fixture supplies current grant and explicit binding. |
| `test/socialReverify.test.js` | 6 | 0 | 6 | PASS — reverification fixture supplies current grant and explicit binding. |
| `tests/externalProofs.test.js` | 7 | 1 | 8 | PASS — external-proof fixture supplies current grant and explicit binding; no live certification implied. |
| `tests/i80.facebookBoundary.test.js` | 498 | 0 | 498 | PASS — new isolated real-endpoint acceptance file, including the final six lock-backed races. |
| `tests/onboardingFirstWin.test.js` | 54 | 30 | 84 | PASS — scoped confirmed fixtures, explicit no-private-binding assertions and retained expiry/hash/atomic rollback/parallel-claim coverage. |
| `tests/taskSpine.test.js` | 6 | 1 | 7 | PASS — task-spine fixture supplies current grant and explicit binding. |
| `tests/tenantIsolation.background.test.js` | 11 | 4 | 15 | PASS — per-tenant exact grant and Page fixture replaces legacy-token bypass. |
| **Total** | **837** | **83** | **920 / 1100** | **686 server + 234 client; no unrelated test-source changes.** |

## Explicitly excluded mechanical artifacts

These five files are generated/release mechanics authorized outside the production ceiling; their costs are not silently discarded. They remain byte-identical to the pinned implementation throughout this evidence work.

| Exact path | + | − | Role |
|---|---:|---:|---|
| `EchoAI/client/dist/assets/index-Bjm_z3-E.js` | 154 | 0 | Replacement built client bundle. |
| `EchoAI/client/dist/assets/index-qsmk6fKo.js` | 0 | 154 | Superseded built client bundle removed. |
| `EchoAI/client/dist/index.html` | 1 | 1 | Mechanical new bundle reference. |
| `EchoAI/client/dist/sw.js` | 1 | 1 | Built service worker v187. |
| `EchoAI/client/public/sw.js` | 1 | 1 | Source service-worker cache version v187. |

The remaining six older evidence files (in addition to the eleven final H files above) are I80_STAGE2_EVIDENCE.md and I80_STAGE2_LOCAL_DIST_SHA256SUMS.txt, I80_STAGE2_client-final-build.txt, I80_STAGE2_client-final-full.txt, I80_STAGE2_db-setup.txt and I80_STAGE2_server-final-full.txt. The machine accounting companion records their exact full paths and numstat too. Cumulative evidence cost is 7797 added / 0 deleted, excluded from source ceilings.

## C2: final race matrix repeated without repair or retry

`I80_R1_RACE_REPETITION.txt` is the single durable repetition-log artifact. It records Node and PostgreSQL versions, sanitized local test-DB configuration, immutable source identities, exact command, every case outcome, case duration, run start timestamp and wall-clock duration for all twenty runs.

Result: **20/20 consecutive runs; 120/120 individual cases; zero failures; zero flakes; zero retries.** All six exact names run once in each iteration:

1. `H-race: disarm before confirmation preserves the consent boundary`
2. `H-race: disarm confirm-first confirmation preserves the consent boundary`
3. `H-race: disarm during confirmation preserves the consent boundary`
4. `H-race: edit before confirmation preserves the consent boundary`
5. `H-race: edit confirm-first confirmation preserves the consent boundary`
6. `H-race: edit during confirmation preserves the consent boundary`

The implementation and test source were unchanged. The harness checked source against the pinned commit before each run. Each run was a fresh Node invocation of the existing file filtered by `^H-race:`; no replacement tests, test edits, extra assertions, warm-up test run or failed-attempt reruns occurred. Other test cases were not requested. No full-suite rerun was performed.

The local disposable DB used unchanged pinned schema/migrations (148), with existing fixture cleanup and no resets between runs. Provider calls remain stubbed by the pinned test file. No live, staging or production database was connected, and no new DDL/migration source was authored.

## Disposition

C1 accounting PASS; C2 repetition PASS. Source ceilings remain **718/750** and **920/1100**. The evidence-only child must have exactly the pinned parent and may add files only under review_package/docs/. The external post-push receipt identifies the resulting child commit/tree and independently checks that condition; no circular self-referential commit identity is claimed here.

No merge, deployment, BLACOR OAuth/advancement, SDS mutation, production action or recovery operation performed. Recovery remains a separate merge gate.
