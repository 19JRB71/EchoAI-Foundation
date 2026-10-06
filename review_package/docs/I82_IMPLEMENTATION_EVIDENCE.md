# I-82 — C3 occupied-Page repair: pre-merge evidence

## Scope and provenance

This is the narrowly authorized client corrective, not a reopening of I-80.
No merge or deployment is authorized or performed.

- Fresh GitHub staging clone, detached and verified at base
  `717a963ff7bf03a34832c9efcbf47e42a82987a7`.
- Base tree: `e1876bf1048a508933e1e98ae04fc86d32c1c655`.
- Repository: `19JRB71/EchoAI-Foundation`.
- Review branch: `i82-c3-live-verification-repair`.
- Work was performed in the isolated review checkout, not the drifted main workspace application.
- Root and client lockfiles matched the previously installed dependency trees before copying dependencies. No dependency or lockfile changes.
- This document belongs inside the implementation commit. The final packaging receipt supplies that containing commit/tree and the full changed-blob inventory; a commit cannot embed its own eventual hash.

## Authorized production changes

| File (under EchoAI/client/src/onboarding/) | Added | Deleted | Cumulative | Authorized role |
|---|---:|---:|---:|---|
| guided/AdsDestinationCapture.jsx | 18 | 10 | 28 | Occupancy-disabled rendering, owning-business label, selectable-count logic and reconnect empty-state affordance |
| SetupAgent.jsx | 14 | 7 | 21 | Session-preserving C3 reconnect/return wiring only |
| **Total** | **32** | **17** | **49 / 150** | No other hand-edited production file |

Accounting counts additions plus deletions, not net lines.

### Why SetupAgent is required

Base `SetupAgent.jsx:832–846` rejects OAuth initiation without
`needsConnection.key`. The C3 missing_ad_destination screen is an ownerAction
pause, so its reconnect callback cannot work merely by exposing the child
button. The child has neither the session-return machinery nor authority to
alter that parent callback.

The existing callback now recognizes that C3 pause, supplies
`returnStep: "ads_destination"` with the exact active brand/session, and excludes
authorizationId. Excluding publish consent from this grant-refresh handoff is
essential: the accepted server still supports a separate, explicitly
destination-authorized first-win flow. No server consent semantics changed.
The non-C3 connection path retains its existing authorization selection.

### Load-bearing immutable source anchors

Git blob IDs identify the exact file bytes independent of branch movement:

- `AdsDestinationCapture.jsx`, blob
  `0c35f123ab253ab80127665870c054e3bb7f7aac`:
  selectable Pages at 48–49; brand-scoped account listing at 99–102;
  unavailable-choice submission check at 138–141; reconnect and occupied-option
  rendering at 247–302; Save availability at 321–329.
- `SetupAgent.jsx`, blob
  `99fecea8e8e55d717e18d4f8b91f92125b37d973`: C3 context, return step and
  grant-only authorization handling at 832–858.
- Existing session/bootstrap validation and resumption at
  `SetupAgent.jsx:605–643` remain unchanged. OAuth carries brand/session/return
  intent; an unconfigured C3 step re-renders the same owner-action pause.
- Full SHA-256 and Git blob accounting is in
  `review_package/evidence/i82/accounting.json`.

## Behavior delivered

1. Occupied Pages remain visible but have a disabled radio, an unavailable
   selection guard and an unchecked state. Their owning business is labeled.
2. Zero selectable Pages, including an all-unavailable list, gets the existing
   reconnect affordance and disabled Save. Occupied entries remain visible.
3. A mixed list offers only available entries; no reconnect prompt is shown.
4. Listing is scoped to the active business so its own existing destination is
   not misclassified as another business's occupied Page.
5. C3 reconnect preserves brand/session/return intent and carries no publish
   authorization. A granted Page remains an unselected candidate.
6. The existing separate Store-2 and Store-3 writers and 409 guard are untouched.

