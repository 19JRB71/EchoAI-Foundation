# 026-C3-PM9 — Final Closure Evidence Package

Filed: 2026-09-01  
Purpose: durable source record for the future System-State Verification Report  
Authority: Claude's 2026-09-01 PM9 evidence-package re-derivation and filing ruling

## Final determination

**PM9 RECORD-DEBT CONDITION: SATISFIED**

All re-derived values agree with the accepted PM9 values. This filing records immutable Git-object evidence, the authorized final-head scratch-build fingerprint, GitHub PR #64 pinning, and previously established staging facts. It does not authorize or begin BLACOR-H1.

## 1. Immutable Git objects

The following objects were fetched from `19JRB71/EchoAI-Foundation` and verified as commit objects:

| Role | Commit |
| --- | --- |
| Base | `300ebbee49473f0a36621f0c1c7e225bda49148f` |
| Reconstruction | `e8d106e15b64b129c84335b1bc9aa373d6590e44` |
| Tests-only completion | `09f30cfc240e0df4db63b740a82c0413927bef10` |
| Staging merge | `57261ebe59248c555c3eccb02bdcaa9a6d69f8eb` |

Parentage:

- Reconstruction parent: `300ebbee49473f0a36621f0c1c7e225bda49148f`
- Completion parent: `e8d106e15b64b129c84335b1bc9aa373d6590e44`
- Merge parents:
  1. `300ebbee49473f0a36621f0c1c7e225bda49148f`
  2. `09f30cfc240e0df4db63b740a82c0413927bef10`
- The completion commit is an ancestor of the merge commit.
- Completion tree and merge tree are identical: `d9b8131d886664ce687a385c436f1b28669a942e`.

## 2. Reconstruction identity: `300ebbee..e8d106e1`

### 2.1 Accepted arithmetic

| Class | Additions | Deletions | Total changed lines | Files |
| --- | ---: | ---: | ---: | ---: |
| Production source | 398 | 76 | 474 | 6 |
| Tests | 285 | 24 | 309 | 6 |
| Mechanical SW/dist | 157 | 157 | 314 | 5 |
| All reconstruction files | 840 | 257 | 1,097 | 17 |

This exactly matches the accepted production `398+/76−/474` and test `285+/24−/309` values. SW/dist is recorded separately as the mechanical Branch-A bundle replacement.

### 2.2 Exact file-by-file numstat

#### Production source — `398+/76−/474`

| Path | Added | Deleted |
| --- | ---: | ---: |
| `EchoAI/client/src/api.js` | 2 | 2 |
| `EchoAI/client/src/onboarding/SetupAgent.jsx` | 116 | 4 |
| `EchoAI/client/src/sections/social/AICalendar.jsx` | 112 | 40 |
| `EchoAI/client/src/sections/social/CalendarPostEditor.jsx` | 85 | 0 |
| `EchoAI/controllers/contentCalendarController.js` | 20 | 10 |
| `EchoAI/utils/calendarActivationDigest.js` | 63 | 20 |

#### Tests — `285+/24−/309`

| Path | Added | Deleted |
| --- | ---: | ---: |
| `EchoAI/client/src/onboarding/SetupAgent.activationConsent.test.jsx` | 41 | 0 |
| `EchoAI/client/src/sections/social/AICalendar.activationConsent.test.jsx` | 43 | 0 |
| `EchoAI/client/src/sections/social/AICalendar.reschedule.test.jsx` | 1 | 3 |
| `EchoAI/test/activateBrokenAccount.test.js` | 1 | 1 |
| `EchoAI/tests/calendarActivationDigest.test.js` | 101 | 16 |
| `EchoAI/tests/contentCalendar.activationConsent.test.js` | 98 | 4 |

#### Mechanical SW/dist — `157+/157−/314`

| Path | Added | Deleted |
| --- | ---: | ---: |
| `EchoAI/client/dist/assets/index-B3EZDk_P.js` | 154 | 0 |
| `EchoAI/client/dist/assets/index-pjLJQVbh.js` | 0 | 154 |
| `EchoAI/client/dist/index.html` | 1 | 1 |
| `EchoAI/client/dist/sw.js` | 1 | 1 |
| `EchoAI/client/public/sw.js` | 1 | 1 |

