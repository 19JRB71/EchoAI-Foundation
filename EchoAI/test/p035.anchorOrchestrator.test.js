/**
 * Prompt 035 Stage 2 — Sections D/E/K/M: the PI-model orchestrator.
 *
 * All DB and research machinery is stubbed — this file tests the
 * orchestration CONTRACT: phase boundary, ownership, identical-anchor no-op,
 * candidate-only vs anchored runs, Tier-B preconditions, and the daily cap.
 *
 * Run with:  node --test test/p035.anchorOrchestrator.test.js
 */

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const db = require("../config/db");
const sageResearch = require("../utils/sageResearch");
const timing = require("../utils/onboardingTiming");
const orchestrator = require("../utils/anchorOrchestrator");
const ctController = require("../controllers/companyTruthController");

const USER = "11111111-1111-4111-8111-111111111111";
const BRAND = "22222222-2222-4222-8222-222222222222";

// ---- stubs -----------------------------------------------------------------

const originals = {
  query: db.query,
  claimRun: sageResearch.claimRun,
  runResearch: sageResearch.runResearch,
  recordSystemWait: timing.recordSystemWait,
  claimAndRunGeneration: ctController.claimAndRunGeneration,
};

let state; // per-test scripted world
let calls; // recorded interactions

function installStubs() {
  calls = { claimRun: [], runResearch: [], ctGen: [] };
  db.query = async (sql, params) => {
    if (/SELECT onboarding_completed FROM users/.test(sql)) {
      return { rows: [{ onboarding_completed: state.onboardingCompleted }] };
    }
    if (/FROM brands b JOIN users u/.test(sql)) {
      return { rows: state.brand ? [state.brand] : [] };
    }
    if (/FROM sage_research_drafts/.test(sql) && /COUNT/.test(sql)) {
      return { rows: [{ n: state.autoRunsToday || 0 }] };
    }
    if (/FROM sage_research_drafts/.test(sql)) {
      return { rows: state.latestDraft ? [state.latestDraft] : [] };
    }
    if (/FROM company_truth_reports/.test(sql)) {
      return { rows: state.reportExists ? [{ 1: 1 }] : [] };
    }
    throw new Error(`unexpected query in test: ${sql.slice(0, 60)}`);
  };
  sageResearch.claimRun = async (brandId, userId, opts) => {
    calls.claimRun.push({ brandId, userId, opts });
    if (state.claimConflict) {
      const err = new Error("in progress");
      err.inProgress = true;
      throw err;
    }
    return { runId: "run-1" };
  };
  sageResearch.runResearch = async (brand, opts) => {
    calls.runResearch.push({ brand, opts });
  };
  timing.recordSystemWait = () => Promise.resolve();
  ctController.claimAndRunGeneration = async (brand, note) => {
    calls.ctGen.push({ brand, note });
    return state.ctInProgress ? { inProgress: true } : { ok: true };
  };
}

function restoreStubs() {
  db.query = originals.query;
  sageResearch.claimRun = originals.claimRun;
  sageResearch.runResearch = originals.runResearch;
  timing.recordSystemWait = originals.recordSystemWait;
  ctController.claimAndRunGeneration = originals.claimAndRunGeneration;
  for (const t of orchestrator._timers.tierBTimers.values()) clearTimeout(t);
  orchestrator._timers.tierBTimers.clear();
  for (const r of orchestrator._timers.tierARetries.values()) clearTimeout(r.timer);
  orchestrator._timers.tierARetries.clear();
}

beforeEach(() => {
  state = {
    onboardingCompleted: false,
    brand: {
      brand_id: BRAND,
      user_id: USER,
      brand_name: "Joe's Plumbing",
      website_url: null,
      facebook_page_url: null,
      facebook_page_id: null,
      industry: "plumbing",
    },
    latestDraft: null,
    autoRunsToday: 0,
    reportExists: false,
  };
  installStubs();
});
afterEach(restoreStubs);

// ---- Section K: hard phase boundary ----------------------------------------

test("orchestration.onboardingPhaseBoundary — refuses after onboarding completes", async () => {
  state.onboardingCompleted = true;
  const out = await orchestrator.onAnchorArrival({ userId: USER, brandId: BRAND });
  assert.deepEqual(out, { skipped: "post_onboarding" });
  assert.equal(calls.claimRun.length, 0);
});

test("a non-owner caller is refused (never researches someone else's brand)", async () => {
  const out = await orchestrator.onAnchorArrival({
    userId: "33333333-3333-4333-8333-333333333333",
    brandId: BRAND,
  });
  assert.deepEqual(out, { skipped: "not_owner" });
  assert.equal(calls.claimRun.length, 0);
});

// ---- Section D1: name-only candidate discovery ------------------------------

