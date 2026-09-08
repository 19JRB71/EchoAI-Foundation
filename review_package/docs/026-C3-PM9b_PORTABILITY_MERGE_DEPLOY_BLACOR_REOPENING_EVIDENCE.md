# 026-C3-PM9b — Portability Merge, Deployment, and BLACOR Reopening Evidence

**Evidence opened:** 2026-09-08 America/New_York  
**Authority:** Pinned portability merge, staging deployment verification, and
read-only BLACOR reopening gate only
**Verdict:** **HARD STOP — SDS NON-INTERFERENCE BASELINE CHANGED**

## 1. Pre-merge pins

```text
approved repair branch: pm9b-lockfile-portability-repair
approved head:          f3b956e9140c2342e162582778fa6e949570b0dc
approved tree:          144bb722ac0424e14102c67692ea9697a3931a09
approved parent:        a3fa570a8d5bc255b469aaca2c8246d325ae9a86
remote repair observed: f3b956e9140c2342e162582778fa6e949570b0dc
remote staging before:  a3fa570a8d5bc255b469aaca2c8246d325ae9a86
```

Both authorization pins matched before PR creation and again immediately before
the atomic staging push.

## 2. Client package-lock host scan

The complete `EchoAI/client/package-lock.json` was included in the host scan.

```text
file SHA-256:                       918df16f9e178740d85d608a1044f4ee16cff36f2a6b4a143a19640c4288e07d
resolved entries:                   296
registry.npmjs.org entries:         296
package-firewall.replit.local:      0
other private/local/firewall hosts: 0
```

No client dependency change was made.

## 3. Pinned merge

```text
PR:                 #66
PR head:            f3b956e9140c2342e162582778fa6e949570b0dc
merge SHA:          de8e996f55fd5139a5488f75f7d96078f9dc25c6
resulting staging:  de8e996f55fd5139a5488f75f7d96078f9dc25c6
merge tree:         144bb722ac0424e14102c67692ea9697a3931a09
parent 1:           a3fa570a8d5bc255b469aaca2c8246d325ae9a86
parent 2:           f3b956e9140c2342e162582778fa6e949570b0dc
```

The merge was created from a fresh detached checkout. The push to `staging` was
a guarded fast-forward: any intervening staging movement would have rejected it.

## 4. Railway deployment

GitHub/Railway created deployment:

```text
deployment ID: 6339203571
environment:   calm-purpose / production
commit:        de8e996f55fd5139a5488f75f7d96078f9dc25c6
created:       2026-09-08T23:27:52Z
terminal:      success
terminal at:   2026-09-08T23:30:35Z
```

The normal staging deployment was allowed to run once. It was not retried or
manually redeployed.

## 5. Live deployment identity

Read-only live checks passed:

```text
health environment: staging
health version:     de8e996f55fd5139a5488f75f7d96078f9dc25c6
migrations:         148
service worker:     echoai-shell-v186
served bundle:      index-qsmk6fKo.js
bundle SHA-256:     3dc55e6aaf7de162ca05034ccca8bdbf4139446c58cec3f6c8417ad6858d3a8f
```

The migration count was read inside `BEGIN READ ONLY` and rolled back.

## 6. PM9b live behavior

The served live bundle is byte-identical to the approved PM9b bundle, and the
approved tree contains the focused 9/9 entry-choice proof. A separate live render
for the already-onboarded SDS owner could not be certified without violating the
read-only boundary:

* The owner is onboarding-complete, has one real brand, has one completed setup
  session, and has zero `in_progress`/`paused` setup sessions.
* A guarded headless browser blocked every non-GET request except the explicit
  setup `{probe:true}` read.
* Tokens signed with the workspace JWT key and the separately available session
  key were both rejected by live staging with HTTP 401.
* The normal login route was not used because it writes `last_login_at` and
  increments `login_count`.
* No setup-session request was made, no setup session was created/resumed, and
  “Set up a different business” was not clicked.

Therefore the byte identity is proven but the requested authenticated live render
is **not certified** under a strictly read-only procedure.

## 7. BLACOR nine-gate read-only reopening check

The database capture used only `STAGING_DATABASE_URL` and ran inside:

```sql
BEGIN READ ONLY;
-- SELECT statements only
ROLLBACK;
```

### 7.1 Gate results

