/**
 * Prompt 035 Stage 2 — Sections D/E/F/K: onboarding investigation
 * orchestrator (the PI model, two tiers).
 *
 * "Research may start immediately; attribution must wait for sufficient
 * identity evidence."
 *
 * TIER A — immediate, bounded, per-anchor acquisition. Every anchor arrival
 * (brand created, website/facebook link saved, FB page connected) starts a
 * scoped research run RIGHT AWAY through the EXISTING Prompt-022 machinery
 * (claimRun single-flight + runResearch budget/phases). Name-only state runs
 * in candidateOnly mode: discovery yes, attribution no (Section D1).
 *
 * TIER B — coalesced synthesis. Expensive Company-Truth generation fires only
 * after identity is established (website or Facebook anchor present) AND a
 * short documented quiet period (QUIET_MS, default 45s) has passed since the
 * last anchor arrival, AND the latest research run is terminal. It reuses the
 * ONE claim path in companyTruthController (no competing trigger).
 *
 * Section K — HARD PHASE BOUNDARY: everything here runs ONLY while
 * users.onboarding_completed IS NOT TRUE. After onboarding, anchor changes
 * must surface an OFFER to the owner (client concern); this module refuses.
 *
 * Section M — bounded spend: at most MAX_AUTO_RUNS_PER_DAY (4) auto research
 * runs per brand per calendar day (each already hard-capped at $0.50 by
 * Prompt 022), and at most ONE auto CT generation per brand (only when no
 * report exists yet).
 *
 * Timers/pending state are in-process (single-node staging deployment —
 * documented limitation; a restart simply drops a pending coalesce window,
 * and the next anchor arrival or the owner's manual trigger recovers).
 */

const db = require("../config/db");
const sageResearch = require("./sageResearch");
const timing = require("./onboardingTiming");

const QUIET_MS = Number(process.env.P035_TIER_B_QUIET_MS) || 45_000;
const RETRY_MS = Number(process.env.P035_TIER_A_RETRY_MS) || 15_000;
const MAX_RETRIES = 8;
const MAX_AUTO_RUNS_PER_DAY = 4;

// Lazy to avoid a require cycle (companyTruthController requires utils).
function ctController() {
  return require("../controllers/companyTruthController");
}

// per-brand in-process state
const tierBTimers = new Map(); // brandId -> Timeout
const tierARetries = new Map(); // brandId -> { count, timer }
let lastTierAPromise = Promise.resolve(); // test hook

async function isOnboarding(userId) {
  const { rows } = await db.query(
    "SELECT onboarding_completed FROM users WHERE user_id = $1",
    [userId],
  );
  if (!rows.length) return false;
  return rows[0].onboarding_completed !== true;
}

/** The four research anchors (exactly what Prompt-022 runResearch consumes). */
async function snapshotAnchors(brandId) {
  const { rows } = await db.query(
    `SELECT b.brand_id, b.user_id, b.brand_name, b.website_url, b.facebook_page_url,
            b.facebook_page_id, u.industry
       FROM brands b JOIN users u ON u.user_id = b.user_id
      WHERE b.brand_id = $1`,
    [brandId],
  );
  return rows[0] || null;
}

function anchorView(brand, reason) {
  return {
    brand_name: brand.brand_name || null,
    website_url: brand.website_url || null,
    facebook_page_url: brand.facebook_page_url || null,
    facebook_page_id: brand.facebook_page_id || null,
    industry: brand.industry || null,
    _auto: true,
    _reason: reason || null,
  };
}

/** Identity evidence sufficient for attribution/synthesis (Section D2/D3). */
function identityEstablished(brand) {
  return Boolean(brand.website_url || brand.facebook_page_url || brand.facebook_page_id);
}

function sameAnchors(a, b) {
  if (!a || !b) return false;
  const keys = ["brand_name", "website_url", "facebook_page_url", "facebook_page_id", "industry"];
  return keys.every((k) => (a[k] || null) === (b[k] || null));
}

async function latestDraft(brandId) {
  const { rows } = await db.query(
    `SELECT status, anchor_snapshot FROM sage_research_drafts
      WHERE brand_id = $1 AND status IN ('running','complete','partial','empty','failed')
      ORDER BY (status = 'running') DESC, created_at DESC LIMIT 1`,
    [brandId],
  );
  return rows[0] || null;
}