### 2.3 Reconstruction tree

Reconstruction tree SHA:

`092c2224e2e81f54b7d625dca2fbbbac6f1c6dd9`

### 2.4 Per-file Git blob identities

`0000000000000000000000000000000000000000` denotes absence on that side.

| Path | Base blob | Reconstruction blob |
| --- | --- | --- |
| `EchoAI/client/dist/assets/index-B3EZDk_P.js` | `0000000000000000000000000000000000000000` | `46463902dd2874c426630f2b4eac325c3bd93444` |
| `EchoAI/client/dist/assets/index-pjLJQVbh.js` | `a1abc8924f78bbdac4b9a8a41c60ad0402af5fbd` | `0000000000000000000000000000000000000000` |
| `EchoAI/client/dist/index.html` | `fec0d386cf200feff7e6514b58a7594366ae585f` | `63c0d834fadc930e2078f04c756c3079aff1740c` |
| `EchoAI/client/dist/sw.js` | `e90b974199325d1f8711170d93a22072c8503e02` | `459ce126b663a91bb769401f6b60bfe6c5b57f4d` |
| `EchoAI/client/public/sw.js` | `e90b974199325d1f8711170d93a22072c8503e02` | `459ce126b663a91bb769401f6b60bfe6c5b57f4d` |
| `EchoAI/client/src/api.js` | `f671645428869f9cde5272d230a1b2becd3f8a35` | `7a9ebdc47fd46cc3496190fc65051e2e19921d99` |
| `EchoAI/client/src/onboarding/SetupAgent.activationConsent.test.jsx` | `2af7bc3edf5a38546eccaeea1868f68067897f67` | `5d98293624247d6ccdd71774204e692e8acc8a27` |
| `EchoAI/client/src/onboarding/SetupAgent.jsx` | `7ba1deae10be71f7ec9bef2b1d65ca94edaec3f3` | `c8bcc5dd2ff2af53d8b38401636d76db16d42c2a` |
| `EchoAI/client/src/sections/social/AICalendar.activationConsent.test.jsx` | `0711d3cd69600cdc5ed93dd65a0be08f092efdc3` | `544ebaf242e0b8dc88024e6ef536b67dd68a65e3` |
| `EchoAI/client/src/sections/social/AICalendar.jsx` | `734d7d7de03ba830cbec8f453fc69b0f6da2a0c6` | `2e438d21ef071ee81b872bf34884e46465113e33` |
| `EchoAI/client/src/sections/social/AICalendar.reschedule.test.jsx` | `4eaae384aaf2a3df2efeeaa5d044dd0e74c88849` | `b1a2a9c39eaffd8808059476f7ad77b1828b95c9` |
| `EchoAI/client/src/sections/social/CalendarPostEditor.jsx` | `0000000000000000000000000000000000000000` | `f17749436f9f7008d7361ddc9cc5ba5aaa779c99` |
| `EchoAI/controllers/contentCalendarController.js` | `d5847cab2b50edbcc2c018397e5a1e6126e4402c` | `259e8d52729943c7f5414cc8c51921887483389e` |
| `EchoAI/test/activateBrokenAccount.test.js` | `d26283f6e83cf8f9c42aa25ee0b34d1cbb3922c4` | `e512161f35260da572b1981fb2f5db63a7bcd6db` |
| `EchoAI/tests/calendarActivationDigest.test.js` | `c650f29cd1eecb4055c9dbdd2fac55ecdb406b66` | `dbacc7861f17f579bc2fd61a87ddaf149998c87d` |
| `EchoAI/tests/contentCalendar.activationConsent.test.js` | `245cad3118797c3e1c1560ecd56eae1737fb2a38` | `167c69c8edc85b39df6e6f2fe39eb2fcfb060181` |
| `EchoAI/utils/calendarActivationDigest.js` | `0fd74f0032b84f3e95d4a2e6dea90ef31707ed84` | `35d8e2edbc2ca841a8572e7cff672b6848dff47c` |

## 3. Accepted reconstruction anchors

All anchors below were read from reconstruction commit `e8d106e15b64b129c84335b1bc9aa373d6590e44`, not from the drifting workspace.

### 3.1 Digest v2

`EchoAI/utils/calendarActivationDigest.js`