## Exact regression map

Client file C: `EchoAI/client/src/onboarding/SetupAgent.i82.test.jsx`.
Server file S: `EchoAI/tests/i80.facebookBoundary.test.js`.

| Rule | Exact test name(s) | Result |
|---|---|---|
| R-LV1 | C: `R-LV1 occupied Page is disabled, labeled, and cannot be chosen or saved` | PASS |
| R-LV2 | C: `R-LV2 zero selectable Pages has the same reconnect affordance (%j)` (empty and occupied-only cases) | PASS, 2 cases |
| R-LV3 | C: `R-LV3 C3 reconnect carries session/return step, excludes stale publish consent, and resumes C3`; S: `R-LV3/4/5/6: C3 grant-only OAuth returns to the same session, rejects occupied Page, preserves SDS bytes` | PASS |
| R-LV4 | C: `R-LV4 newly granted candidate is unselected and makes no destination write`; the same S regression | PASS |
| R-LV5 | The same S regression: real authenticated HTTP POSTs to C3 and C1 both reject the occupied Page with 409 | PASS; protected server blobs unchanged |
| R-LV6 | The same S regression plus S: `R-LV6 carried SDS projection hashes remain byte-identical to the pre-live bank` | PASS; preservation scope below |
| R-LV7 | C: `R-LV7 mixed list permits only the available Page and has no reconnect prompt` | PASS |

The real-endpoint test uses local Express/auth/controllers and isolated
PostgreSQL. Facebook responses are stubbed; publishing/verification methods
are blocked, and scheduler sweep calls are counted. It creates an unrelated
armed authorization to prove the C3 refresh does not borrow it. It compares the
entire fixture brand row and posting row, including encrypted bytes, before and
after OAuth/listing/rejected submissions. The setup-session row is also unchanged.

### Test line accounting

| File | Added | Deleted | Cumulative |
|---|---:|---:|---:|
| EchoAI/client/src/onboarding/SetupAgent.i82.test.jsx | 101 | 0 | 101 |
| EchoAI/tests/i80.facebookBoundary.test.js | 52 | 0 | 52 |
| EchoAI/client/tests/browser/i82.html | 1 | 0 | 1 |
| EchoAI/client/tests/browser/i82.jsx | 31 | 0 | 31 |
| **Total, including browser harness** | **185** | **0** | **185 / 250** |

The browser harness is test-only, imported by no production entry and absent
from the production build. It imports the actual modified components, replaces
API methods with local fixtures and returns a local URL rather than Facebook.

## Verification results and arithmetic

| Suite | Before | Added | After |
|---|---:|---:|---:|
| Server | 1,556 | 2 | 1,558 |
| Client | 535 | 6 | 541 |
| **Combined** | **2,091** | **8** | **2,099** |

No final failures, cancellations or skips.

- Targeted server boundary suite: 24/24.
- Targeted client host + capture suites: 28/28.
- Final client suite: 54 files, 541 tests.
- Production client build: PASS. Existing large-bundle warning is retained.
- Browser: PASS at desktop 1366×900 and mobile 390×844, local seam only.
  Disabled SDS, reconnect context, return panel, unselected new candidate and no
  horizontal clipping verified. `browser-result.json` retains the observations.
- Browser caveats: one unspecified-resource 404 was observed. With a selectable
  Page present, Save retains the existing enabled-before-selection behavior;
  existing validation rejects an empty selection/URL without a write. No browser
  Save or Skip was clicked. This is not real OAuth or live-owner verification.

Raw before/after, targeted and build outputs are under
`review_package/evidence/i82/`.

## DDL and migration proof

- Shipped inventory is exactly **148 SQL files: schema.sql + 147 numbered files**.
- Models, schema, migrations and routes have zero diff against the pinned base.
- No new DDL occurs in any added production or test code.
- Existing harness DDL alone executed in isolated disposable test databases.
  `setupTestDb.js`, `dbGuard.js` and `runMigrations.js` are byte-unchanged.
