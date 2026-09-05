# 026-C3-PM9b — BLACOR Pre-Journey Repair Evidence

**Gate date:** 2026-09-04 America/New_York
**Authority:** PM9b repair implementation and pre-merge evidence only
**Merge/deploy status:** Not authorized; not performed

## 1. Pinned base and lineage

Implementation began in a fresh single-branch clone of remote `staging`.

```text
base commit: 57261ebe59248c555c3eccb02bdcaa9a6d69f8eb
base tree:   d9b8131d886664ce687a385c436f1b28669a942e
parent 1:    300ebbee49473f0a36621f0c1c7e225bda49148f
parent 2:    09f30cfc240e0df4db63b740a82c0413927bef10
subject:     Merge pull request #64 from 19JRB71/pm9-recovery-completion
```

Remote `staging` had not moved since the BLACOR pre-flight. The long-lived
workspace was not used as source authority.

## 2. Authorized production repair

Exactly one hand-edited production file changed:

```text
EchoAI/client/src/onboarding/SetupAgent.jsx
```

No host prop plumbing was needed because the client already exposes the
authoritative `api.getOnboardingStatus()` read.

Bootstrap now reads, in parallel:

```text
api.getBrands()
api.probeSetupSession()
api.getOnboardingStatus()
```

The exact rendering predicate is:

```jsx
{entryOnboardingComplete ? (
  <button
    onClick={() => {
      setPhase("loading");
      startWith("new_business");
    }}
    data-testid="entry-choice-new"
  >
    Set up a different business
  </button>
) : null}
```

`entryOnboardingComplete` becomes true only for the literal authoritative
response:

```js
onboarding?.onboardingCompleted === true
```

An unavailable, malformed, or false status therefore fails closed and does not
render the option.

The old host-based predicate:

```text
!embedded
```

is removed from this control. `embedded` remains otherwise unchanged for
existing timing, layout, and handoff behavior.

## 3. Existing session path preserved

The click still calls the existing function:

```text
startWith("new_business")
```

`startWith` still calls:

```js
api.startSetupSession({ intent: "new_business" })
```

No API client method, route, controller, server utility, or session-creation
path changed.

## 4. UI host/state test map

Focused file:

```text
EchoAI/client/src/onboarding/SetupAgent.entryChoice.test.jsx
```

| Requirement | Host | Authoritative state | Expected result | Proof |
|---|---|---|---|---|
| R-B1 / updated R22 | Embedded | Complete | Option renders | Pass |
| R-B2 | Embedded | Incomplete | Option absent | Pass |
| R-B3 | Standalone | Incomplete | Option absent | Pass |
| fourth quadrant | Standalone | Complete | Option renders | Pass |

The standalone-complete test also clicks the control and proves the exact call:

```text
api.startSetupSession({ intent: "new_business" })
```

Focused result:

```text
1 file passed
9 tests passed
0 failed
```

Existing entry behavior also remains covered:

- Continue uses the default path with no intent.
- An open session resumes without showing the choice.
- No real brands starts normally without a choice.
- Demo-only brands start normally without a choice.
- Probe/read failure degrades to normal setup and never exposes new-business.

## 5. Sparse-session and SDS-isolation proof

The existing real-HTTP R23–R25 suite was strengthened without changing server
code.

R24 now proves that post-completion `new_business` returns:

```text
entryIntent = new_business
brandId = NULL
answers keys = ["_interview"]
```

The only answer content is the existing session-level intent bookkeeping. No
prior owner answers or brand-scoped state are inherited.

For SDS isolation, the test creates a separate completed SDS fixture and records
the exact SDS brand-row count and SHA-256 before the real endpoint call. After
the other owner's `new_business` request it proves:

```text
SDS brand-row count: unchanged
SDS brand-row SHA-256: unchanged
SDS setup-session count: 0
```

Focused real-endpoint result:

```text
15 tests passed
0 failed
```

Preserved requirements:

