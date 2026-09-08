# 026 — SDS September 4 Routine Publish Checkpoint

**Filed:** 2026-09-08 America/New_York
**Authority:** Read-only historical lifecycle reconciliation
**Database transaction:** `BEGIN READ ONLY` / `ROLLBACK`
**Result:** **COMPLETE — ONE AUTHORIZED PUBLISH, ONE ACTION, ONE PROOF**

## 1. Boundary

This checkpoint was reconstructed entirely from persisted staging state. It did
not log in, retry, publish, reschedule, edit content, contact a provider, deploy,
touch production, or begin BLACOR-H1.

## 2. Consented specimen

```text
post_id:           8b3be13e-2cac-4f5a-aa7f-da70a87c7b7e
brand_id:          d5745758-30a6-462a-baa6-4233216b8f93
calendar_id:       5588f3f0-f90b-4ca0-a00c-d13ed51b2c9e
platform:          facebook
scheduled_time:    2026-09-04T17:00:00.000Z
published_time:    2026-09-04T17:00:05.326Z
status:            published
external_post_id:  140006069194366_122258091542056707
publish_attempts:  0
```

The task's persisted consent object records:

```text
confirmed_at:      2026-08-26T14:52:53.038Z
approver:          owner:8e55c26c-7ac2-4ea6-9884-1703b0806016
destination:       140006069194366
activated_count:   4
consent digest:    c674abb80577c3a2ab958ab191c2d6e6a1d23a6fdfabaebc584c67168e2079b4
```

## 3. Task lifecycle

```text
task_id:   fbad62ae-0995-4bdb-8a28-d10066cf35b6
attempt:   1
result:    COMPLETED
error:     null
```

Persisted transitions:

| Timestamp UTC | Actor | Transition |
|---|---|---|
| `2026-08-26T14:52:53.059Z` | owner | `NULL -> APPROVED` |
| `2026-08-26T14:52:53.075Z` | owner | `APPROVED -> QUEUED` |
| `2026-09-04T17:00:00.841Z` | `system:publish-sweep` | `QUEUED -> EXECUTING` |
| `2026-09-04T17:00:05.332Z` | `system:publish-sweep` | `EXECUTING -> PROVIDER_ACCEPTED` |
| `2026-09-04T17:00:05.772Z` | `system:publish-sweep` | `PROVIDER_ACCEPTED -> EXTERNALLY_VERIFIED` |
| `2026-09-04T17:00:05.775Z` | `system:publish-sweep` | `EXTERNALLY_VERIFIED -> REPORTED` |
| `2026-09-04T17:00:05.777Z` | `system:publish-sweep` | `REPORTED -> COMPLETED` |

## 4. Scheduler correlation

```text
job_run:      186098
job_name:     social-publish
tick_key:     2026-09-04T17:00:00.000Z
started_at:   2026-09-04T17:00:00.824Z
finished_at:  2026-09-04T17:00:05.780Z
outcome:      success
error:        null
```

The task claim, provider acceptance, proof verification, and completion all fall
inside this single scheduler run.

## 5. External action

```text
action_id:       769a2232-eda0-4e85-938e-f240675a2abe
provider:        facebook
action:          social_publish
attempt:         1
status:          succeeded
classification:  null
error:           null
external_ref:    140006069194366_122258091542056707
dedup_count:     0
started_at:      2026-09-04T17:00:00.854Z
finished_at:     2026-09-04T17:00:05.323Z
```

There is exactly one action for this task. The action has no retry, no duplicate,
and no dedup hit.

## 6. External proof

```text
proof_id:       71f31d06-a2d3-4e3f-b53b-07e73c6b21f6
run_key:        task-fbad62ae-0995-4bdb-8a28-d10066cf35b6
provider:       facebook
action:         publish_readback
external_id:    140006069194366_122258091542056707
verified_at:    2026-09-04T17:00:05.769Z
permalink:      https://www.facebook.com/122254631936056707/posts/122258091542056707
```

There is exactly one proof. Its external ID matches the post and action external
references.

## 7. Delta attribution

This checkpoint closes the missing September 4 routine evidence gap, but it does
not explain the September 5-to-September 8 baseline delta. The publication
completed before the September 5 capture cutoff and was already present in that
baseline.

The later delta is explained by the separate September 8 consented publication.

## 8. Verdict

**COMPLETE — NATURAL AUTHORIZED SYSTEM LIFECYCLE**

The September 4 specimen has a complete one-task, one-attempt, one-action,
one-proof chain with no retry or duplicate.