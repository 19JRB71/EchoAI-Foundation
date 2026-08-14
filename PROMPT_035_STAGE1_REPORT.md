# PROMPT 035 — STAGE-1 REPORT
Onboarding Rebuild: PI-Model Orchestration, Owner-Fact Handoff, Second-Business Entry

- Date: 2026-08-14 (America/New_York)
- Stage: 1 — READ-ONLY investigation + design. No code, config, schema, DB, or provider writes were made.
- Audit surface (D-37 compliant): fresh clone of `19JRB71/EchoAI-Foundation` @ `bd73b01` (origin/staging tip = the verified staging SHA bd73b013), cloned to `/tmp/d37-035`. **All file:line citations in this report are from that clone**, not the dev workspace.
- Status: COMPLETE — awaiting owner + ChatGPT + Claude review. Stage 2 NOT started.

## ⚠️ STAGE-1 DISCOVERY THAT PRECEDES EVERYTHING (STOP-worthy, reported, worked around read-only)

**The dev workspace tree is NOT the staging code.** The verified SHA `bd73b013` does not exist in the workspace git history, and `diff -rq` shows the workspace is **168 files behind/divergent from real staging** — including files central to this prompt: `SageResearchPanel.jsx`, `ProfileReview.jsx`, `utils/brandKnowledge.js`, `utils/interviewGapEngine.js`, `utils/sageResearch.js`, `models/137–140_*.sql`. Consequences:

1. Some Prompt-026 H1 code citations made from the workspace (e.g., the H1-F2 claim that "Build my report" is the *sole* Company Truth path) were made against stale code. They are **re-derived below from the clone**; where the finding changes materially, that is stated explicitly.
2. **Staging already contains most of the PI substrate this prompt asks for.** The bd73b013 tree already has: per-brand Sage research runs with claim/supersede and provenance (Prompt 022), the four-state gap-driven interview engine (Prompt 023), the immutable brand-knowledge version/revision store with the exact six-value SOURCE enum (Prompt 011), and a `SageResearchPanel` embedded in the guided wizard that auto-starts research (`GuidedSetupWizard.jsx:440`). Prompt 035 is therefore overwhelmingly an **orchestration/wiring** exercise, exactly as Section B4 demands — not new machinery.
3. Any future Stage-2 work must be performed on a checkout of real staging, and the workspace drift itself should be reconciled first (reported; not fixed — out of scope).

## REQUIRED VERIFICATION — D-37 BASELINES (re-derived, not assumed)

Run inside the fresh clone `/tmp/d37-035/EchoAI` @ `bd73b01`. (npm registry firewall blocked a fresh install; the clone's `package-lock.json` and `client/package-lock.json` are **byte-identical** to the workspace's, so the installed dependency trees were copied in unchanged — same audited dependency set, zero network fetch.)

- Server: `npm test` → **tests 1370, pass 1370, fail 0, cancelled 0, skipped 0** (duration 91.4 s). Matches reference 1370/1370.
- Client: `npm test` (vitest) → **Test Files 41 passed (41), Tests 430 passed (430)**. Matches reference 430/430 across 41 files.
- Logs: `/tmp/d37-035/server-test.log`, `/tmp/d37-035/client-test.log`.

---

## G-1. CURRENT-FLOW AUDIT (as-is sequence, with H1 evidence + friction map)

As-is flow at bd73b013 (each step = owner surface → server → storage):

