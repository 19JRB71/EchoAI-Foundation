# 026-C3-PM9b — BLACOR-H1 Pre-Flight Rerun Report

**Gate date:** 2026-09-04 America/New_York  
**Live capture window:** 2026-09-05 01:40–01:45 UTC  
**Authority:** PM9b staging merge and BLACOR-H1 pre-flight only  
**Verdict:** **HARD STOP — STAGING DEPLOYMENT FAILED**

## 1. Executive verdict

The approved PM9b implementation was merged to `staging` through PR #65 with its
head pinned to the exact authorized commit:

```text
d688b960a91e24a2570355f415aedb8363423361
```

The resulting staging merge commit is:

```text
a3fa570a8d5bc255b469aaca2c8246d325ae9a86
```

The merge identity, committed client artifacts, focused entry-choice behavior,
BLACOR zero-state inventory, SDS fingerprints, and PAUSED/$0 code boundaries all
passed their pre-flight checks.

The release did not become live. Railway reported `Deployment failed` for the
merge commit. After that failure, `https://staging.zorecho.com/api/health` still
served the previous staging SHA and `/dashboard` still referenced the previous
client bundle. Therefore the required live staging identity and live PM9b UI
verification could not pass.

BLACOR-H1 was not started. No setup session was created. No BLACOR or SDS row was
mutated. No provider or Meta API was called. No content was activated, scheduled,
or published. No ad was created or activated. No spend was authorized. Production
was not deployed or contacted.

## 2. Exact merge authority

Immediately before PR mutation, the remote repair branch was re-read and matched:

```text
branch: pm9b-blacor-pre-journey-repair
head:   d688b960a91e24a2570355f415aedb8363423361
```

PR #65 was created against `staging`. GitHub re-reported:

```text
base:        staging
pinned head: d688b960a91e24a2570355f415aedb8363423361
merged:      true
merge SHA:   a3fa570a8d5bc255b469aaca2c8246d325ae9a86
```

A fresh post-merge clone at `.local/blacor-h1-preflight-rerun` was clean and
reported:

```text
commit:  a3fa570a8d5bc255b469aaca2c8246d325ae9a86
tree:    5080cd8a061cf8f57af2c4c98cb40f967b0c4d2a
parents: 57261ebe59248c555c3eccb02bdcaa9a6d69f8eb
         d688b960a91e24a2570355f415aedb8363423361
```

The merge tree is exactly the approved implementation tree. No other branch head
was merged.

## 3. Staging deployment result

GitHub recorded Railway deployment `6275791381` for the merge SHA at
`2026-09-05T01:40:29Z`. Its commit status later became:

```text
context:     calm-purpose - prolific-perception
state:       failure
description: Deployment failed
updated_at:  2026-09-05T01:44:51Z
```

The corresponding deployment status was recorded as `failure` at
`2026-09-05T01:44:54Z`.

The staging health endpoint was polled without mutation. Every captured response
from `01:40:37Z` through `01:45:14Z` remained:

```text
environment: staging
version:     57261ebe59248c555c3eccb02bdcaa9a6d69f8eb
```

The final live HTML capture still referenced:

```text
index-B3EZDk_P.js
```

It did not reference the required PM9b bundle:

```text
index-qsmk6fKo.js
```

### 3.1 Expected committed artifact identity

The post-merge repository itself contains the expected artifacts:

```text
migrations:        148 (schema plus 147 numbered migrations)
service worker:    echoai-shell-v186
bundle:            index-qsmk6fKo.js
bundle SHA-256:    3dc55e6aaf7de162ca05034ccca8bdbf4139446c58cec3f6c8417ad6858d3a8f
```

These values prove the expected release bytes are in the merge tree. They do not
substitute for the failed live-deployment gate.

## 4. PM9b entry-choice verification

The merged source sets `entryOnboardingComplete` true only when the authoritative
onboarding probe returns exact `onboardingCompleted === true`. The
“Set up a different business” control is independent of the `embedded` host
predicate and retains the existing:

```text
startWith("new_business")
```

path. No server route, controller, or setup-session path changed.

The focused post-merge UI suite passed:

```text
SetupAgent.entryChoice.test.jsx
9 passed / 9 total
```

The passing cases include:

```text
embedded + onboarding complete   => different-business option rendered
embedded + onboarding incomplete => option omitted
standalone + incomplete          => option omitted
standalone + complete            => option rendered; existing new_business path retained
```

