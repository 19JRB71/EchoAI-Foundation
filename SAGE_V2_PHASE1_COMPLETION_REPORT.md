# Sage V2 — Phase 1 Completion Report

**Date:** July 17, 2026
**Blueprint:** `SAGE_V2_CHALLENGE_REVIEW.md` (approved Phase 1 scope only — no Phase 2 work)
**Status:** Complete, validated, dark behind feature flags, ready for review

---

## ✅ What Was Implemented

| Item | Status |
|---|---|
| Company Truth injected into every supported department | ✅ Via a single injection point in the AI chokepoint — every department's brand-scoped AI call receives the approved Company Truth digest (see Deviations) |
| Shared context helper | ✅ `EchoAI/utils/companyContext.js` — builds a compact (~600-token) digest from the **approved** Company Truth only; never drafts, never pending; 15-minute per-brand cache; a lookup failure never blocks a department |
| Feature flags added | ✅ Three flags, all default **OFF** (see Feature Flags below) |
| Weekly briefing consolidation | ✅ One consolidated Monday briefing per brand per ISO week, aggregating only that week's real outputs; `[DRAFT]` placeholder copy throughout for you and ChatGPT to finalize |
| "Flying Blind" detection | ✅ Per-brand counter increments when a department AI call runs without approved Company Truth; surfaced three ways: API stats endpoint, an Echo nudge, and an amber banner on the Sage page |
| Honest "Estimated" ROI labeling | ✅ Server marks which Advanced ROI figures are modeled (`estimatedLabels`); client shows an "ESTIMATED" badge on those figures |
| Database migration | ✅ One migration: `116_sage_v2_phase1.sql` |
| API changes | ✅ Two new endpoints: `GET /api/sage/briefing/weekly`, `GET /api/sage/context-stats` (both answer `{enabled:false}` when flags are dark); Advanced ROI summary response gains `estimatedLabels` |
| UI changes | ✅ Sage page: flying-blind banner + weekly briefing panel; Advanced ROI: estimated badges. Both render nothing when flags are dark |

---

## Files Modified

**Server**
- `EchoAI/utils/companyContext.js` — **new**: shared Company Truth context helper + flying-blind recording
- `EchoAI/config/anthropic.js` — Company Truth digest appended to the system prompt of brand-scoped AI calls (both normal and streaming paths)
- `EchoAI/controllers/sageBriefingController.js` — **new**: weekly briefing builder, `GET /briefing/weekly`, `GET /context-stats`
- `EchoAI/config/briefingCopy.js` — **new**: all `[DRAFT]` placeholder copy, centralized for easy finalization
- `EchoAI/config/aiControls.js` — the three feature flags (default OFF)
- `EchoAI/routes/sageRoutes.js` — mounts the two new endpoints
- `EchoAI/controllers/roiDashboardController.js` — `estimatedLabels` on the Advanced ROI summary
- `EchoAI/utils/echoBriefing.js` — Echo's flying-blind nudge line
- `EchoAI/utils/scheduler.js` — Monday scheduler hook builds the weekly briefing
- `EchoAI/models/116_sage_v2_phase1.sql` — **new**: migration

**Client**
- `EchoAI/client/src/api.js` — `getSageWeeklyBriefing`, `getSageContextStats`
- `EchoAI/client/src/sections/Sage.jsx` — `SageV2Extras`: amber flying-blind banner + weekly briefing panel
- `EchoAI/client/src/sections/roi/AdvancedRoiDashboard.jsx` — `EstBadge` on modeled figures
- `EchoAI/client/src/sections/Sage.insights.test.jsx` — mock updated for the two new API methods
- `EchoAI/client/dist/*` — rebuilt production bundle

**Tests**
- `EchoAI/tests/sageV2.test.js` — **new**: 10 tests (see Tests below)

---

## Database Changes

One migration: **`EchoAI/models/116_sage_v2_phase1.sql`** (idempotent, `IF NOT EXISTS`, applied by the standard runner):

- `sage_weekly_briefings` — one consolidated briefing per brand per ISO week (`UNIQUE (brand_id, iso_week)` makes the Monday build claim atomic — two overlapping runs can never double-build)
- `sage_context_stats` — per-brand flying-blind counter + last-occurrence timestamp

No existing tables were altered. Rollback is simply not enabling the flags; the new tables sit unused when dark.

---

## Feature Flags

All three live in `config/aiControls.js` (admin DB override → environment variable → default), and all default **OFF**:

| Flag | Default | Controls |
|---|---|---|
| `SAGE_V2_CONTEXT` | OFF | Company Truth injection into department AI calls + flying-blind counting |
| `SAGE_V2_WEEKLY_BRIEFING` | OFF | Weekly briefing consolidation (builder, scheduler hook, endpoint, UI panel) |
| `SAGE_V2_ROI_LABELS` | OFF | "ESTIMATED" badges on modeled Advanced ROI figures |

With all flags dark, the platform's behavior is byte-for-byte unchanged: no context is injected, no counters increment, endpoints answer `{enabled:false}`, the UI renders nothing new, and the scheduler hook no-ops.

