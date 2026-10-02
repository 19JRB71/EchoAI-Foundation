# I-80 Stage-2 H-regression closure

STAGE-2 IMPLEMENTATION COMPLETE — PRE-MERGE REVIEW REQUIRED

Final verification: **1556/1556 server tests (1534 + 22), 535/535 client tests, 2091/2091 combined**. Zero failures or skipped tests in the final runs. Production client build passed. No merge or deployment authorized.

Resumed from verified GitHub review commit `1a8c2191d4f78fcbeb6c286210c36d866ede1537`, independently cloned into a new directory. Original approved base remains `de8e996f55fd5139a5488f75f7d96078f9dc25c6`. This document supersedes completion-status and suite totals in I80_STAGE2_EVIDENCE.md; that document retains the initial implementation's architectural and preservation evidence.

## Defect exposed and narrow correction

The edit-first concurrent-confirmation regression reproduced HTTP 500 `deadlock detected`. The prepared-content editor locks post then authorization; C1 could acquire them in the opposite order. Six added lines in the existing authorized `controllers/socialController.js` C1 boundary lock the exact owned authorization's post before the existing consent query. No consent algorithm, writer, route or additional production surface changed. The regression was not weakened to accept HTTP 500.

Production remains one writer per store: S2/C1 `confirmFacebookBrandPage`; S3/C3 `selectPage`. Their consent and mutation boundaries remain separate. This correction is entirely within C1's authorized transactional-serialization role.

## Exact test matrix

`F` means `EchoAI/tests/i80.facebookBoundary.test.js`; `J` means `EchoAI/tests/onboardingFirstWin.test.js`. Names below identify executable tests, not conclusions inferred from aggregate test totals. **Result for each row H1–H20: PASS**, verified against the named final log entries or H20's explicit 23/23 bank checksum results. H20 remains historical-bank preservation, never a live-state assertion.

| H | Mandatory case | Exact test name(s) / executable check |
|---|---|---|
| 1 | Wrong-brand first returned Page cannot bind/publish | F: `H: real wrong-brand pages[0] callback cannot bind, schedule or publish; C1 preserves content consent` |
| 2 | Null callback writes S1 only, requires C1 | Same F test; `H: generic context-free OAuth grants S1 only, never borrows an armed authorization or binds a business` |
| 3 | Bound consent uses named Page, not list position | F: `H: exact-bound OAuth schedules only existing C1 binding, ignores pages[0], and nonce replay is inert` |
| 4 | Missing/mismatching named grant fails closed | F: `H: bound callback mismatch/missing grant never replaces existing binding or schedules` |
| 5 | Existing different S2 never replaced | Same F mismatch test; J: `J: a claim NEVER fires when the brand's existing facebook account points at a DIFFERENT Page (page_switched)` |
| 6 | Cross-owner Page absent from grants cannot bind | F: `H: owner and cross-owner collisions rejected; PostgreSQL concurrent C1 attempts have exactly one winner`; `H: real auth remapping never lets a team member confirm C1/C3 or initiate OAuth` |
| 7 | Business A's Page cannot bind B, including concurrency | F: same collision test; `H: C1 and C3 concurrent cross-owner attempts serialize on the same Page` |
| 8 | Singleton/default selectedPageId cannot preselect | F: `H: singleton list/GET/status/skip remain unselected, zero writes and zero provider calls despite defaults`; client SetupAgent.pm8: `I80-C1: %i granted Pages never infer a selection, even with selectedPageId`, expanded for 0, 1 and 2 |
| 9 | GET listing performs no SQL writes or Graph calls | F: same singleton/GET test, snapshots plus provider spy |
| 10 | Default/global/arrival order cannot create/drive S2 | F: same singleton/default test and wrong-brand callback test |
| 11 | Skip unresolved target remains null/pending | F: same singleton/skip test; client AdsDestinationCapture: `single Page: not preselected, NO write until explicit Save` |
| 12 | Omitted grant preserves binding and blocks current/legacy execution | F: `H: grant loss and legacy embedded-token accounts preserve binding but cannot execute`; `H-refresh: transient grant fetch failure preserves S1, S2, S3 and prepared authorization` |
| 13 | Null→C1 preserves consent hash/time/content | F: wrong-brand callback/C1 consent test; J: `J: a confirmed destination claim atomically flips armed→claimed and hands prepared→scheduled NOW` |
| 14 | selectionOnly emits selection without writing | client SetupAgent.pm8: `I80-C1: selectionOnly returns explicit Page identity without any writer`; `I80-C1: occupied Page labelled and disabled; explicit free Page confirmation writes only Store 2` |
| 15 | OAuth tamper/replay/owner/business/session/return-step/expiry | F: `H: OAuth scoped nonce rejects partial/foreign context, mismatch and replay before provider`; `H-expiry-return: expired OAuth nonce and invalid return step fail before provider or writes` |
| 16 | Concurrent confirmation/disarm/expiry/edit cannot publish wrong content | F six generated exact cases: `H-race: disarm before confirmation preserves the consent boundary`, `H-race: disarm confirm-first confirmation preserves the consent boundary`, `H-race: disarm during confirmation preserves the consent boundary`, and the same three names with `edit` replacing `disarm`. J: `J: an EXPIRED authorization is invalidated at claim time and never publishes (reconfirmation required)` and B3 fault rollback test |
| 17 | Serialized writers/removers; unreadable collision rows fail closed | F: `H-corrupt: unreadable ciphertext, invalid JSON and absent Page identity block C1 and C3 without mutation`; concurrent C1/C3 test; `R-S3a/b/c: generic writes rejected, explicit C3 write/removal identity, three stores stay separate` |
| 18 | Reputation uses explicit business Page, never first managed Page | F: `R-REPa/b/c: reputation reads exact C1 Page, unbound and foreign businesses never enumerate or borrow` |
| 19 | S3 save cannot write S2 or grant ad-spend consent | F R-S3a/b/c test; client AdsDestinationCapture R-C3a/b/c/d tests; S1 snapshot and S2 row comparisons |
| 20 | SDS canonical preservation | Banked canonical files checked against their stored SHA-256 manifest, with expected-event history retained. This is a local bank-preservation check, NOT a live SDS recertification or claim about unresolved July provenance. See `I80_H_preservation.json`. |

