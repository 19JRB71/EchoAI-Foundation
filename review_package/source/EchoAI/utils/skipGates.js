/**
 * Per-job input gatherers for the Sage V2 skip gates (Phase 2, W7b).
 *
 * Each recurring AI job declares the material inputs its prompts are built
 * from as a cheap, deterministic DB snapshot (key fields + counts +
 * max(updated_at) of the source tables). If the snapshot hash matches the
 * last recorded run, the job's AI calls are skipped and the run is recorded
 * as 'skipped_unchanged' — honest and visible, never silent.
 *
 * Freshness buckets: jobs whose value comes from OUTSIDE data (live web
 * research, Facebook Ad Library) include a time bucket in their input set so
 * an unchanged local snapshot can only suppress re-runs WITHIN that bucket —
 * it can never make Sage permanently stale:
 *   - sage-deep-research: day bucket  (max one full web-research cycle/day
 *     when the brand's own inputs haven't changed; 4/day when they have)
 *   - sage-urgent-scan:   hour bucket (breaking-news latency capped at 1h)
 *   - sage-pattern-study: ISO-week    (already weekly by design)
 *   - competitor-ad-scan: 6h bucket   (its own cadence — dedups double ticks
 *     only; alert latency unchanged)
 *   - competitor-scan / site-digest / weekly-analytics / autopilot-study:
 *     purely local inputs, no bucket needed.
 *
 * Everything here FAILS OPEN (see utils/inputHash.js): any error in
 * gathering or hashing means the job runs.
 */

const db = require("../config/db");
const { shouldRun, recordRun } = require("./inputHash");

// ---------------------------------------------------------------------------
// Time buckets
// ---------------------------------------------------------------------------
function dayBucket(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
function hourBucket(d = new Date()) {
  return d.toISOString().slice(0, 13);
}
function sixHourBucket(d = new Date()) {
  return `${d.toISOString().slice(0, 10)}:${Math.floor(d.getUTCHours() / 6)}`;
}
function isoWeekBucket(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Snapshot helpers (deterministic, cheap)
// ---------------------------------------------------------------------------
async function one(sql, params) {
  const r = await db.query(sql, params);
  return r.rows[0] || null;
}

/** Brand profile fields every Sage prompt is built from. */
async function brandSnapshot(brandId) {
  return one(
    `SELECT b.brand_name, b.target_audience::text AS target_audience,
            b.brand_personality::text AS brand_personality,
            b.voice_description, b.brand_type, b.updated_at,
            u.industry AS user_industry
       FROM brands b JOIN users u ON u.user_id = b.user_id
      WHERE b.brand_id = $1`,
    [brandId],
  );
}

/** Approved Company Truth version (Layer 2 prompt input). */
async function companyTruthSnapshot(brandId) {
  return one(
    `SELECT version, updated_at FROM company_truth_reports
      WHERE brand_id = $1 AND status = 'approved'
      ORDER BY version DESC LIMIT 1`,
    [brandId],
  ).catch(() => null);
}

/** Confirmed competitor set (names + websites drive the research prompts). */
async function competitorsSnapshot(brandId) {
  const r = await db.query(
    `SELECT competitor_id, name, website, facebook_page, status, updated_at
       FROM sage_competitors WHERE brand_id = $1 AND status = 'confirmed'
      ORDER BY competitor_id`,
    [brandId],
  );
  return r.rows;
}

// ---------------------------------------------------------------------------
// Per-job input sets
// ---------------------------------------------------------------------------
const GATHERERS = {
  "sage-deep-research": async (brandId) => ({
    bucket: dayBucket(),
    brand: await brandSnapshot(brandId),
    truth: await companyTruthSnapshot(brandId),
    competitors: await competitorsSnapshot(brandId),
  }),

  "sage-urgent-scan": async (brandId) => ({
    bucket: hourBucket(),
    brand: await brandSnapshot(brandId),
    competitors: await competitorsSnapshot(brandId),
  }),

  "sage-pattern-study": async (brandId) => ({
    bucket: isoWeekBucket(),
    brand: await brandSnapshot(brandId),
  }),

  "competitor-scan": async (brandId) => ({
    brand: await brandSnapshot(brandId),
    campaigns: await one(
      `SELECT COUNT(*)::int AS n, MAX(updated_at)::text AS last
         FROM campaigns WHERE brand_id = $1 AND status = 'active'`,
      [brandId],
    ),
    bucket: dayBucket(),
  }),

  "competitor-ad-scan": async (brandId) => ({
    bucket: sixHourBucket(),
    competitors: await competitorsSnapshot(brandId),
  }),

  "competitor-site-digest": async (brandId) => ({
    bucket: isoWeekBucket(),
    changes: await one(
      `SELECT COUNT(*)::int AS n, MAX(detected_at)::text AS last
         FROM competitor_website_changes
        WHERE brand_id = $1 AND detected_at > NOW() - INTERVAL '7 days'`,
      [brandId],
    ).catch(() => null),
  }),

  "weekly-analytics": async (brandId) => ({
    bucket: isoWeekBucket(),
    campaigns: await one(
      `SELECT COUNT(*)::int AS n, MAX(updated_at)::text AS last
         FROM campaigns WHERE brand_id = $1 AND status = 'active'`,
      [brandId],
    ),
    leads: await one(
      `SELECT COUNT(*)::int AS n FROM leads
        WHERE brand_id = $1 AND created_at > NOW() - INTERVAL '7 days'`,
      [brandId],
    ),
  }),

  "autopilot-study": async (brandId) => ({
    bucket: isoWeekBucket(),
    signals: await one(
      `SELECT COUNT(*)::int AS n, MAX(created_at)::text AS last
         FROM echo_learning_signals WHERE brand_id = $1`,
      [brandId],
    ).catch(() => null),
  }),
};

/**
 * Gate a per-brand recurring AI job.
 *
 * Usage in a sweep loop:
 *   const gate = await gateJob("sage-deep-research", brand.brand_id);
 *   if (!gate.run) { await gate.skip(); continue; }
 *   await runDeepCycleForBrand(brand);
 *   await gate.done();
 *
 * With SAGE_V2_SKIP_GATES off (default), gate.run is always true and
 * done()/skip() are no-ops — byte-identical legacy behavior.
 */
async function gateJob(jobType, brandId) {
  try {
    const gatherer = GATHERERS[jobType];
    if (!gatherer) return { run: true, done: async () => {}, skip: async () => {} };
    const inputs = await gatherer(brandId);
    const decision = await shouldRun(jobType, brandId, inputs);
    const noop = decision.reason === "gate_off" || decision.reason === "gate_error";
    return {
      run: decision.run,
      reason: decision.reason,
      hash: decision.hash,
      done: async () => {
        if (!noop) await recordRun(jobType, brandId, decision.hash, "done");
      },
      skip: async () => {
        if (!noop) {
          await recordRun(jobType, brandId, decision.hash, "skipped_unchanged");
          console.log(`Skip gate: ${jobType} unchanged for brand ${brandId} — no AI call.`);
        }
      },
    };
  } catch (err) {
    // Fail open — a broken gate never stops real work.
    console.error(`gateJob(${jobType}) failed open:`, err.message);
    return { run: true, reason: "gate_error", done: async () => {}, skip: async () => {} };
  }
}

module.exports = { gateJob, GATHERERS, dayBucket, hourBucket, sixHourBucket, isoWeekBucket };