- Lines 17–18 establish domain `echoai.calendar-activation` and version `2`.
- Lines 40–69 classify persisted drafts and bind eligible entries to:
  - post ID
  - platform
  - scheduled time
  - destination
  - post content
  - image URL
  - video URL
- Lines 78–116 canonicalize calendar ID, sorted eligible rows, stale exclusions, and unbound exclusions, then hash:

```text
echoai.calendar-activation:v2
<canonical JSON>
```

with SHA-256.

### 3.2 Lock-then-hash

`EchoAI/controllers/contentCalendarController.js:724–734`

- Begins the transaction.
- Locks every currently-draft row for the calendar with `FOR UPDATE`.
- Rebuilds the complete persisted activation artifact only after acquiring the locks.
- The corrected comment explicitly states that confirmation binds to exactly what the post-lock query reconstructs.

### 3.3 Enum-safe writer predicate

`EchoAI/controllers/contentCalendarController.js:984–1027`

- Rejects empty trimmed content.
- Accepts only an absent `expectedStatus` or the literal `draft`.
- Rejects cross-tenant/missing posts with `404`.
- Updates `post_content` only while status is not `publishing` or `published`.
- Uses `($3::text IS NULL OR status = $3::social_post_status)`, preventing empty-string enum casts.
- Returns `409` when the expected draft status has moved.

### 3.4 Shared editor

`EchoAI/client/src/sections/social/CalendarPostEditor.jsx:13–85`

- One shared editor owns draft text, dirty state, save state, error state, and save/cancel behavior.
- It trims and rejects empty/no-op saves.
- It forwards `expectedStatus` when supplied.
- It disables Save while unchanged, empty, or saving.

### 3.5 Both editor hosts

- Guided Setup host:
  - import at `EchoAI/client/src/onboarding/SetupAgent.jsx:11`
  - editor at lines `1587–1594`
  - passes `expectedStatus="draft"`
  - refreshes the activation artifact after Save
- Content Calendar activation host:
  - import at `EchoAI/client/src/sections/social/AICalendar.jsx:15`
  - editor at lines `424–431`
  - passes `expectedStatus="draft"`
  - refreshes the activation artifact after Save
- Standard calendar-post host:
  - `EchoAI/client/src/sections/social/AICalendar.jsx:1166–1176`
  - reuses the same editor and refreshes after Save

### 3.6 Corrected comments and SW

- `EchoAI/controllers/contentCalendarController.js:725–728` correctly describes locking status/content updates before reconstructing the confirmation-bound artifact.
- `EchoAI/controllers/contentCalendarController.js:980–983` correctly describes manual editing before a post goes live.
- `EchoAI/client/public/sw.js:18` and committed `dist/sw.js` use `echoai-shell-v185`.

## 4. Tests-only completion proof

Inter-head range:

`e8d106e15b64b129c84335b1bc9aa373d6590e44..09f30cfc240e0df4db63b740a82c0413927bef10`

Exact changed-file list:

```text
M EchoAI/tests/contentCalendar.activationConsent.test.js
```

Exact numstat:

```text
119  0  EchoAI/tests/contentCalendar.activationConsent.test.js
```

Every changed path is test-only. The file's Git blob changed from:

- reconstruction: `167c69c8edc85b39df6e6f2fe39eb2fcfb060181`
- completion: `b3bff834e3ff1ba8872cc4cd921fedcf96a3b9db`

Exact five writer-contract tests added:

1. `updatePost rejects empty content`
2. `updatePost denies a cross-tenant postId with 404`
3. `updatePost preserves image_url and video_url byte-for-byte`
4. `updatePost changes exactly one row and leaves a sibling draft byte-identical`
5. `updatePost creates no task, external-action, proof, or provider-connection rows`

Accepted regression arithmetic:

| Suite | Result |
| --- | ---: |
| Prior server | 1529/1529 |
| New writer contracts | +5 |
| Final server | 1534/1534 |
| Client | 516/516 |
| Focused server | 26/26 |
| Migrations | 148 |

Per Claude's ruling, historical per-test console output is not required. The five-test delta is bound by immutable inter-head proof to the accepted server arithmetic.

## 5. Branch A and final-head fingerprint closure

Branch determination: **BRANCH A — BENIGN DELTA**.

