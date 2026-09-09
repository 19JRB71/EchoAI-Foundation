# 026 — SDS Baseline Drift Reconciliation + BLACOR Reopening Evidence

**Evidence opened:** 2026-09-08 America/New_York
**Authority:** Read-only staging reconciliation only
**Authoritative checkout SHA:** `de8e996f55fd5139a5488f75f7d96078f9dc25c6`
**Authoritative checkout tree:** `144bb722ac0424e14102c67692ea9697a3931a09`
**Verdict:** **BLACOR-H1 OFFICIALLY REOPENED — READY FOR OWNER JOURNEY**

## 1. Absolute boundary

This investigation performs no SDS or BLACOR mutation, login, retry,
publish/reschedule, content edit, provider contact, deployment, production action,
or BLACOR-H1 action. Every database capture recorded in this package used
`BEGIN READ ONLY` and `ROLLBACK`.

The long-lived workspace was not used as source authority. All source and evidence
work was performed in a fresh detached checkout of exact remote `staging`
`de8e996f55fd5139a5488f75f7d96078f9dc25c6`.

## 2. Authority and staging-release identity

PR #66 merged the approved PM9b portability repair
`f3b956e9140c2342e162582778fa6e949570b0dc` into `staging`, producing:

```text
staging commit: de8e996f55fd5139a5488f75f7d96078f9dc25c6
staging tree:   144bb722ac0424e14102c67692ea9697a3931a09
```

Railway staging deployment `6339203571` succeeded and served the exact approved
release:

```text
migrations:         148
service worker:     echoai-shell-v186
bundle:             index-qsmk6fKo.js
bundle SHA-256:     3dc55e6aaf7de162ca05034ccca8bdbf4139446c58cec3f6c8417ad6858d3a8f
deployment start:   2026-09-08T23:27:27.200Z
deployment success: 2026-09-08T23:30:56.981Z
```

## 3. PM9b technical UI gate

**PM9b TECHNICAL UI GATE SATISFIED PER CLAUDE RULING.**

The accepted technical evidence is:

- deployed staging serves the exact approved PM9b bundle bytes listed above;
- the PM9b focused client suite passed `9/9`;
- the full client suite passed `518/518`;
- the full server suite passed `1534/1534`;
- the focused suite includes the existing-business/new-business predicate
  coverage in `SetupAgent.entryChoice.test.jsx`;
- the deployed gate's entry predicate and routing behavior are already covered
  by the accepted source/test/probe evidence.

Evidence logs are retained under
`review_package/evidence/026-C3-PM9b-lockfile-portability/`.

No authenticated staging action was performed. In particular, this investigation
did not log in as James, did not mutate `last_login_at` or `login_count`, and did
not click the new-business entry control.

## 4. September 5 baseline delta — exact reconciliation

The prior reproducible count capture was taken at
`2026-09-05T01:41:18.562Z`:

| Dataset | September 5 | September 8 | Delta |
|---|---:|---:|---:|
| SDS social posts | 48 | 48 | 0 |
| SDS unpublished posts | 46 | 45 | -1 |
| SDS scheduled posts | 12 | 6 | -6 |
| SDS external actions | 3 | 4 | +1 |
| SDS external proofs | 3 | 4 | +1 |

The six changed social-post rows reconcile exactly:

1. Five legacy/pre-C1 scheduled rows reached their due timestamps and changed
   `scheduled -> publishing -> failed`. Each failed before the provider gateway,
   so each reduced `scheduled` by one while leaving `unpublished`, actions, and
   proofs unchanged.
2. The consented September 8 specimen reached its due timestamp and changed
   `scheduled -> publishing -> published`, creating exactly one external action
   and one readback proof. It reduced `scheduled` by one and `unpublished` by
   one.

Reconciled arithmetic:

```text
scheduled:   -5 legacy failures -1 September 8 publication = -6
unpublished:  0 legacy failures -1 September 8 publication = -1
actions:      0 legacy failures +1 September 8 publication = +1
proofs:       0 legacy failures +1 September 8 publication = +1
```

### Correction to the provisional September 4 hypothesis

The September 4 specimen is the missing routine checkpoint, but it is **not** the
row responsible for the September 5-to-September 8 count delta. Its publication
completed at `2026-09-04T17:00:05.326Z`, before the September 5 baseline cutoff,
and therefore was already included in the September 5 counts.