| Gate | Result | Evidence |
|---|---|---|
| 1. Approved merge pins | PASS | Exact approved head, parent, and tree |
| 2. Live staging SHA | PASS | Health reports the exact merge SHA |
| 3. Release bytes/schema | PASS | 148 migrations, SW v186, exact bundle/hash |
| 4. PM9b live control | NOT CERTIFIED | Read-only JWT rejected; normal login writes telemetry |
| 5. BLACOR application zero-state | PASS | All eleven application stores returned zero |
| 6. SDS non-interference | **FAIL** | Counts and durable action/proof rows changed |
| 7. PAUSED/$0 boundary | PASS | Deferred campaign unchanged; zero spend rows |
| 8. No prohibited action | PASS | No BLACOR/provider/retry/activation/publish action |
| 9. Evidence at creation | PASS | This report and raw captures were opened before checks completed |

### 7.2 BLACOR application zero-state

The identifying-text/JSON inventory returned zero rows for:

```text
users
brands
setup_sessions
guided_setup_progress
agent_tasks
social_posts
campaigns
ad_creatives
external_actions
external_proofs
job_runs
```

As before, three `api_integrations` OAuth snapshots contain BLACOR provider
metadata. They are not BLACOR application state. No provider read was performed.

### 7.3 SDS baseline mismatch

The banked 2026-09-05 baseline was:

```text
social posts:                 48
unpublished posts:            46
scheduled/unpublished posts:  12
external actions:              3
external proofs:               3
```

The 2026-09-08 read-only capture returned:

```text
social posts:                 48
unpublished posts:            45
scheduled/unpublished posts:   6
status distribution:
  draft:                       9
  failed:                     30
  published:                   3
  scheduled:                   6
external actions:              4
external proofs:               4
```

Unchanged aggregate counts:

```text
social accounts:                    1
calendars:                          3
campaigns:                          1
ad creatives:                      3
agent tasks:                       43
ad spend audit rows:                0
ad spend cap rows:                  0
relevant Facebook integrations:     2
relevant Google integrations:       2
setup sessions:                     3
```

Six post rows have `updated_at` later than the prior capture cutoff
`2026-09-05T01:41:45Z`: five are now `failed` and one is now `published`.
Their IDs and current operational fields are preserved in the raw JSON capture.
This report does not infer who or what caused those transitions.

The prior report banked:

```text
46 unpublished:           fe8af88e061af2c7e2c3f3504dba9b96ccadde9c938c6edd67dc42f858ecb27b
12 scheduled/unpublished: d4eb12ff4699ae2105fc91246131061281f3c15290655f886fac06128dd20ec9
```

The exact serializer referenced by that report was not present in the report,
surviving repository branches, attached authorizations, or retained PR refs.
It would be dishonest to claim a direct hash comparison without it. For future
reproducibility, the raw capture records a new explicit full-row projection,
ordering, timestamp/null handling, JSON key order, inclusion predicates, and
resulting current hashes:

```text
45 unpublished:           1292e1e3dd9bc30d4285984998f7385862a90370b3cec7d2ebd7b7e28289b36c
 6 scheduled/unpublished: a3d172d8f6e3b700e98d7a79ec917cfd6bcb80293fbbe36e17f62334e4a867f9
```

These new hashes are **not** represented as comparable to the two banked hashes.
The count mismatches independently and conclusively fail the non-interference
gate.

### 7.4 Deferred campaign and zero-spend boundary

The deferred SDS campaign remains:

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

There are still zero ad-spend audit and cap rows. The approved tree is the exact
PM9b tree that preserves PAUSED creation and deny-by-default unpause/spend
boundaries. No provider API was called, so no external spend-state claim is made.

## 8. Operational boundary

No production action, BLACOR-H1 start, BLACOR/SDS mutation, provider/Meta call,
Retry, scheduling, publishing, activation, or spend action is authorized.

## 9. Final verdict

**HARD STOP — SDS NON-INTERFERENCE BASELINE CHANGED**

BLACOR-H1 is not opened. The exact blocking facts are:

```text
unpublished posts changed from 46 to 45
scheduled/unpublished posts changed from 12 to 6
external actions changed from 3 to 4
external proofs changed from 3 to 4
```

The live authenticated PM9b render also remains uncertified because every
available read-only token was rejected and normal login would mutate owner login
telemetry. No workaround, retry, repair, provider read, SDS mutation, BLACOR
journey action, or production action was attempted.