test("pi.nameOnly.candidateDiscoveryStarts — name-only brand runs in candidateOnly mode", async () => {
  const out = await orchestrator.onAnchorArrival({ userId: USER, brandId: BRAND, reason: "setup_interview" });
  assert.equal(out.tierA, "started");
  await orchestrator.lastTierAPromise;
  assert.equal(calls.runResearch.length, 1);
  assert.equal(calls.runResearch[0].opts.candidateOnly, true);
  // The claim records exactly what Sage knew, marked as an auto run.
  const snap = calls.claimRun[0].opts.anchorSnapshot;
  assert.equal(snap.brand_name, "Joe's Plumbing");
  assert.equal(snap.website_url, null);
  assert.equal(snap._auto, true);
});

// ---- Section E: Tier A immediate per-anchor ---------------------------------

test("pi.tierA.immediatePerAnchor — an identity anchor triggers an anchored (attributing) run now", async () => {
  state.brand.website_url = "https://joes-plumbing.com";
  const out = await orchestrator.onAnchorArrival({ userId: USER, brandId: BRAND, reason: "brand_update" });
  assert.equal(out.tierA, "started");
  await orchestrator.lastTierAPromise;
  assert.equal(calls.runResearch[0].opts.candidateOnly, false);
});

test("pi.noDuplicateTriggers — identical anchors vs the latest run are a no-op", async () => {
  state.brand.website_url = "https://joes-plumbing.com";
  state.latestDraft = {
    status: "complete",
    anchor_snapshot: {
      brand_name: "Joe's Plumbing",
      website_url: "https://joes-plumbing.com",
      facebook_page_url: null,
      facebook_page_id: null,
      industry: "plumbing",
      _auto: true,
    },
  };
  const out = await orchestrator.onAnchorArrival({ userId: USER, brandId: BRAND });
  assert.equal(out.skipped, "anchors_unchanged");
  assert.equal(calls.claimRun.length, 0);
});

test("pi.noDuplicateTriggers — an in-flight claim (409) never double-runs; a bounded retry is scheduled", async () => {
  state.claimConflict = true;
  const out = await orchestrator.onAnchorArrival({ userId: USER, brandId: BRAND });
  assert.equal(out.tierA, "in_progress");
  assert.equal(calls.runResearch.length, 0);
  assert.equal(orchestrator._timers.tierARetries.has(BRAND), true);
});

// ---- Section M: bounded spend -----------------------------------------------

test("daily auto-run cap: the 5th auto run of the day is refused", async () => {
  state.autoRunsToday = orchestrator.MAX_AUTO_RUNS_PER_DAY;
  const out = await orchestrator.onAnchorArrival({ userId: USER, brandId: BRAND });
  assert.equal(out.tierA, "capped");
  assert.equal(calls.claimRun.length, 0);
});

// ---- Section E: Tier B coalesced synthesis ----------------------------------

test("pi.tierB.coalesced — fires only with identity + terminal research + no existing report", async () => {
  state.brand.website_url = "https://joes-plumbing.com";
  state.latestDraft = { status: "complete", anchor_snapshot: {} };
  const out = await orchestrator._tierBFire(BRAND, USER);
  assert.deepEqual(out, { started: true });
  assert.equal(calls.ctGen.length, 1);
});

test("Tier B waits while research is still running (re-arms, no generation)", async () => {
  state.brand.website_url = "https://joes-plumbing.com";
  state.latestDraft = { status: "running", anchor_snapshot: {} };
  const out = await orchestrator._tierBFire(BRAND, USER);
  assert.equal(out.skipped, "research_in_flight");
  assert.equal(calls.ctGen.length, 0);
  assert.equal(orchestrator._timers.tierBTimers.has(BRAND), true);
});

test("Tier B refuses without identity evidence — attribution waits (Section D)", async () => {
  state.latestDraft = { status: "complete", anchor_snapshot: {} };
  const out = await orchestrator._tierBFire(BRAND, USER);
  assert.equal(out.skipped, "identity_not_established");
  assert.equal(calls.ctGen.length, 0);
});

test("truth.ctApprovalGateUnchanged — Tier B NEVER regenerates over an existing report (owner review is sacred)", async () => {
  state.brand.website_url = "https://joes-plumbing.com";
  state.latestDraft = { status: "complete", anchor_snapshot: {} };
  state.reportExists = true;
  const out = await orchestrator._tierBFire(BRAND, USER);
  assert.equal(out.skipped, "report_exists");
  assert.equal(calls.ctGen.length, 0);
});

test("Tier B re-checks the phase boundary at fire time", async () => {
  state.onboardingCompleted = true;
  const out = await orchestrator._tierBFire(BRAND, USER);
  assert.equal(out.skipped, "post_onboarding");
  assert.equal(calls.ctGen.length, 0);
});

test("onAnchorArrival never throws to callers (fire-and-forget safe)", async () => {
  db.query = async () => {
    throw new Error("db exploded");
  };
  const out = await orchestrator.onAnchorArrival({ userId: USER, brandId: BRAND });
  assert.equal(out.error, "db exploded");
});
