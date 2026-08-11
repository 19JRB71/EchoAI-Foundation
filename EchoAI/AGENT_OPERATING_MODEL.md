# Zorecho Agent Operating Model (Prompt 025)

**Governing invariants (owner-ruled, verbatim):**

> "The Prompt 025 registry documents and tests the operating model; it does
> not itself grant runtime authority."

> "Echo's evidence precedence selects what may be claimed; it does not
> rewrite underlying records."

> "Absence of proof is never proof of failure."

> "The registry describes operating entities by role; it does not redefine
> every runtime automation as an agent."

**Master rule:** Prompt 025 documents reality honestly, while Echo claims only
what authoritative evidence actually proves.

## What this is

`config/agentRegistry.js` is a **descriptive** registry of Zorecho's operating
entities. It documents and tests the operating model. It does **not** grant
runtime authority: no tool call becomes authorized because the registry lists
it as permitted — only existing enforcement boundaries authorize anything. A
registry mismatch is a test/report failure; it is never "fixed" by broadening
permissions to match implementation.

## Composition (derived from the current tree — never a hand-copied constant)

Operating entities are NOT all called agents. Composition is reported by role
class, derived at validation time from:

1. `AGENTS` roster keys in `controllers/agentsController.js` — the named
   agent identities (director + specialist agents);
2. `scheduleJob` registrations in `utils/scheduler.js` — the scheduled
   automations;
3. task-type vocabulary from migrations `models/131/132/133` —
   `social_publish`, `reconciliation`, `ad_launch`, `email_send`;
4. Hermes (`config/hermes.js`) as its own **decision_brain** class.

Role classes (closed vocabulary): `director`, `specialist_agent`,
`scheduled_automation`, `decision_brain`.

### Role-class mapping — authorized 8-class vocabulary → implemented 4

The authorized registry contract described an 8-class closed vocabulary. The
implementation consolidates it to 4 role classes; the remaining distinctions
are carried by orthogonal registry fields, not lost. Deterministic mapping
(validated by `tests/registryContractMapping.test.js`):

| Authorized class | Implemented representation |
|---|---|
| `interface_personality` | role class `director` (Echo — the only owner-facing personality) |
| `department_head` | role class `specialist_agent` (each named identity heads its department) |
| `worker` | role class `specialist_agent` — the same named identities execute their own department's work; the tree has no separate worker entities to classify |
| `tool` | not a role class: capability inventory lives in each entry's `permittedTools` |
| `automation` | role class `scheduled_automation` |
| `scheduled_job` | role class `scheduled_automation` (the per-job `JOB_META` entries) |
| `approval_authority` | not an agent class by design: approval authority rests with the **owner** only; encoded as `prohibitedActions` ("never self-approve") on every entry |
| `execution_service` | not a role class: execution mechanics are the execution-path classes below (`spine_executeExternal`, `gated_ai`, …) |

`decision_brain` (Hermes) is an implemented class outside the original 8 —
required because Hermes is neither a personality, a department, nor a job
(descriptive-only entry, D-9). No operating-model distinction required by
Prompt 025 is expressible in the 8-class vocabulary but not in this scheme;
the consolidation is equivalence under D-39's "operating entities" ontology,
made explicit here rather than silently changed.

The registry validation suite (`tests/agentRegistry.test.js`) derives the
expected inventory from those sources **both directions**: a runtime entity
missing from the registry fails validation, and a registry entry with no
current-tree counterpart fails validation unless explicitly `historical`/`dark`.

## Execution-path classes (closed vocabulary)

| Class | Meaning |
|---|---|
| `spine_executeExternal` | adopted task-spine flow with external side effects |
| `adapter_backed` | legacy adapter recorded into the spine (D-29.7 ratchet; named retirement prompt) |
| `feature_only` | feature tables only — **cannot support verified-success claims** |
| `dark` | built, flag-off |
| `gated_ai` | AI via `config/anthropic.createMessage` + aiGate + `ai_usage_log` |
| `ungated_ai` | I-42 direct-provider call sites — **description-only in Prompt 025**; not migrated, not dressed up as gated |