The original real-endpoint additions are separately covered by F wrong-brand/null callback, exact-bound callback, collision/concurrency, singleton zero-write listing, omitted-grant execution blocking, and consent-preserving C1 continuation. R-S3a/b/c and R-REPa/b/c are real HTTP/auth/PostgreSQL tests. R-C3a/b/c/d remain in the complete client suite.

Exact additional client names, all PASS:
- `R-C3a: Save → dedicated consented writer then reread; no generic or Store-2 write`
- `R-C3b: changing a configured destination confirms Page and URL through the dedicated writer`
- `R-C3c: removal cancellation writes nothing; confirmation names current Page and rereads cleared values`
- `R-C3d: %s readback never reports successful configuration` (mismatch, missing, read failure)
- `R-C3d: removal readback still populated displays explicit failure, not fabricated removal`

H16's exact rollback test is `J (B3, acceptance-critical): a fault between the claim write and the handoff write rolls BOTH back`.

## Race methodology

Race tests use actual HTTP controllers and actual PostgreSQL transactions. A test-only client facade pauses after real row locks are acquired. `pg_stat_activity.wait_event_type='Lock'` establishes that the competing request reached a lock wait before release; arbitrary sleeps are not the proof of contention. No pooled client query method is left monkeypatched. Before-first, confirm-first and mutation-first/in-flight orderings cover both disarm and content edit. Winning confirmation must schedule exactly the originally consented content; a winning mutation prevents S2 creation and leaves the post prepared. Provider calls and publisher sweeps remain zero.

Corrupt cases include unreadable ciphertext, encrypted non-JSON, missing Page identity and explicit null Page identity. A SQL NULL credentials fixture was corrected because the unchanged schema prohibits it; no constraint or DDL was changed.

## Full-suite execution and accounting

The initial all-files parallel run exposed cross-file test interference: the corruption fixture is deliberately globally unreadable, and another process's global publishing sweep can encounter it. The final server run therefore partitions the complete file inventory: all pre-existing server files first, then F alone. No tests are excluded from the combined result. A single-file-serial attempt was stopped for runtime cost and is not counted as a passing full run.

Client default-worker run hit one existing UI test's 5-second timeout under contention. The final complete run uses one worker and a 30-second test timeout; no assertion changed. Partial or failed runs are not represented as passes.

Final arithmetic: server 1534 + 22 = 1556; client 518 + 17 = 535; combined 2091. Logs `I80_H_base-suite.txt`, `I80_H_boundary-final.txt`, and `I80_H_client-final.txt` certify these numbers. The inventory `I80_H_base-test-files.txt` plus `tests/i80.facebookBoundary.test.js` is the complete server file set; no file is omitted or double counted.

Changes against the original approved base: **718/750 production lines**, **920/1100 test lines**. Production delta from reviewed commit is six additions in `controllers/socialController.js`. Test delta is confined to `tests/i80.facebookBoundary.test.js`; cumulative accounting uses git numstat against the original approved base, not summed overlapping diffs. Exact per-file accounting is included in `I80_H_numstat.txt`.

Commands used a sanitized environment, `NODE_ENV=test`, the existing dbGuard preload, a local-only TEST_DATABASE_URL, a localhost PUBLIC_BASE_URL and fake Google OAuth fixture values. Providers were stubbed. Full existing-server partition: `node --require ./tests/dbGuard.js --test --test-concurrency=4` with every filename from the inventory. Boundary partition: same preload, `--test tests/i80.facebookBoundary.test.js`. Client: `npm test -- --maxWorkers=1 --no-file-parallelism --testTimeout=30000`. Build: `npm run build` in the client directory.

## Preserved safety gates

No routes, packages, migrations, additional hosts or other production files changed. Migration inventory remains 148; schema setup was applied only to the disposable local test database on 127.0.0.1:55481. Both SW copies remain v187. Client source and generated build remain byte-identical to the reviewed commit.

No BLACOR OAuth, BLACOR journey advancement, SDS mutation, staging/production action, merge or deployment. The live BLACOR/SDS state is not freshly recertified. Recovery evidence remains an unsatisfied separate MERGE gate. I-79 and I-81 remain deferred.