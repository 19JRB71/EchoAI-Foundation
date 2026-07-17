# Sage V2 — Phase 3 Architecture (Milestone 3)

Status: architecture review — pre-implementation.
Blueprint of record: `SAGE_V2_CHALLENGE_REVIEW.md` Part 4 (P3 row) + `SAGE_V2_ARCHITECTURE.md` §6 (Outcome capture — the linchpin).
Lifecycle: Architecture review → Implementation → Testing → Architect self-review → Completion report → CEO approval.

## 1. Approved scope (verified against the blueprint)

Phase 3 = **Outcome capture + attribution fields + coverage displays.** Nothing else.

1. **Outcome schema on `leads`** (§6): `outcome` (`won|lost|no_show|unqualified|NULL`),
   `outcome_reason` text, `deal_value_cents` bigint NULL, `outcome_at` timestamptz,
   `outcome_source` (`owner|voice|crm|assumed_from_appointment`).
   - **As-built note (migration 118):** `outcome_source` additionally allows
     `'autonomous'` so a convert detected by Autonomous Conversations is recorded
     honestly as machine-detected rather than mislabeled `'crm'`. Naming-only
     widening of the blueprint enum; semantics unchanged.
2. **Capture paths — existing surfaces only, no new UI paradigm:**
   - Pulse/CRM lead card: two-tap "Won — $X / Lost — why?" chips (`Leads.jsx`/`LeadDetail.jsx`).
   - Voice: Echo asks during the morning briefing about stale hot leads that had
     appointments; the answer is parsed (Hermes) into the outcome fields — reuses the
     existing briefing + assistant-task machinery.
   - Autonomous Conversations: a detected `convert` sets `outcome='won'` **pending value**
     (deal value stays NULL until the owner supplies it — never fabricated).
3. **Attribution v2 fields on `leads`** (§6): `campaign_id`, `first_touch`,
   `converting_touch` — three columns populated by **existing** code paths (lead creation
   source; Autonomous Conversations know the converting channel). Multi-touch modeling is
   **explicitly rejected** by the blueprint; we add fields only.
4. **Coverage displays** (§6 honesty rule): every metric computed from outcomes shows its
   coverage ("based on the 62% of leads with recorded outcomes"); below **30% coverage**,
   financial views show the coverage prompt instead of numbers.

Explicitly **NOT** in Phase 3 (later phases — do not build): opportunities, directives,
decisions, offers, constraints, Executive Memory, Change Diagnostics, forecasts,
experiments, playbooks, channel scorecards, campaign-level profit reports (P6 uses the
fields; P3 only records them).

## 2. Dependencies from Milestones 1 & 2 (verified in code)

| Dependency | Where it lives today | Phase 3 use |
|---|---|---|
| `SAGE_V2_ROI_LABELS` flag + `EstBadge` (M1) | `config/aiControls.js`, `client/src/sections/roi/AdvancedRoiDashboard.jsx` | coverage displays extend the same honesty-labeling surface; must not conflict with Est badges |
| Briefing machinery (M1 consolidated weekly output) | `utils/echoBriefing.js` (`gatherBriefingData`, open questions) | voice outcome-asks ride the existing briefing/open-question path |
| Existing `leads` schema | `models/schema.sql`: `conversion_status` enum (`new/in_progress/converted/lost`), `temperature` | outcome columns are **additive**; `conversion_status` remains untouched (see §4 conflict note) |
| Autonomous convert detection | `controllers/autonomousConversationController.js` (~L300: Hermes state `converted` → `leads.conversion_status='converted'`) | same code path additionally sets `outcome='won'`, `outcome_source`, `converting_touch` |
| Manual convert | `controllers/leadController.js` `convertLead` | sets outcome fields alongside `conversion_status` |
| ROI virtual attribution | `roiDashboardController.js` `TOUCH_SUBQUERIES` | unchanged in P3; coverage gate wraps its financial outputs when the flag is ON |
| Intel store / skip gates (M2) | `utils/intelStore.js`, `utils/skipGates.js` | P3 writes **no** intel items and adds **no** recurring AI jobs, so no new gate wiring; any future outcome-derived aggregates (P6) will go through the canonical store |
| Echo assistant stale-hot-lead auto-tasks | Echo Personal Assistant machinery | the "did the Hendersons move forward?" ask targets stale hot leads **with appointments** — reuse, don't duplicate |

Milestone-2 flags stay OFF; Phase 3 introduces no coupling that requires them ON.

## 3. Feature flags (new, all default OFF)

- `SAGE_V2_OUTCOME_CAPTURE` — lead-card chips, voice asks, autonomous/manual convert
  writing the outcome fields. OFF = columns exist but nothing writes or renders them;
  behavior byte-identical to today.