1. **Signup** — `Login.jsx:134-190` → `POST /api/auth/register` → `users` row. (H1: SDS user `bbd317fd-…`, ~18:16 UTC Aug 13.)
2. **Setup Agent interview** — `initiateSession` (`setupAgentController.js:1348-1430`): resumes any `in_progress|paused` session for the user (1351-1356) or creates one with `brand_id = inv.brandId || null` (1411-1421); Prompt-023 gap plan drives question selection from turn one (1389-1406). Answers land in `setup_sessions.answers` JSONB keyed by `current_field` (per-answer POST). H1: consent 18:16:47, completed 18:41:12 (~25 min wall).
3. **Consent → actions** — consent-gated action runner; `create_brand_profile` seeds discovery + brand; `applyOnlinePresence` copies only website/facebook keys (clone: `:326-357`); `set_availability` writes **default weekday 9–5** (`:561-584` — detail string literally "Set weekday hours (9–5)"); content calendar, ad creative draft, survey, email step (H1: email step system-skipped after AI retries).
4. **Guided wizard** — plan → profile (with **`SageResearchPanel` auto-start**, `GuidedSetupWizard.jsx:440`) → first win → connections → team (`GuidedSetupWizard.jsx:26-44`); progress in `guided_setup_progress` (`models/096:10-18`).
5. **Company Truth** — owner-initiated `POST /api/company-truth/generate` from Sage (`Sage.jsx:2032,2106`, "Build my report"); claim/generate/promote per `companyTruthController.js:119-285`; approval joint with the CT knowledge revision (`:291-330`).
6. **Ongoing** — dashboard, Echo, content pipeline.

**Friction map (H1 evidence = the BEFORE specimen):**
- Signup→interview-complete: ~25 min (mostly active owner typing/answering).
- Interview→dashboard: dominated by owner reading/skipping wizard cards; system waits are the AI action steps (content calendar generation, failed email designer retries — pure system time the owner sat through).
- Company Truth: generated ~19:25 UTC — ≥40 min after onboarding data existed, and only because the operator navigated to Sage and clicked. Orchestration delay, not compute delay (generation itself ran in ~1–2 min inside a 90 s research budget + CT generation).
- H1-F3 friction: owner answered phone/hours in the interview, then would have to re-provide them at review because the collection layer stranded them (see G-2/G-8).
- Known H1 wall-clock (signup 18:16 → CT pending 19:25): ~69 min to a *pending* dossier without any connections made — before corrections, approval, first win, or any campaign work.

## G-2. FIELD MATRIX (collection → storage → consumers, with completeness proof)

**Enumeration method (mechanical):** in the clone only — (a) `rg --files` over `client/src/onboarding`, `client/src/sections/Login.jsx`, `controllers`, `prompts`, `routes`, `models`; (b) read of every guided-wizard JSX, `SetupAgent.jsx`, `Login.jsx`, `ProfileReview.jsx`, `ApprovalsInbox.jsx`; (c) extraction of the full interview key universe from `prompts/setupAgentPrompt.js:26-83` (the JSON contract enumerates every `collects` key the director may emit); (d) per-key grep tracing into SQL call sites and consumers. Full raw audit preserved at `/tmp/d37-035/audit-field-matrix.md`.

**Reconciliation:** 28 unique Setup-Agent answer keys (business 13 / real-estate 12 / political 13, overlapping shared keys counted once; `business_hours`≡availability counted once) + 5 signup fields + 7 OnlineLinksPanel fields + 2 subscription + 2 email-credential + 3 team-invite + 8 first-win inputs + 1 voice sample + 1 rescue screenshot = **52 concrete collected inputs enumerated; 45 named scalar user-entered fields**. Matrix rows = 52; code-derived keys = 52; delta = 0. Fields whose downstream consumer could not be proven by grep are marked **UNVERIFIED/NONE FOUND** below rather than assumed.

Condensed matrix (full key list in the raw audit file):