The single newly published row after that cutoff is the September 8 specimen
`e8716b6e-bac3-4d21-855e-bbdb220020d4`.

## 5. Missing September 4 routine publish checkpoint

The full checkpoint is filed separately at:

```text
review_package/docs/026_SDS_2026-09-04_ROUTINE_PUBLISH_CHECKPOINT.md
```

Summary:

```text
post:              8b3be13e-2cac-4f5a-aa7f-da70a87c7b7e
scheduled:         2026-09-04T17:00:00.000Z
published:         2026-09-04T17:00:05.326Z
task:              fbad62ae-0995-4bdb-8a28-d10066cf35b6
task result:       COMPLETED
action:            769a2232-eda0-4e85-938e-f240675a2abe
action result:     succeeded, attempt 1, dedup_count 0
proof:             71f31d06-a2d3-4e3f-b53b-07e73c6b21f6
sweep job:         186098
sweep result:      success
retry/duplicate:   none
```

The persisted task consent object binds the post to the owner-confirmed August 26
calendar activation, destination Page `140006069194366`, and digest
`c674abb80577c3a2ab958ab191c2d6e6a1d23a6fdfabaebc584c67168e2079b4`.

The lifecycle is complete:

```text
APPROVED -> QUEUED -> EXECUTING -> PROVIDER_ACCEPTED
-> EXTERNALLY_VERIFIED -> REPORTED -> COMPLETED
```

There is exactly one succeeded external action and exactly one externally
verified readback proof. There is no retry, duplicate fire, or dedup hit.

## 6. Five failed SDS posts — persisted-evidence classification

All five rows were `scheduled` immediately before the due sweep. That prior state
is supported by both the persisted `QUEUED` task state and the scheduler's atomic
claim predicate, which selects only `social_posts.status = 'scheduled'` before
changing the row to `publishing`.

All five rows:

- have `origin = calendar_activate`;
- have no `meta.consent` object;
- were created on August 14 or August 15, before the H1 consented calendar
  activation on August 26;
- were claimed by `system:publish-sweep` at their exact due minute;
- persist `failure_stage = pre_provider`;
- persist a missing-brand-binding error;
- ended with task status `VALIDATION_FAILED`;
- have zero external actions and zero external proofs;
- are therefore classified **legacy/pre-C1 natural sweep lifecycle**, not
  H1-consented specimen activity.

| Post | Prior -> current | Due/write time | Persisted reason | Task / sweep | Action / proof | PM9b relationship |
|---|---|---|---|---|---:|---|
| `0c8c28d1-9bd7-45cb-9c91-0b5f38985d85` | scheduled -> failed | `2026-09-05T16:00:00Z` / `16:00:00.376Z` | `pre_provider`: no connected Instagram account | task `69e2f3b0-907a-460e-bfc2-c36c96816f2b`; job `191415` success | 0 / 0 | 3 days before deployment |
| `99ab51bd-9fc1-446e-bff1-46fae5befdcd` | scheduled -> failed | `2026-09-05T17:00:00Z` / `17:00:00.956Z` | `pre_provider`: no connected Facebook account | task `b1522028-0986-47d9-b2c0-470126458ae3`; job `191637` success | 0 / 0 | 3 days before deployment |
| `6631ec8b-c6df-49bc-8722-1a24ef920685` | scheduled -> failed | `2026-09-07T16:00:00Z` / `16:00:00.803Z` | `pre_provider`: no connected Instagram account | task `a2873569-2a4a-4500-9cf7-9c787584b6a7`; job `202485` success | 0 / 0 | 1 day before deployment |
| `22bf542b-1c97-40c6-b43a-791caf689611` | scheduled -> failed | `2026-09-07T17:00:00Z` / `17:00:00.445Z` | `pre_provider`: no connected Facebook account | task `85ca244a-a642-488e-a720-3dc0bf2e6200`; job `202708` success | 0 / 0 | 1 day before deployment |
| `04de578b-c20e-4ff8-9239-742f6fc33fc4` | scheduled -> failed | `2026-09-08T17:00:00Z` / `17:00:01.057Z` | `pre_provider`: no connected Facebook account | task `41cce48f-01c5-414b-8ebe-feaff57c745b`; job `208242` success | 0 / 0 | about 6h27m before deployment start |