The accepted source was rebuilt once in an isolated scratch worktree at exact merge commit:

`57261ebe59248c555c3eccb02bdcaa9a6d69f8eb`

Build inputs:

- Exact merge source and tree `d9b8131d886664ce687a385c436f1b28669a942e`
- Client `package.json` SHA-256 matched the retained workspace manifest:
  `95db0cd67027e34fbeafb2b32fbd9f09b472e159a0fffff6b72f2b332c53f246`
- Client `package-lock.json` SHA-256 matched the retained workspace lock:
  `918df16f9e178740d85d608a1044f4ee16cff36f2a6b4a143a19640c4288e07d`
- Node: `v24.13.0`
- npm: `11.6.2`

Fingerprint results:

| Evidence source | Filename | SHA-256 | Result |
| --- | --- | --- | --- |
| Authorized scratch build | `index-B3EZDk_P.js` | `10734b4b942aa20347597c4ca3d036b68151cef5fcdb6c03fc0b26ef71245e37` | PASS |
| Committed merge dist | `index-B3EZDk_P.js` | `10734b4b942aa20347597c4ca3d036b68151cef5fcdb6c03fc0b26ef71245e37` | PASS |
| Previously recorded staging-served bundle | `index-B3EZDk_P.js` | `10734b4b942aa20347597c4ca3d036b68151cef5fcdb6c03fc0b26ef71245e37` | PASS |

The scratch-built bytes compare byte-for-byte equal to the committed dist bytes. All three fingerprints are equal.

**The original Branch-A determinism/diff tables were produced in an ephemeral session and not filed at creation; they are superseded by the final-head reproducibility proof.**

## 6. PR #64 pinning

GitHub PR API read on 2026-09-01 returned:

| Field | Value |
| --- | --- |
| PR | `#64` |
| State | `closed` |
| Merged | `true` |
| Head branch | `pm9-recovery-completion` |
| Exact head SHA | `09f30cfc240e0df4db63b740a82c0413927bef10` |
| Base branch | `staging` |
| Merge commit SHA | `57261ebe59248c555c3eccb02bdcaa9a6d69f8eb` |
| Merged at | `2026-08-31T19:26:56Z` |

The GitHub `merge_commit_sha` exactly equals the pinned final staging merge SHA.

## 7. Previously established staging and environment closure

The previously captured staging deployment record established:

- staging health SHA exactly equaled `57261ebe59248c555c3eccb02bdcaa9a6d69f8eb`
- migrations: `148`
- service worker: `echoai-shell-v185`
- served bundle: `index-B3EZDk_P.js`
- served bundle SHA-256:
  `10734b4b942aa20347597c4ca3d036b68151cef5fcdb6c03fc0b26ef71245e37`
- production remained untouched

No staging or production query, mutation, deployment, or live re-verification was performed during this filing.

## 8. Meta-chain checkpoint decision

**STILL BLOCKED / DEFERRED**

- No resume
- No cleanup
- No Retry
- No provider action
- No mutation

This decision remains recorded alongside PM9 closure and is not changed by PM9 record-debt satisfaction.

## 9. Gate results

| Gate | Result |
| --- | --- |
| Four immutable Git objects recovered | PASS |
| Reconstruction production numstat `398+/76−/474` | PASS |
| Reconstruction test numstat `285+/24−/309` | PASS |
| Mechanical SW/dist accounting | PASS |
| Reconstruction tree SHA | PASS |
| Per-file blob identities | PASS |
| Digest-v2 anchor | PASS |
| Lock-then-hash anchor | PASS |
| Enum-safe predicate anchor | PASS |
| Shared editor and both hosts | PASS |
| Corrected comments | PASS |
| SW v185 | PASS |
| Tests-only completion changed-file proof | PASS |
| Five writer-contract names | PASS |
| Accepted regression arithmetic | PASS |
| Scratch filename/hash | PASS |
| Scratch bytes equal committed dist | PASS |
| Committed dist equals staging fingerprint | PASS |
| PR #64 exact head/base/merge pin | PASS |
| Production untouched record | PASS |
| Meta-chain remains blocked/deferred | PASS |

## Safety statement

This filing performed no staging or production mutation, no SDS interaction, no Meta/provider action, no Retry, no forced sweep, no live journey, and no BLACOR-H1 work.