| Field (key) | Collected | Stored | Consumed downstream | Status |
|---|---|---|---|---|
| email, password, teamSize, referralCode, rememberDevice | `Login.jsx:134-190` → `/api/auth/register` | `users.*` | auth, seats, affiliate attribution | OK |
| account_type | interview (`setupAgentPrompt.js:26`) | `setup_sessions.answers` | branches all actions (`:265-357`) | OK |
| business_description, primary_goal, target_audience, offering_type, brand_personality | interview | `answers` JSONB | `compiledBusinessSummary` → discovery seed → brand + knowledge versions (`brandDiscoveryController.js:146-165`) | OK (synthesized, provenance `inferred`) |
| business_website, facebook_page | interview | `answers` → `brands.website_url/facebook_page_url` (`setupAgentController.js:326-357`) | Sage research anchors, links panel prefill | OK |
| **business_hours** | interview (`setupAgentPrompt.js:59-64`) | `answers` JSONB **only** | `set_availability` **ignores it; writes 9–5 default** (`setupAgentController.js:561-584`) | **DEFECT (H1-F3)** |
| **phone** (when interview director elicits it) | `answers` JSONB | **no propagation**; Company Truth reads `users.phone` (`utils/companyTruth.js:124` — clone-verified) | **STRANDED (H1-F3)** | **DEFECT** |
| **address** | not a declared prompt key; director can target it (`SetupAgent.interview.test.jsx:169-175`); Sage research discovers it | `answers` / knowledge `address` field | knowledge review only; no structured onboarding consumer found | **UNVERIFIED consumer** |
| posting_platforms, advertising_budget, google_ads, email_focus | interview | `answers` | content-calendar action, google_ad_plans insert (`:853`), email step | OK |
| echo_daily_briefing / instant_alerts / detail_level / involvement | interview | `answers` → working-style extraction (server tests confirm `extractWorkingStyle`) | Echo settings | OK |
| real-estate keys (agent_name … active_listings) | interview | `brands.real_estate_profile` JSONB (`:332-345`) | vertical features | OK |
| political keys (candidate_name … paid_for_by) | interview | `brands.campaign_profile` JSONB | political gating/disclaimers | OK |
| 7 online links | `OnlineLinksPanel.jsx:16-24,115-132` | `brands` link columns | Sage anchors, publisher | OK |
| tier + payment method | `StepSubscription.jsx:67-259` | Stripe + billing tables | billing | OK |
| team email/role/phone | `StepTeam.jsx` → `/api/team/invite` | invitations | seats/roles | OK |
| business-email addr + app password | `ConnectionsStep.jsx:365-504` | encrypted email account | email assistant | OK |
| first-win choice/topic/goal; lead name/email/phone | `FirstWinStep.jsx:168-703` | first-win + `leads.*` | first-win spine; lead pipeline | OK |
| knowledge corrections | `ProfileReview.jsx:175-299,338-391` → `ownerEditKnowledge` | `brand_knowledge_versions` (source `stated`) | all knowledge consumers | OK |
| voice sample; rescue screenshot | `SetupAgent.jsx:275+`; `HelpMeRescue.jsx` | voice tables / vision path | voice engine; rescue | OK (transcripts intentionally not persisted) |

**Documented absences (the honesty defects, clone-verified):** (1) `business_hours` answer → availability: consumer exists but substitutes the default — the named 8–5→9–5 silent substitution; (2) interview `phone` → `users.phone`/knowledge `phone`: no path; (3) interview `address` → knowledge `address`: no path; (4) generally, **no interview answer produces a `brand_knowledge_versions` row** — only the discovery-synthesis fields do (`brandDiscoveryController.js:158-165`), so owner-*stated* facts enter the substrate only when re-typed at ProfileReview.

## G-3. PROVENANCE MAPPING (owner concepts → existing substrate; no new taxonomy)

Authoritative SOURCE vocabulary (`models/138_brand_knowledge_source_enum.sql:12-28`; `utils/brandKnowledge.js:46`): `stated | website | facebook | public_web | inferred | connected`.

| Owner concept | Existing substrate value/state | Notes |
|---|---|---|
| owner-provided | `stated` (owner edits are immediate approved versions, `brandKnowledge.js:514-563`) | interview answers must land as `stated`, not `inferred` |
| website / social / other public | `website` / `facebook` / `public_web` | already emitted by 022 research with per-field URL+timestamp+excerpt provenance (`sageResearch.js:153-223`) |
| connected-provider | `connected` | reserved for OAuth-verified identity data |
| inference | `inferred` | discovery synthesis already uses it |
| conflicting | **state, not source**: research draft `alternatives`/CONTESTED (`sageResearch.js:153-223`; `SageResearchPanel.jsx:183-236`) + gap-engine `draft_conflict → arbitrate` (`interviewGapEngine.js:210-239`) | no change |
| unknown/unverified | **state**: `missing`/`legacy_unreviewed` inventory states; revision `pending` | no change |