- `SAGE_V2_COVERAGE_DISPLAYS` — coverage % on outcome-derived metrics + the <30%
  financial-view gate. OFF = today's displays untouched.
  (Attribution fields are written under `SAGE_V2_OUTCOME_CAPTURE` too — they're inert
  columns with the flag off; a third flag would add surface without safety.)

## 4. Risks & conflicts identified (report-before-change items)

1. **Two truths for "won": `conversion_status` vs `outcome`.** Conflict avoided by rule:
   `conversion_status` remains the operational pipeline state (drives follow-up
   cancellation etc.); `outcome` is the **measurement record**. Convert paths set both;
   nothing reads `outcome` to drive behavior in P3. One-way sync only
   (`converted → outcome='won'` when outcome is NULL); we never back-propagate outcome
   edits into `conversion_status`. This keeps flags-off parity and avoids enum surgery.
2. **Fabrication risk on `assumed_from_appointment` / autonomous `won`.** Deal value is
   NEVER estimated; `deal_value_cents` stays NULL until owner-entered, and coverage math
   counts value-less wins as "outcome recorded, value missing" (shown honestly).
3. **Voice parse risk.** Hermes parse of a spoken outcome fails → no write (fail closed),
   Echo asks for a tap instead; never write a guessed `deal_value_cents`.
4. **Coverage gate vs existing ROI "Estimated" labels.** The Advanced ROI dashboard's
   modeled revenue is an estimate by design (M1 labels). Rule: coverage gate applies only
   to metrics **claiming to be computed from real outcomes**; Est-labeled modeled figures
   keep their badges and are not double-gated.
5. **`campaign_id` referential shape.** `campaigns` linkage today is indirect; the new
   column is nullable FK populated only where creation paths genuinely know the campaign —
   never inferred retroactively (that would be the multi-touch pseudo-science the
   blueprint rejects).
6. **Client bundle change.** Unlike M2, P3 touches the SPA (lead chips, coverage
   displays) → deploy needs a client rebuild.

**No architectural conflicts with the approved Sage V2 architecture were found.** The
canonical-source rule (M2) is unaffected: P3 writes operational lead data, not
intelligence items.

## 5. Verification plan

- Migration 118 additive + idempotent; flags-off parity tests (no writes, no UI change).
- Unit/integration tests: chip capture (owner), autonomous won-pending-value, manual
  convert dual-write, voice parse fail-closed, coverage math incl. <30% gate and
  value-missing wins, foreign-brand ownership guards on every new endpoint.
- Full suite + client tests + client build; architect self-review; completion report.

## 6. Completion report (as built — July 17, 2026)

**Status: implemented, tested, architect-reviewed (PASS). Awaiting CEO approval.**

- **Migration 118** — additive columns on `leads` (`outcome`, `outcome_reason`,
  `deal_value_cents`, `outcome_at`, `outcome_source`, `first_touch`,
  `converting_touch`, `campaign_id`) applied to dev + test DBs; `outcome_source`
  CHECK includes `'autonomous'`.
- **Server** — `utils/leadOutcome.js` is the single chokepoint: `recordOutcome`
  (owner authority, overwrite allowed), `markWonFromConvert` (one-way, only when
  outcome IS NULL, best-effort), `setFirstTouch`/`setCampaign` (stamp once),
  `coverageForBrand` (deterministic; `sufficient = pct >= 30`),
  `queueOutcomeQuestions` (briefing asks for stale hot leads with past
  appointments, deduped), `parseOutcomeAnswer` (Hermes, fail-closed) +
  `applyOutcomeAnswer` (source `'voice'`, only when outcome IS NULL).
- **Endpoints** — `POST /api/leads/:leadId/outcome`, `GET
  /api/leads/outcome-coverage` (registered before `/:leadId`); both flag-gated
  (`{enabled:false}` when dark) and ownership-guarded. `GET /api/leads/:leadId`
  adds `outcomeCapture:true` ONLY when the capture flag is on — flag-dark
  responses are byte-identical.
- **Client** — LeadDetail outcome chips (Won w/ optional $ value — never
  guessed; Lost w/ optional reason; No-show; Not a fit) render only when the
  server says capture is enabled; Leads coverage banner renders only when the
  coverage endpoint answers `{enabled:true}`. Modeled EstBadge ROI figures are
  NOT double-gated (risk #4). Client rebuilt.
- **Honesty rules held** — `deal_value_cents` never fabricated ("won, value
  pending" is first-class); voice parsing fails closed; `leads.outcome` is
  measurement-only — no behavior anywhere depends on it, and outcome edits never
  back-propagate into `conversion_status`.
- **Verification** — `tests/sageV2Phase3.test.js` 10/10; full server suite
  842/842 (was 832); client 367/367; client build clean; architect review PASS
  with no severe findings.