I-42 ungated-AI liability — two baselines are kept so it can never silently
shrink: **historical acceptance baseline 22 files / 37 direct
`anthropic.messages.create` sites** (narrow literal pattern of that audit),
and **current observed liability 30 files / 43 direct `*.messages.create(`
sites** (broad basis: any client variable name; excludes tests and the gated
chokepoint `config/anthropic.js`). The delta is a counting-basis correction —
the earlier 16-file registry list omitted the 14 `prompts/*.js` modules —
not a migration; nothing has been repaired or gated. The full file list is
`config/agentRegistry.js` `UNGATED_AI_FILES`, re-derived from the tree by
`tests/registryContractMapping.test.js` (fail-closed).
| `none` | no external side effects / no AI |

Current adopted spine-native external-side-effect flows (verified in tree):
social publish, Autopilot ad launch, marketing/report email, Prompt-024
first-win Facebook publish.

PERMITTED ≠ CURRENTLY USED. Observed legacy behavior that exceeds the intended
operating model is recorded in each entry's `discrepancies` — never legitimized
by broadening `permittedTools`.

## Echo's claim discipline (`utils/honestStatus.js`)

Closed outcome vocabulary: `verified_success`, `in_progress_or_prepared`,
`known_failure`, `manual_review_uncertain`, `temporarily_unverifiable`.

- **Unknown is not negative.** "I cannot verify that it published" is NOT
  "It failed to publish." Read-source failure yields
  `temporarily_unverifiable` ("I can't verify that right now") — never
  optimistic success, never invented failure.
- **Deterministic correlation only.** Verified-success narration requires the
  actual lineage: logical operation → task/attempt → external action → proof
  (`agent_tasks.proof_id` → `external_proofs`). No brand-level "any proof
  somewhere" join may support a verified-success claim. Uncorrelatable flows
  cap at "per our records — not externally verified."
- **Freshness is honesty.** Historical proof establishes a historical event —
  "verified live on/as of [timestamp]" — not present state. No arbitrary TTL
  exists (Stage-1's 24-hour candidate was explicitly NOT implemented).
- **Attribution honesty (B5).** An outcome is attributed to a named agent only
  when lineage proves both event and actor; e.g. social_publish lineage does
  not record Nova, so Echo reports the verified event without agent credit.
  No new lineage columns were added.
- **created_paused (D-39, Section C).** Narrated as
  "created, paused — not spending". It can never appear in a running count or
  a running/spending sentence. The campaign state machine is untouched —
  narration/reporting only.
- **Prompt-024 first win (Section G).** `honestStatus.forFirstWin` reads the
  actual authorization → proof → celebration records. Prepared is never
  published; armed is never won; provider-accepted without read-back is not a
  first win. The onboarding status endpoint remains a projection, not an
  authority.

## Knowledge authority (Section A9)

Fact-proposing agents/workflows (Sage research, autonomous growth, discovery,
Prompt-023 interview) are PROPOSERS through the brandKnowledge boundary. They
never become authoritative profile writers. Approved/versioned brand knowledge
is distinct from unapproved proposals, draft research, and legacy unversioned
values. Proposal ordering is candidate/question selection — not authority.

## Echo Claim Matrix

The design contract for `honestStatus` (each row has regression coverage):

| Claim class | Authoritative source | Verified-success possible? |
|---|---|---|
| external social publish | social_publish task lineage + proof | yes (proof only) |
| Prompt-024 first win | authorization + proof + celebration | yes (proof only) |
| campaign current state | campaigns.status + recorded verification | "verified live as of" only |
| ad launch outcome | ad_launch task lifecycle + proof | yes (proof only) |
| email/report delivery | email_send task truth (Message-ID gate) | yes (spine truth) |
| SMS send | sms_messages + failure classification | recorded-only |
| brand fact | approved brandKnowledge versions | approved vs unapproved phrasing |
| setup/gap nudge | guided-setup live probes | probe truth; unknown on failure |
| inbox/lead counts | tenant-bounded counts | quantities (identity reads) |
| agent activity rollup | spine truth where adopted; else `sourceClass: 'feature'` | labeled honestly |

New claim classes discovered later must add a row plus tests — no ad-hoc
status narration outside this discipline.

## Query / tenant safety (Section I)

Rollup/status reads are tenant/brand-bounded, batched, free of N+1 and
unbounded scans, and make **no provider calls** — freshness comes from
recorded authoritative evidence only. Tenant isolation is unchanged.