**Additive extension needed: NONE.** The six sources plus existing revision states (`pending|approved|rejected|base_superseded`, `models/137:109-145`) and gap-engine states cover every owner distinction. No second taxonomy is proposed (Section-F guard satisfied).

## G-4. PI-MODEL DESIGN (per-anchor triggers on existing machinery)

**Reuse points (all existing, cited):** run claim + one-in-flight via unique-violation → 409 (`utils/sageResearch.js:229-266`); guarded single-transaction finalize + supersede of prior terminal drafts (`:275-321`); per-field provenance candidates ordered website>facebook>public_web>inferred (`:153-223`); budgets $0.50/90 s/stale-10 min (`:58-80`); trigger endpoint `POST /api/brands/:brandId/research` (`sageResearchController.js:45-66`); wizard auto-start panel (`GuidedSetupWizard.jsx:440`; `SageResearchPanel.jsx:94-176`); Company Truth claim/promote/approve (`companyTruthController.js:119-330`; `brandKnowledge.js:343-371`).

**Design:** introduce one thin server-side hook — `onAnchorArrival(brandId, anchorKey)` — invoked from the three places anchors are persisted today (brand creation from interview; `applyOnlinePresence`; OnlineLinksPanel `updateBrand`; FB connect callback). The hook debounces (G-6) and then calls the *existing* research trigger. Each research run already snapshots what it knew; enrichment = a **new run** that supersedes the prior terminal draft (existing supersede path), never a mutation of it.

**Investigation-snapshot rule answers:**
- *Material step* = one `sage_research_drafts` run reaching a terminal status (`complete|partial|empty|failed`).
- *Frozen per step* = the finalize transaction already freezes fields, per-field provenance (URL/timestamp/excerpt), summary, stop_reason, cost, elapsed (`sageResearch.js:275-321`); rows are never edited after terminal.
- *Anchor recording* = the run summary already records inputs (e.g., locationHint recorded in summary, `:419-440`). **One additive gap:** the full anchor set available at claim time is not stored as a structured column. Additive fix: `anchor_snapshot JSONB` on `sage_research_drafts` (G-15).
- *Supersede-without-rewrite* = existing: prior terminal drafts are marked superseded, not modified; history remains queryable.
- *Existing-records sufficiency* = **YES except** the structured `anchor_snapshot` column above. No new table required. (No migration beyond that single additive column; see G-15.)

## G-5. ENTITY-CONFIDENCE MODEL (decision table — deterministic, auditable)