No failed-row write falls inside or near the PM9b deployment window
`2026-09-08T23:27:27.200Z`–`23:30:56.981Z`.

## 7. September 8 and September 13 specimen disposition

### September 8 specimen

`e8716b6e-bac3-4d21-855e-bbdb220020d4` published naturally:

```text
scheduled:       2026-09-08T17:00:00.000Z
published:       2026-09-08T17:00:05.084Z
task:            37a0285e-703b-43df-be8d-1bb08c57ce31
task result:     COMPLETED
action:          944ec32b-9e41-4b82-bc33-4d95613ded13
proof:           713b4619-1e10-4686-a2c7-d029aed11a95
sweep job:       208242
sweep result:    success
```

It has one succeeded action, one readback proof, and the full successful task
transition path. It completed about 6h27m before PM9b deployment started.

**No owner operational incident exists for the September 8 specimen.**

### September 13 specimen

`2aa02dcd-cae2-4e6e-9374-a192167a4ec9` remains:

```text
status:            scheduled
scheduled:         2026-09-13T17:00:00.000Z
task status:       QUEUED
publish attempts:  0
external post ID:  null
action/proof:      none yet
binding:           connected Facebook social_accounts row present
```

This is a future expected event, not an incident. Its individual reproducible
fingerprint is:

```text
f4686caa5bd9fb4423a52e8f220122f2bc473c774a8f020c93f1242727d05b76
```

No retry, reschedule, or provider contact was performed.

## 8. New reproducible SDS baseline

The historical serializer was unavailable. This package does not claim to
reproduce or compare against unavailable historical hashes. Instead it banks a
new reproducible baseline, as explicitly authorized.

Capture time:

```text
2026-09-08T23:53:55.453Z
```

### Canonical serialization definition

Each dataset is serialized as compact UTF-8 JSON:

```text
{
  "schemaVersion": "sds-reproducible-v1",
  "dataset": <dataset name>,
  "columns": [<exact selected fields in order>],
  "rows": [[<values in the same field order>], ...]
}
```

Rules:

1. Filters, parameter values, exact selected fields, and SQL `ORDER BY` are
   recorded per dataset in `baseline-manifest.json`.
2. PostgreSQL timestamp values are converted with `Date.toISOString()` to UTC
   ISO-8601 with millisecond precision.
3. SQL `NULL` is JSON `null`.
4. JSON/JSONB object keys are sorted recursively and lexicographically.
5. JSON arrays preserve stored order.
6. PostgreSQL integers remain JSON numbers. `NUMERIC` values retain the decimal
   string representation returned by `pg`.
7. `JSON.stringify` adds no whitespace; SHA-256 hashes the resulting UTF-8 bytes.
8. Encrypted/token columns are excluded. Binding datasets expose only non-secret
   metadata and presence booleans. Each presence boolean is `true` only when its
   source encrypted/token column is both non-NULL and not the empty string:
   `credentials_present`, `api_token_present`,
   `facebook_page_tokens_present`, `access_token_present`, and
   `refresh_token_present`.
9. Canonical files include one trailing newline for repository readability; that
   newline is excluded from the recorded canonical-byte count and hash.

The exact canonical payload for each dataset is retained under
`baseline-canonical/`.

### Banked counts and SHA-256 fingerprints