The suite used mocked client APIs. No live staging setup call was made and no
setup session was started. Because Railway did not serve the merged release, this
is post-merge artifact verification, not a claim that the PM9b UI became live.

## 5. Read-only BLACOR/SDS capture

The database capture used `STAGING_DATABASE_URL` only. It ran SELECT statements
inside:

```sql
BEGIN READ ONLY;
-- SELECT statements only
ROLLBACK;
```

The capture completed at `2026-09-05T01:41:45Z` and reported 148 applied
migrations.

### 5.1 BLACOR application state

The same `%BLACOR%` identifying-text/JSON inventory returned:

| Store | Rows |
|---|---:|
| users | 0 |
| brands | 0 |
| setup sessions | 0 |
| guided setup progress | 0 |
| agent tasks | 0 |
| social posts | 0 |
| campaigns | 0 |
| ad creatives | 0 |
| external actions | 0 |
| external proofs | 0 |
| job runs | 0 |

The only BLACOR signal remains three user-scoped Facebook OAuth snapshots that
include the available account named `BlaCor Ads`,
`act_1694378501604002`. All three snapshots still select other account refs and
the SDS page `140006069194366`. This is provider metadata, not a BLACOR tenant or
binding. No live provider read was performed.

### 5.2 SDS aggregate baseline

The exact SDS brand IDs remained:

```text
bfe13534-f06d-4206-8139-3c217a52c8da
ae125e32-f130-4b5c-8c68-1f41cfd8ae20
d5745758-30a6-462a-baa6-4233216b8f93
```

Read-only counts matched the banked baseline:

| Store | Count |
|---|---:|
| social posts | 48 |
| unpublished posts | 46 |
| scheduled/unpublished posts | 12 |
| social accounts | 1 |
| calendars | 3 |
| campaigns | 1 |
| ad creatives | 3 |
| agent tasks | 43 |
| external actions | 3 |
| external proofs | 3 |
| ad spend audit rows | 0 |
| ad spend cap rows | 0 |
| relevant Facebook integrations | 2 |
| relevant Google integrations | 2 |
| setup sessions | 3 |

The Google count was read from the dedicated `google_integrations` table; Google
OAuth is intentionally not stored in `api_integrations`.

### 5.3 Exact post fingerprints

The rerun used the original filed projection, order, unpublished inclusion rule,
timestamp serialization, null preservation, and JSON key order.

```text
all 46 unpublished rows
expected: fe8af88e061af2c7e2c3f3504dba9b96ccadde9c938c6edd67dc42f858ecb27b
actual:   fe8af88e061af2c7e2c3f3504dba9b96ccadde9c938c6edd67dc42f858ecb27b
result:   exact match

12 scheduled/unpublished rows
expected: d4eb12ff4699ae2105fc91246131061281f3c15290655f886fac06128dd20ec9
actual:   d4eb12ff4699ae2105fc91246131061281f3c15290655f886fac06128dd20ec9
result:   exact match
```

The deferred SDS campaign also remained unchanged:

```text
campaign_id:             5eb4a506-e92e-4d94-a63c-7ce2c15ee741
status:                  launch_failed
budget:                  20.00
facebook_campaign_id:    52548872979134
facebook_adset_id:       52548872983334
facebook_creative_id:    NULL
facebook_ad_id:          NULL
activation_requested_at: NULL
```

No SDS retry, cleanup, resume, activation, or provider read occurred.

## 6. PAUSED/$0 boundary

The merge tree preserves the existing safety boundary:

```text
Facebook ad creation status: PAUSED
review artifact createdPaused: true
review artifact initialSpend: 0
unpause/spend caps: deny by default before any provider call
```

No provider call was made during this pre-flight, so no external spend-state claim
is made.

## 7. Final boundary statement

**HARD STOP — STAGING DEPLOYMENT FAILED**

Exact defect:

```text
Railway marked deployment of staging merge
a3fa570a8d5bc255b469aaca2c8246d325ae9a86 as failed. The staging health
endpoint continued serving 57261ebe59248c555c3eccb02bdcaa9a6d69f8eb and the
old index-B3EZDk_P.js bundle, so the merged PM9b release never became live and
the live staging entry-choice gate cannot be certified.
```

BLACOR-H1 remains unopened. This report authorizes no deployment retry, production
deployment, direct setup-session call, owner-journey step, provider call, or data
repair.

**Durable evidence file:**  
`review_package/docs/026-C3-PM9b_BLACOR_PRE_FLIGHT_RERUN_REPORT.md`