- R23: pre-completion `new_business` remains a side-effect-free 409.
- R24: post-completion `new_business` creates a fresh sparse session.
- R25: convergence rejects a `new_business` setup session and preserves
  existing evidence under concurrency.

The controller test `test/p035.secondBusiness.test.js` also remains part of the
green full server suite and retains its restart, no-brand-bind, pause-not-delete,
default-resume, read-only probe, and closed-intent assertions.

## 6. PM9 preservation

Dedicated client activation-review suites:

```text
SetupAgent.activationConsent.test.jsx
AICalendar.activationConsent.test.jsx
```

Result:

```text
2 files passed
10 tests passed
0 failed
```

Dedicated server activation/editor suites:

```text
calendarActivationDigest.test.js
contentCalendar.activationConsent.test.js
setupAgent.e2e.test.js
```

Result:

```text
34 tests passed
0 failed
```

These preserve:

- explicit digest-bound activation;
- exact eligible and excluded membership;
- content, media, platform, schedule, destination, and calendar binding;
- stale-digest rejection;
- draft-only guarded editing;
- media preservation;
- no task/action/proof/provider writes during editing; and
- SetupAgent activation-review consent.

## 7. Full suite arithmetic

Server:

```text
tests:     1534
passed:    1534
failed:    0
cancelled: 0
skipped:   0
todo:      0
```

Client:

```text
files:  53
passed: 53
tests:  518
passed: 518
failed: 0
```

Combined:

```text
total tests: 2052
passed:      2052
failed:      0
```

## 8. Hand-edited bounds

Production:

```text
7 insertions
2 deletions
9 touched
ceiling: 180
```

Tests:

```text
42 insertions
3 deletions
45 touched
ceiling: 250
```

The evidence document and mechanical generated client files are excluded from
the hand-edited ceilings.

## 9. Server, schema, and package integrity

Git byte-diff against the pinned base is empty for:

```text
EchoAI/config
EchoAI/controllers
EchoAI/routes
EchoAI/utils
EchoAI/server.js
```

Git byte-diff is also empty for:

```text
EchoAI/models
EchoAI/package.json
EchoAI/package-lock.json
EchoAI/client/package.json
EchoAI/client/package-lock.json
```

Migration inventory:

```text
schema.sql: 1
numbered migrations: 147
total: 148
```

Test database setup independently reported:

```text
Migrations complete: 0 applied, 148 skipped.
```

## 10. Mechanical client accompaniment

Service-worker source and generated copy:

```text
echoai-shell-v185 -> echoai-shell-v186
```

Old main bundle:

```text
EchoAI/client/dist/assets/index-B3EZDk_P.js
SHA-256: 10734b4b942aa20347597c4ca3d036b68151cef5fcdb6c03fc0b26ef71245e37
```

New main bundle:

```text
EchoAI/client/dist/assets/index-qsmk6fKo.js
SHA-256: 3dc55e6aaf7de162ca05034ccca8bdbf4139446c58cec3f6c8417ad6858d3a8f
```

Mechanical generated delta:

```text
rename old main bundle -> new main bundle
modify EchoAI/client/dist/index.html
modify EchoAI/client/dist/sw.js
```

The Vite production build completed successfully.

## 11. Operational boundary

This implementation did not:

- start the BLACOR journey;
- create or modify a BLACOR brand/session/content/campaign;
- modify any staging or real SDS row;
- access or mutate Meta/provider state;
- bind the discoverable BlaCor Ads account;
- retry a provider action;
- create, schedule, publish, or activate content;
- create or activate advertising;
- authorize or spend money;
- add solicitation/default-confirmation UI;
- change DDL or migrations;
- merge;
- deploy; or
- access production.

The SDS isolation proof uses only isolated test fixtures. Application/database
investigation outside tests remained read-only.

## 12. Pre-merge disposition

The minimal PM9b repair is implemented and fully tested. Git commit, tree, blob,
remote branch, and remote-head identities are recorded from immutable Git
readback in the accompanying pre-merge return package.

**HARD STOP FOR CLAUDE PRE-MERGE RULING.**