---

## Customer-Facing Changes (with screenshots)

Captured live with the flags temporarily enabled (flags were reverted to dark afterward):

1. **`screenshots/sage-v2-briefing-banner.png`** — the Sage page showing (a) the amber "[DRAFT] Your AI team is working without your approved Company Profile…" flying-blind banner and (b) the consolidated "[DRAFT] Your Weekly Briefing from Sage" panel with all seven sections (performance, customer intelligence, ROI, Autopilot, competitors, feedback), each honestly reporting "no data this week" where nothing was produced.
2. **`screenshots/roi-estimated-labels.png`** — Advanced ROI overview with "ESTIMATED" badges on Revenue Attributed and Overall ROI (the modeled figures); Total Spend and Conversions (real figures) carry no badge.

Every user-visible string is `[DRAFT]`-prefixed placeholder copy in `config/briefingCopy.js`, ready for you to finalize with ChatGPT — one file to edit, no code changes needed.

---

## Tests

- **Tests added:** 10 (all in the new `tests/sageV2.test.js`): flag-off no-op behavior for context and briefing; no flying-blind counting when dark; flying-blind counting when enabled without approved truth; digest built from an approved report; atomic per-week briefing claim; honest empty sections; real analytics aggregation; **stale-row exclusion regression test**; foreign-brand 404 + dark-flag `{enabled:false}` endpoint behavior; ISO-week correctness.
- **Tests modified:** 1 (`Sage.insights.test.jsx` — mock gained the two new API methods).
- **Total passing:** **814/814 server tests, 367/367 client tests**, client production build green. All three registered validations passed at completion.
- **Regression tests added:** 1 — inserts three-week-old intelligence/ROI/competitor/feedback rows and asserts the weekly briefing marks all four sections unavailable.

---

## Bugs Found During Development

**The stale-row issue** (caught by independent architect code review before delivery):

- **What:** The weekly briefing builder fetched the *latest-ever* row for four of its six sources (customer intelligence, ROI snapshots, competitor reports, feedback reports) instead of the latest row *from this week*. A report generated a month ago would have appeared in the briefing as "this week's" output.
- **Why it occurred:** The performance-analytics query was written first with a correct week filter; the other source queries were modeled on existing "show latest report" dashboard queries, which legitimately fetch latest-ever — the week bound wasn't carried over.
- **How it was fixed:** Every source query is now bounded to the briefing week (`week_date` / `period_end` / `created_at >= since`); an out-of-window row reads as "unavailable" and the section honestly says no report was produced.
- **Why it cannot happen again:** A dedicated regression test seeds deliberately stale rows in all four tables and fails the suite if any of them ever leaks into a briefing. The lesson ("weekly aggregators must week-bound every source query") is also recorded in the project's engineering memory so future work starts from it.

No other functional bugs were found. (One trivial test-fixture issue during writing: a seeded trajectory score violated a DB check constraint — fixed in the test, not product code.)

---

## Architectural Deviations from the Approved Blueprint

Three, all previously flagged:

1. **Chokepoint injection instead of editing 11 prompt files.**
   - *What:* Company Truth is appended once, inside `config/anthropic.js` (the single gate every paid AI call already passes through), rather than editing each department's prompt builder.
   - *Why:* One injection point cannot drift out of sync across departments; a new department added later is covered automatically; the change is reversible by a single flag.
   - *Impact:* Strictly broader coverage than the blueprint — every brand-scoped department call gets the context, not just the 11 named files. No department is missed.
2. **Flag names differ from the blueprint's list.** `SAGE_V2_WEEKLY_BRIEFING` and `SAGE_V2_ROI_LABELS` (plus `SAGE_V2_CONTEXT`, which matches). Chosen to follow the existing `aiControls.js` naming convention. Impact: cosmetic only.
3. **Hermes is intentionally NOT injected.** Hermes is the fast intent/routing decision brain on a tight time budget — it doesn't write customer-facing content, and adding ~600 tokens to every routing decision would slow the voice experience for no benefit. Claude (which writes all content) gets the context. Impact: none on content quality; deliberate protection of voice latency.

---

## Known Limitations (intentional, per Phase 1 scope)

- **All copy is `[DRAFT]` placeholder** — awaiting your ChatGPT-finalized wording (edit `config/briefingCopy.js` only).
- **Flags ship dark** — nothing is customer-visible until you enable them (admin AI-controls override or environment variable on Railway).
- **The briefing consolidates existing reports; it does not generate new analysis** — sources that didn't run that week are honestly marked unavailable, never fabricated. (Deeper synthesis is Phase 2 territory.)
- **Flying-blind counting is cache-windowed** (at most one count per brand per 15 minutes) — it's a directional signal for the nudge, not a precise per-call audit.
- **No Phase 2 work** was started, per instruction.

---

## Ready for Review

All Phase 1 items are implemented, flag-gated, backward compatible, and validated (814 server + 367 client tests, production build, live screenshots). Awaiting your approval to proceed to Phase 2.