| Dataset | Rows | SHA-256 |
|---|---:|---|
| `brands` | 3 | `e4681c8abdc8799aaf7c931639edd587cbcb004935a4cd4ddb156a06d3a95ea8` |
| `social_posts_all` | 48 | `34602a7236d80408e32de5eb8e122b413f2fc0310167916054efe0a9c544e004` |
| `social_posts_unpublished` | 45 | `5ca9f1c53613cac643c87c6d95c108e220799a1b56a1617fb03286750b07dfff` |
| `social_posts_scheduled` | 6 | `b26d8ff879bb7c67eb395a22168554db45581e53048cb6961d5b426ca7c35738` |
| `social_posts_consented_h1` | 4 | `c22be2bdbbf591f8a93f0b44a96be909f22d208bb6a39699c84ad06a948ce64f` |
| `remaining_consented_scheduled_specimen` | 1 | `f4686caa5bd9fb4423a52e8f220122f2bc473c774a8f020c93f1242727d05b76` |
| `content_calendars` | 3 | `46ce38ff5cd406cccbeefa1bbfd9456ab039da5801861438df88ddb816529264` |
| `agent_tasks` | 43 | `33d8437e12e9f9b46f26cf0a5d9cabe341bfe1b93d1ee1004165a74e23bd36da` |
| `agent_task_events` | 172 | `fe655ff624bcfa462f1dfcb886766ee4cf53f83976f9fe174e703e7e60bcd957` |
| `external_actions` | 4 | `945ef5d8d304de4731fe24b28487f57ff7e5902c753d672f3db0c9d151b0f45d` |
| `external_proofs` | 4 | `a278a242a9bac795f1969a44ccd8e20b9f5fb31915a4105e14c2ac5bce83721a` |
| `campaigns` | 1 | `52c1ca4e0d8292b7c3073f85dbbbf4781ca9091f4ef687238042c3ba0fdc6158` |
| `ad_creatives` | 3 | `462af18c5daa931671a6e241738ae4927e362aea2a5eac50b1a264629ec7958b` |
| `ad_spend_audit` | 0 | `492f2623b5adb4c9c0e2ac1c86b0472ab577182247e8768fbbff4deb558e389c` |
| `ad_spend_caps` | 0 | `dbea862b6fc9a07a5a7ee496ec101562052904bee651ed4453029a2062d9d4d3` |
| `setup_sessions_lifecycle` | 3 | `15b581d7504bc55ce7b796228bf87058e6550cf1755c7f7e9f5a6e01171be887` |
| `guided_setup_progress` | 3 | `30b3df404d47bd38116d0d92c9c26299a38daa5ca820ef4d8c6f4d4b8b6f8f79` |
| `armed_publish_authorizations` | 0 | `17730dd9e26049cf41ed02fd2d466bb449c287c41a703d347b903071832f52c4` |
| `onboarding_first_win_celebrations` | 0 | `ee061fbdaf9b6fd3f7bf74c4235db5fff79eaf6c28aa469c5c89475ac183cb46` |
| `social_accounts_binding` | 1 | `9d4a1f34ea95bb6d07bd8ba73cd7177e787cd726fa6ca405377a51441ed663e6` |
| `api_integrations_binding` | 2 | `23050ef2ff1cdb71a9d5aa23fcd1044f020559daca9fc3fa5f14a580d540a78f` |
| `google_integrations_binding` | 2 | `93f07b77dec3058eb946002e296becac1460a9a25bb9af7361dc16e932ee0be6` |

## 9. Expected-Events Ledger

Six current scheduled rows may legitimately change this baseline. The durable
machine-readable ledger is `expected-events-ledger.json`.

| Post | Due UTC | Platform | Lineage | Binding | Expected transition |
|---|---|---|---|---|---|
| `5698fa31-b9c3-48fc-a06f-b6da107c5465` | 2026-09-10 16:00 | Instagram | legacy/pre-C1 | none | pre-provider `VALIDATION_FAILED`; no action/proof |
| `8f16aeb8-43ab-4273-9535-9c2f369aeafa` | 2026-09-10 16:00 | Instagram | legacy/pre-C1 | none | pre-provider `VALIDATION_FAILED`; no action/proof |
| `a6163450-685f-4df0-901f-73f8c6faae09` | 2026-09-11 17:00 | Facebook | legacy/pre-C1 | none | pre-provider `VALIDATION_FAILED`; no action/proof |
| `6a06afd2-710f-4824-ace2-28744efff173` | 2026-09-12 16:00 | Instagram | legacy/pre-C1 | none | pre-provider `VALIDATION_FAILED`; no action/proof |
| `484b4f33-edd9-4855-bd9c-5bbeec656bb6` | 2026-09-12 17:00 | Facebook | legacy/pre-C1 | none | pre-provider `VALIDATION_FAILED`; no action/proof |
| `2aa02dcd-cae2-4e6e-9374-a192167a4ec9` | 2026-09-13 17:00 | Facebook | H1 consented | connected | provider attempt; on success one action + one proof |

Recomparison allowance:

- each no-binding legacy row may reduce `scheduled` by one and increase `failed`
  by one while leaving `unpublished`, actions, and proofs unchanged;