async function autoRunsToday(brandId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM sage_research_drafts
      WHERE brand_id = $1 AND anchor_snapshot->>'_auto' = 'true'
        AND created_at >= date_trunc('day', NOW())`,
    [brandId],
  );
  return rows[0] ? rows[0].n : 0;
}

/** Tier A: claim + run now. Returns 'started' | 'in_progress' | 'capped'. */
async function tierAStart(brand, reason) {
  // Re-check the onboarding boundary IMMEDIATELY before claiming (Section K):
  // the earlier gate in onAnchorArrival is advisory — onboarding can complete
  // between that check and this claim, and a completed account must never
  // gain an auto run through the gap.
  if (!(await isOnboarding(brand.user_id))) return "post_onboarding";
  if ((await autoRunsToday(brand.brand_id)) >= MAX_AUTO_RUNS_PER_DAY) return "capped";
  let claim;
  try {
    claim = await sageResearch.claimRun(brand.brand_id, brand.user_id, {
      anchorSnapshot: anchorView(brand, reason),
    });
  } catch (err) {
    if (err.inProgress) return "in_progress";
    throw err;
  }
  const candidateOnly = !identityEstablished(brand);
  timing.recordSystemWait(brand.user_id, brand.brand_id, "research", "start", { runId: claim.runId });
  lastTierAPromise = sageResearch
    .runResearch(brand, { runId: claim.runId, candidateOnly })
    .then(() => timing.recordSystemWait(brand.user_id, brand.brand_id, "research", "end", { runId: claim.runId }))
    .catch((e) => console.error("P035 Tier A research failed:", e.message));
  return "started";
}

/** Single-flight-respecting retry: an in-progress 409 marks a rerun wanted. */
function scheduleTierARetry(brandId, userId, reason) {
  const prior = tierARetries.get(brandId);
  if (prior && prior.timer) clearTimeout(prior.timer);
  const count = prior ? prior.count + 1 : 1;
  if (count > MAX_RETRIES) {
    tierARetries.delete(brandId);
    return;
  }
  const timer = setTimeout(() => {
    tierARetries.delete(brandId);
    module.exports.onAnchorArrival({ userId, brandId, reason: `${reason}:retry` }).catch(() => {});
  }, RETRY_MS);
  if (timer.unref) timer.unref();
  tierARetries.set(brandId, { count, timer });
}

/** Tier B: (re)start the coalesce window; fires synthesis when quiet. */
function scheduleTierB(brandId, userId) {
  const prior = tierBTimers.get(brandId);
  if (prior) clearTimeout(prior);
  const timer = setTimeout(() => {
    tierBTimers.delete(brandId);
    module.exports._tierBFire(brandId, userId).catch((e) =>
      console.error("P035 Tier B synthesis failed:", e.message),
    );
  }, QUIET_MS);
  if (timer.unref) timer.unref();
  tierBTimers.set(brandId, timer);
}

async function tierBFire(brandId, userId) {
  // Re-check everything at fire time — the world moved during the quiet period.
  if (!(await isOnboarding(userId))) return { skipped: "post_onboarding" };
  const brand = await snapshotAnchors(brandId);
  if (!brand || !identityEstablished(brand)) return { skipped: "identity_not_established" };
  const draft = await latestDraft(brandId);
  if (!draft || draft.status === "running") {
    // research still in flight — wait for another quiet window
    scheduleTierB(brandId, userId);
    return { skipped: "research_in_flight" };
  }
  // Auto-generate ONLY when the brand has no Company Truth at all — never
  // regenerate over a pending or approved report (owner review is sacred).
  const { rows } = await db.query(
    `SELECT 1 FROM company_truth_reports
      WHERE brand_id = $1 AND status IN ('generating','pending_approval','approved') LIMIT 1`,
    [brandId],
  );
  if (rows.length) return { skipped: "report_exists" };
  timing.recordSystemWait(userId, brandId, "company_truth", "start", {});
  const started = await ctController().claimAndRunGeneration(
    { brand_id: brandId, user_id: userId, brand_name: brand.brand_name },
    null,
  );
  if (started.inProgress) return { skipped: "generation_in_progress" };
  return { started: true };
}

/**
 * THE entry point — call on every anchor arrival during setup.
 * Fire-and-forget safe: never throws to callers.
 */
async function onAnchorArrival({ userId, brandId, reason = null }) {
  try {
    if (!userId || !brandId) return { skipped: "missing_ids" };
    if (!(await isOnboarding(userId))) return { skipped: "post_onboarding" };
    const brand = await snapshotAnchors(brandId);
    if (!brand) return { skipped: "no_brand" };
    if (brand.user_id !== userId) return { skipped: "not_owner" };
    if (!brand.brand_name) return { skipped: "no_anchors" };

    // Identical re-save = no-op (Section E): same anchors as the latest run.
    const draft = await latestDraft(brandId);
    if (draft && sameAnchors(draft.anchor_snapshot, anchorView(brand, reason))) {
      // Still (re)arm Tier B — synthesis may be owed even when acquisition isn't.
      scheduleTierB(brandId, userId);
      return { skipped: "anchors_unchanged" };
    }

    const result = await tierAStart(brand, reason);
    if (result === "in_progress") scheduleTierARetry(brandId, userId, reason || "anchor");
    scheduleTierB(brandId, userId);
    return { tierA: result };
  } catch (err) {
    console.error("P035 anchor orchestrator error:", err.message);
    return { skipped: "error", error: err.message };
  }
}

module.exports = {
  onAnchorArrival,
  identityEstablished,
  QUIET_MS,
  RETRY_MS,
  MAX_AUTO_RUNS_PER_DAY,
  // Test seams
  _tierBFire: tierBFire,
  _tierAStart: tierAStart,
  _sameAnchors: sameAnchors,
  _anchorView: anchorView,
  _timers: { tierBTimers, tierARetries },
  get lastTierAPromise() {
    return lastTierAPromise;
  },
};