- Initial runs passed on the pre-existing disposable database, whose ledger had
  a legacy extra `125_facebook_ad_object.sql` entry. Those logs are preserved as
  `server-*-legacy-db.txt`; that 149-entry ledger is not represented as 148.
- The first fresh-database baseline run passed 1,555/1,556: its source export
  omitted the repository-root TASK_SPINE_GUIDE.md required by one existing
  source-contract test. The unchanged guide was restored from the pinned Git
  object before the canonical rerun. The failed attempt is retained as
  `server-before-missing-guide.txt`; no application or test was altered to fix it.
- For canonical before/after server evidence, the unchanged harness creates a
  separate fresh derived test database using the existing disposable database
  as its maintenance connection. No new CREATE/ALTER implementation was added.
  `test-db-inventory.txt` records the canonical database and ledger count.
- No database statement was sent to staging or production during this repair.

## Server immutability

`facebookOAuthController.js` is completely untouched, including return routing.
Its existing OAuth state already carries the C3 return context. No server file,
validator, ownership rule, Store-2 writer, Store-3 writer, route or consent
semantics changed.

`accounting.json` records equal base/current Git blobs for that controller,
`socialController.js`, `brandController.js`, `onboardingFirstWin.js`, and the
existing test/migration harness. R-LV5 exercises the unchanged 409 through real
local HTTP boundaries, not a mocked response.

## Mechanical outputs, excluded from production ceiling

- `EchoAI/client/public/sw.js`: v187 → v188 (+1/−1).
- `EchoAI/client/dist/sw.js`: identical regenerated v188 copy (+1/−1).
- `EchoAI/client/dist/index.html`: regenerated bundle reference (+1/−1).
- Removed `EchoAI/client/dist/assets/index-Bjm_z3-E.js` (−154).
- Added `EchoAI/client/dist/assets/index-NzPpB4uz.js` (+154).
- CSS and other built assets unchanged.

Bundle SHA-256:
`c9539fc223bb8c90dca56d8e39ec47266ff48ddeaa551a27801b34a097374a73`.

Both SW copies have SHA-256:
`895afbfc34030b5fc995faf9af0d168e9c6977bcf88dd31feecc19ae6bbb0c85`.

All lockfiles are byte-unchanged. Host scan is recorded in accounting.json:
npm tarballs use registry.npmjs.org; other observed URLs are existing funding,
source and documentation links. No new lockfile host.

## SDS preservation and evidence limits

Carried pre-live projections retain these exact SHA-256 hashes:

- SDS brands:
  `e4681c8abdc8799aaf7c931639edd587cbcb004935a4cd4ddb156a06d3a95ea8`.
- SDS posting-binding projection:
  `9d4a1f34ea95bb6d07bd8ba73cd7177e787cd726fa6ca405377a51441ed663e6`.

These are the banked non-secret projections carried from the read-only
investigation, not a new live snapshot. The historical posting projection does
not contain ciphertext bytes, so it cannot prove historical full ciphertext
equality. The local regression independently proves full-row/ciphertext
preservation for isolated fixtures. Neither claim is substituted for the other.

No live SDS or BLACOR query, mutation, OAuth, Page selection, Save, Skip or
advancement was performed during this repair. No live provider state changed
by this work. Existing full-suite warnings are retained, not hidden; targeted
Facebook verification uses only local stubbed provider responses.

## Packaging and review boundary

The evidence document and raw evidence are included with the implementation.
The final packaging receipt provides exact commit/tree, complete changed-file
numstat and every changed blob SHA after the containing tree is finalized.
The review branch is published through the existing GitHub integration's Git
Data API, then fetched independently to compare the remote tree with the
locally staged tree. This is branch packaging, not a merge or deployment.

The owner must not resume the live verification based on this implementation
package. STOP FOR PRE-MERGE REVIEW.