- each such row's existing task may change `QUEUED -> EXECUTING ->
  VALIDATION_FAILED` and gain the corresponding two task events;
- the September 13 specimen may reduce `scheduled` and `unpublished` by one and,
  on success, increase published, actions, and proofs by one each while moving
  its task through the complete successful lifecycle;
- any other row mutation, any duplicate action, any unexplained proof, any
  provider write outside the ledger, or any BLACOR application row remains a hard
  stop.

## 10. BLACOR zero-state and PAUSED/$0

Read-only capture at `2026-09-08T23:54:53.501Z` found zero BLACOR application
rows in:

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

Three `api_integrations` records contain the pre-existing provider-returned
Facebook ad-account inventory entry named `BlaCor Ads`. The same OAuth snapshots
bind the South Dixie Storage Page. This is provider connection metadata only;
there is still no BLACOR user, brand, setup session, task, post, campaign,
creative, action, proof, or job-run application state.

The deferred campaign `5eb4a506-e92e-4d94-a63c-7ce2c15ee741` remains:

```text
status:                   launch_failed
task status:              MANUAL_REVIEW
facebook creative ID:     null
facebook ad ID:           null
activation_requested_at:  null
external proof:           none
```

Its previously persisted partial campaign/ad-set identifiers and terminal
permission failure are unchanged. No retry occurred.

PAUSED/$0 remains clean:

```text
SDS ad_spend_audit rows:        0
SDS campaign budget cents sum:  0
SDS ad_spend_caps rows:         0
```

No Meta/provider request was made during this reconciliation.

## 11. Evidence inventory

All reconciliation evidence is under:

```text
review_package/evidence/026-sds-baseline-drift-reconciliation/
```

Key files:

- `lifecycle-raw.json` — read-only lifecycle capture;
- `lifecycle-summary.json` — per-post joined task/action/proof/sweep summary;
- `schema-columns.json` — schema inventory used before baseline selection;
- `baseline-manifest.json` — exact filters, selected fields, parameters, ordering,
  counts, canonical-byte sizes, and hashes;
- `baseline-canonical/*.json` — canonical dataset payloads;
- `expected-events-ledger.json` — all six known future lifecycle events;
- `blacor-paused-zero-state.json` — BLACOR zero-state and PAUSED/$0 capture;
- `SHA256SUMS` — evidence-file integrity list.

## 12. Reconciliation ruling

Every reopening condition is satisfied:

- all six changed SDS rows reconcile to natural scheduled lifecycle;
- no changed-row write aligns with the PM9b deployment window;
- the September 4 checkpoint is complete and shows one action/one proof with no
  retry or duplicate;
- the September 8 specimen published successfully;
- the September 13 specimen remains queued/scheduled and is fingerprinted in the
  Expected-Events Ledger;
- the new reproducible SDS baseline is banked with complete canonicalization
  rules;
- BLACOR application state remains zero;
- PAUSED/$0 remains clean;
- the PM9b technical UI gate is satisfied per Claude's ruling without an
  authenticated live action.

**RECONCILIATION VERDICT: READY FOR OWNER LIVE-EYES CONFIRMATION**

This is an owner-only visual handoff. This evidence does not authorize this agent
to authenticate as James or click the new-business entry control, and it does not
authorize BLACOR-H1, a provider action, a staging mutation, a production action,
or any next slice.

## 13. Owner live-eyes confirmation — completed September 9

James supplied a staging screenshot on September 9, 2026. The screenshot visibly
shows:

- the staging environment banner;
- the completed-owner embedded Setup Agent screen;
- the prompt `What would you like to set up?`;
- the existing-business continuation control; and
- the distinct `Set up a different business` control.

This satisfies Claude's final owner live-eyes requirement for PM9b.

Durable evidence:

```text
confirmation record:
  review_package/docs/026_PM9b_OWNER_LIVE_EYES_CONFIRMATION.md

screenshot:
  review_package/evidence/026-sds-baseline-drift-reconciliation/
  pm9b-owner-live-eyes-2026-09-09.png

PNG dimensions: 1920 x 1080
PNG SHA-256:   e50c9e83dfc9a72b3e15bd486ca03df69d955fa93cd172269a447694b4cbf4dc
```

No control was clicked as part of this evidence-filing action. No code,
deployment, database state, provider state, SDS state, or BLACOR state was
modified.

**FINAL VERDICT: BLACOR-H1 OFFICIALLY REOPENED — READY FOR OWNER JOURNEY**

This ruling reopens the owner journey but does not itself begin BLACOR-H1.