Identity states (reuse existing vocabulary): **PROVISIONAL** (research draft unapproved — today's default, `SageResearchPanel.jsx:1-11`), **IDENTITY-ESTABLISHED**, **CONFLICTED** (maps to gap-engine `draft_conflict`/arbitrate). Deterministic rule — no numeric AI "confidence" score is proposed:

| Anchors present | Identity state | Permitted research depth |
|---|---|---|
| name only | PROVISIONAL | none beyond name-echo; **no public_web attribution** of same-name facts; queue Boz disambiguation ask |
| name + location | PROVISIONAL | public_web limited to name+location-qualified queries; facts marked `public_web` w/ alternatives retained |
| name + owner-entered website | IDENTITY-ESTABLISHED (site is owner-designated) | full: website crawl + public_web cross-check |
| name + owner-entered FB page | IDENTITY-ESTABLISHED | full: facebook + public_web cross-check |
| connected-provider identity (OAuth page/GBP) | IDENTITY-ESTABLISHED (strongest) | full; provider facts as `connected` |
| website vs social vs location vs provider disagree on identity (domain/page/geo mismatch) | CONFLICTED | freeze depth at last consistent set; surface CONTESTED alternatives; require owner arbitration (gap engine `arbitrate`) |
| no website ("I don't have one") | valid; state from remaining anchors | facebook/public_web only; no fabricated site |
| no social | valid | website/public_web only |

**Provisional case-file semantics:** provisional facts live only as unapproved research-draft fields (existing). They can never become approved Company Truth by themselves because approval already requires the owner's explicit joint approval of report + CT revision (`companyTruthController.js:291-330`) and knowledge versions only appear via owner edit/approval (`brandKnowledge.js:378-465`). **Wrong-entity containment:** the containment boundary is that same approval gate + the depth limits above; regression tests named in G-16.

## G-6. DEBOUNCE / ENRICHMENT + AI-BUDGET DESIGN

- **Anchor arrival:** `onAnchorArrival` sets/refreshes a per-brand debounce timer (design value: 120 s quiet period; first-anchor grace 30 s). Timer fire → if a run is in flight, mark "rerun-wanted" (existing 409 path already signals in-flight); else trigger run with current anchor set.
- **Enrichment vs full run:** a new run is scheduled only if the anchor set *changed materially* (new key or changed value among: website, facebook/social, location, connected identity, owner-words). Re-saves of identical values are no-ops → "repeated anchors do not cause redundant runs."
- **Budget gate (all existing):** every research call already passes `aiGate` → `checkBudget` with per-brand daily/monthly caps (`aiBudget.js:66-101`; defaults 25/400/2/10/10/150 USD, `config/aiControls.js:67-73`) and the $0.50/90 s per-run reservation (`sageResearch.js:58-80`). PI adds a design cap: **max 4 auto-triggered runs per brand per onboarding day**; further anchors coalesce into the 4th.
- **Abandoned signup:** auto-runs are triggered only by anchor writes, which stop when the owner stops; the debounce means an abandoned half-signup costs at most 1 run (≤ $0.50). Background class is already blockable at the 90 % budget threshold (`aiBudget.js:6-15`).
- **Spend arithmetic:** worst case per onboarding = 4 runs × $0.50 + 1 CT generation (existing CT budget) ≈ **≤ $2.00 + CT** — inside the $10 default brand-daily cap with headroom.

## G-7. ASYNC PROGRESS UX

- While research runs: the existing `SageResearchPanel` running state (poll 4 s, `:109-176`) is reused wherever the owner currently is (wizard profile step today; add the same panel state to the Sage/Company-Truth surface). Copy pattern: "Sage is investigating what you've shared — you can keep going."
- **Company Truth ready state:** approved-or-pending report exists → show "Your dossier is ready for review" with the review CTA (approval remains explicit — B1).
- **In-progress state:** research or CT generation running → show live progress with the anchors being used; no owner-blocking. The only remaining owner clicks are corrections + approval (B3 satisfied: the *initiation* click disappears; the *approval* click never does).

## G-8. OWNER-FACT AUTHORITY RULES

1. Every explicit interview answer that maps to a knowledge field (`phone, address, hours, email, services, service_area, business_name, target_audience, description…` — the 12-field vocabulary at `models/137:29-63`) is written through the **existing** owner-edit path (`brandKnowledge.ownerEditFields`, source `stated`) at consent-execution time. This is the durable handoff (W2-B) into Prompt 011 — no new store.
2. Defaults may only fill fields with **no** `stated` version; anything default-populated must render with its provenance ("default") distinct from owner facts (ProfileReview already renders source badges).
3. **Named 8–5 regression:** `set_availability` must consume the `business_hours` answer when present and only fall back to 9–5 when the owner gave none (`setupAgentController.js:561-584` is the defect site). Silent substitution = test failure (G-16 #7).
4. Owner (`stated`) vs web (`website|facebook|public_web`) disagreement → existing gap-engine `arbitrate`/CONTESTED surface; neither side auto-overwrites (B2). The substrate already refuses silent overwrite: proposals against a superseded base 409 (`brandKnowledge.js:378-465`).

## G-9. SECOND-BUSINESS ENTRY DESIGN (narrow)

**Defect (clone-verified):** `initiateSession` resumes *any* open session for the user (`setupAgentController.js:1351-1356`) and binds new sessions to `inv.brandId || null` — the inventory's brand (`:1389,:1420`); brand-recovery reuses the prior discovery row (`:484-503`). There is no owner choice; a second business silently attaches to the first (H1-F1/I-49).

**Design:** an explicit choice surface at setup entry when the account already has ≥1 brand: "Continue setting up <Brand X>" vs "Set up a different business." The client passes an explicit `intent: resume | new_business` (+ `brandId` for resume) to `initiateSession`; server honors it: `resume` keeps today's behavior verbatim; `new_business` creates a session with `brand_id = NULL` and a session flag preventing inventory-based brand binding, so `create_brand_profile` creates a fresh brand. Resume-existing behavior is preserved bit-for-bit for `intent: resume` and for accounts with zero brands. **Out of scope honored:** no org/team/billing/switcher work.

## G-10. BOZ FOLLOW-UP INTEGRATION (consumer of 023 — nothing rewritten)

The gap engine already produces exactly the needed decisions: actions `skip|confirm|ask|arbitrate`, reasons (`draft_conflict`, `missing`, …), notices (`interviewGapEngine.js:26-71`), consumed by the interview director (`setupAgentController.js:1173-1232`). **What changes:** one additional consumer — after research/CT lands, the same `buildPlan(inventory)` output drives a short post-research follow-up surface (in wizard or Echo), phrased per W4 ("I found X on your website but Y on Facebook — which is current?" = the existing `arbitrate` action). **What is reused untouched:** the engine, its states, its precedence rules, the 12-field inventory, the max-2-surfaces rule, `continueAnyway` deferral. No second intake form.

## G-11. INSTRUMENTATION DESIGN

New additive table `onboarding_timing_events` (DDL in G-15): append-only events `(user_id, brand_id NULL, phase, event_kind, at, meta JSONB)` where `event_kind ∈ {surface_shown, owner_input_start, owner_submit, system_wait_start, system_wait_end, milestone}`.

**Attribution rules (pre-committed):**
- **Wall-clock** = first `signup` event → `campaign_ready` milestone event.
- **Active-owner** = Σ intervals `surface_shown/owner_input_start → owner_submit` on owner-interactive surfaces (interview turns, wizard steps, review/approve, OAuth consent screens). Idle gaps > 5 min within a surface are truncated to 5 min (explicitly reported as truncated, not hidden).
- **System/external wait** = Σ `system_wait_start → system_wait_end` (AI research/CT runs — bounded by existing `started_at/finished_at/elapsed_ms` on research drafts and `generated_at` on CT; provider/OAuth round-trips; job waits). Existing corroborating sources: `job_runs` (`models/125:11-26`), `agent_task_events` (`models/131:58-69`), `guided_setup_progress` timestamps (`models/096:10-18`).
- The three categories are reported separately and never summed into one number.

## G-12. CAMPAIGN-READY DEFINITION (pre-committed, before any timing run)

A brand is **campaign-ready** at the first moment ALL of the following are true:
1. Company Truth report **approved** by the owner (`company_truth_reports.status='approved'`);
2. Facebook Page **connected and verified** for the brand (publish-capable connection row);
3. ≥ 1 scheduled organic post exists (`social_posts` scheduled, future-dated);
4. ≥ 1 ad creative draft exists for the brand (`ad_creatives` row) — armed/live NOT required (R1/R6 stay intact);
5. availability schedule exists and **matches the owner's stated hours** (the 8–5 guard).

Timestamp = the `campaign_ready` milestone event when the last condition becomes true. This definition is fixed now, before any instrumented run.

## G-13. H1 PRESERVATION / CLEANUP PLAN

Partial SDS-H1 run is classified **SUPERSEDED-BY-035** — not failed, never a pass; excluded from future 026 acceptance evidence; retained as the BEFORE friction specimen.

**Complete partial-run artifact enumeration (read-only staging query, 2026-08-14):** user `bbd317fd-51d4-4eea-b67f-b9dd63c60cd1` (southdixiestorage@gmail.com); brand `bfe13534-f06d-4206-8139-3c217a52c8da` (South Dixie Storage): `users` 1; `setup_sessions` 1 (`d88ae64f-…`, incl. the stranded phone "(352) 244-9331", address, 8–5 hours answers — H1-F3 primary evidence); `brands` 1; `brand_discovery_sessions` 1; `social_posts` 22 (21 scheduled Aug 15–Sep 12 + 1 failed `dc1f0561…`); `ad_creatives` 1 (`6a8c2f3e…`, 5 packages, no FB ids); `company_truth_reports` 1 (`767adb1f-…` v1 **pending_approval** — left pending deliberately); `brand_knowledge_versions` 4; `brand_knowledge_revisions` 1; `sage_research_drafts` 0; `guided_setup_progress` 1; `availability_schedules` 1 (the 9–5 substitution evidence); `surveys` 1; `content_calendars` 1; `google_ad_plans` 0; `email_campaigns` 0 (H1-O email-skip evidence); `api_integrations` 0; `ai_usage_log` (brand-scoped) 0. Plus: Phase-0 caps snapshot `601d7e70-…`; deviations register in session records; owner JWT at `.local/p024/staging_token`.

**External artifacts: NONE exist** (no FB/Google/GA4 connections were made; the one failed post proves nothing published). Therefore external cleanup = no-op; survivorship check = confirm `api_integrations` 0 and no provider objects (already confirmed). **Freeze:** no further logins or writes to this account; the 21 scheduled posts cannot publish (no connection) — verified by the failed-post evidence; freeze re-check before any future FB work on staging. Nothing is deleted.

## G-14. EXPECTED CHANGED-FILE / SCHEMA SURFACE (honest, for Stage 2)

Server: `controllers/setupAgentController.js` (hours consumption; stated-fact handoff at consent execution; `initiateSession` intent parameter), `controllers/sageResearchController.js` + `utils/sageResearch.js` (anchor hook + debounce + anchor_snapshot), `utils/companyTruth.js` (consume knowledge `phone/address/hours` — the fail-honest `setup_interview`/knowledge probe), `controllers/brandDiscoveryController.js` (stated vs inferred split), new `utils/onboardingTiming.js`, 1–2 new migrations (G-15), routes touch-ups. Client: `SetupAgent.jsx` (entry choice), `GuidedSetupWizard.jsx`/`SageResearchPanel.jsx` (progress states), Sage/Company-Truth ready/in-progress states, small Boz follow-up surface. Tests: ~21 new named tests (G-16) + updates where behavior legitimately changes. **No changes** to `interviewGapEngine.js` core, `brandKnowledge.js` core, armed-consent flow, or the 022 claim/finalize core.

## G-15. MIGRATION STATEMENT — **ADDITIVE-ONLY**

```sql
-- 1. structured anchor history per research step (G-4)
ALTER TABLE sage_research_drafts ADD COLUMN IF NOT EXISTS anchor_snapshot JSONB;
-- 2. timing instrumentation (G-11)
CREATE TABLE IF NOT EXISTS onboarding_timing_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  brand_id UUID REFERENCES brands(brand_id) ON DELETE SET NULL,
  phase TEXT NOT NULL, event_kind TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(), meta JSONB
);
-- 3. explicit session intent (G-9)
ALTER TABLE setup_sessions ADD COLUMN IF NOT EXISTS entry_intent TEXT
  CHECK (entry_intent IN ('resume','new_business'));
```
Nothing structural, destructive, or type-changing. No migration executed in Stage 1.

## G-16. COMPLETE REGRESSION PLAN (named tests)

1 `pi.anchorArrival.startsBackgroundRun` 2 `pi.wrongEntity.cannotReachApprovedTruth` (name-only facts blocked from approval without owner arbitration) 3 `pi.repeatedAnchors.noRedundantRuns` (debounce + identical-value no-op) 4 `handoff.ownerFactsReachConsumers` (stated interview facts appear via `getApprovedCompanyTruth`/knowledge reads) 5 `handoff.phone.regression` (interview phone → CT never "NOT PROVIDED") 6 `handoff.address.regression` 7 `authority.hours.noSilentDefault` (8–5 stays 8–5; 9–5 only when unanswered) 8 `authority.ownerVsWebConflict.surfaced` (arbitrate, no overwrite) 9 `pi.autoResearch.approvalStillExplicit` 10 `truth.noTrustBeforeApproval` (existing suite extended) 11 `secondBusiness.noSilentBind` (intent=new_business → fresh brand, never current) 12 `secondBusiness.resumeStillWorks` 13 `sufficiency.noWebsite.honestPath` 14 `sufficiency.noSocial.honestPath` 15 Prompt 011 suite green (baseline 1370 includes it) 16 Prompt 022 suite green 17 Prompt 023 suite green 18 Prompt 024 suite green 19 Prompt 025 suite green 20 `pi.aiSpend.bounded` (4-run cap + budget gate honored) 21 `timing.threeCategoriesSeparate` (instrumentation emits and reports wall/active/wait independently). Acceptance requires server 1370+new and client 430+new all green in a D-37 fresh clone.

## G-17. STOP CONDITIONS

All Section-F conditions restated verbatim as binding: parallel provenance taxonomy; provisional/wrong-entity research reaching approved Company Truth; any surviving silent default over explicit owner input; unjustified second full research runs; schema beyond additive; W3 scope growth; breaking an accepted 011/022/023/024/025 suite; anything contradicting D-46 or standing rules. **New Stage-1-discovered STOP conditions:** (S1) Stage-2 work performed on the drifted workspace tree instead of a verified-staging checkout; (S2) npm registry firewall blocks dependency install for a fresh clone — any Stage-2 verification run must use the byte-identical-lockfile procedure or resolved registry access, never a partially installed tree; (S3) any write to the frozen SDS partial account.

## G-18. ACCEPTANCE CRITERIA

(a) All Section-C workstream behaviors demonstrated on staging: anchors auto-start/enrich exactly one evolving investigation; owner facts durably land as `stated` knowledge; hours/phone/address regressions pass; second-business entry offers the explicit choice and binds correctly; Boz follow-ups ask only gap/conflict questions via the 023 engine. (b) Full G-16 regression plan green in a D-37 fresh clone (server 1370+new / client 430+new, zero fail). (c) Instrumented SDS-H1 rerun reports the three timing categories separately; **wall-clock ≤ ~2 h** (hard, subject to clearly identified external-provider delays); active-owner time measured and reported against the 30–45 min aspiration (not a hard gate). (d) No STOP condition tripped; no non-additive schema change; approval remains explicit everywhere.

## G-19. EXACT PROMPT-026 H1 RESTART PROCEDURE (after 035 acceptance)

1. Freeze verified: partial SDS account confirmed frozen and labeled SUPERSEDED-BY-035 (G-13). 2. New fresh SDS account created through the **redesigned** onboarding with instrumentation live from the signup event. 3. Instrumented timing captured (wall/active/wait) through campaign-ready as defined in G-12. 4. Complete SDS-H1 per the runbook (Phases 0–3, all standing rules R1–R6, caps re-check vs snapshot). 5. BLACOR-H1. 6. Phase 3.2 cross-account isolation checks (per H1-F1 ruling: cross-ACCOUNT). 7. H1 report per Section D of the runbook (deviations register, KEEP/TEST ledger, D-37 statement, verbatim D-20 sentence, Notes-for-027, findings) — including the BEFORE/AFTER friction comparison against the preserved partial run. 8. Owner checkpoint.

## G-20. ORIGINAL-LADDER RESUME POINT (verbatim)

"After 035 acceptance and the completed 026 (H1 restart through close, then the existing E1–E5 H2 gates), the project resumes at Prompt 027 exactly as planned. Nothing else in the ladder moves."

---
*Stage-1 boundary honored: no code, config, schema, DB, or provider writes; no H1 resumption; no Prompt 027; no production. Raw audit evidence: `/tmp/d37-035/audit-field-matrix.md`, `/tmp/d37-035/audit-substrate.md`, `/tmp/d37-035/server-test.log`, `/tmp/d37-035/client-test.log`.*
