const { test } = require("node:test");
const assert = require("node:assert");

const db = require("../config/db");

// ---------------------------------------------------------------------------
// Per-brand guard regressions for the two big recurring jobs: the hourly
// health sweep and the Monday weekly analytics/report run. Mirrors the
// makeGoalSweepDb-style fakes in goals.test.js / echoVoiceReminders.test.js:
// a hard failure while processing brand 1 must be contained by the per-brand
// guard so brand 2 is still processed. A future refactor that lifts work out
// of the guard would silently stop every following customer's checks/reports
// — these tests turn that regression into a loud failure.
// ---------------------------------------------------------------------------

// Tests never talk to a real database (db.query is swapped for the fakes
// below), but the weekly fake needs a decryptable Facebook token, so make
// sure an AES key exists even in stripped-down environments.
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";

const { encrypt } = require("../utils/encryption");
const { runHourlyHealthSweep } = require("../controllers/healthMonitorController");
const { runWeeklyAnalytics } = require("../utils/scheduler");

// --- Hourly health sweep -----------------------------------------------------

/**
 * In-memory stand-in for db.query covering the hourly sweep. Detection probes
 * are individually try/caught inside runHealthCheck (safeProbe), so the seam
 * that actually escapes into the sweep's per-brand guard is the UNguarded
 * health_checks history read — the fake throws it for the configured brand,
 * simulating a hard db failure mid-check. Every unrecognized query throws so
 * probe failures stay contained exactly like a broken table would be.
 */
function makeHealthSweepDb(seed) {
  const state = { healthInserts: [] };

  async function query(sql, params = []) {
    // 1) Brand discovery (the sweep's first, unguarded query).
    if (/FROM brands b/i.test(sql) && /JOIN users u/i.test(sql)) {
      return { rows: seed.brands.map((b) => ({ ...b })) };
    }

    // 2) Previous-status read inside runHealthCheck — NOT probe-guarded, so a
    // throw here escapes runHealthCheck into the sweep's per-brand guard.
    if (/FROM health_checks/i.test(sql) && /overall_status/i.test(sql)) {
      if ((seed.failHistoryForBrands || []).includes(params[0])) {
        throw new Error(`health_checks unreadable for ${params[0]}`);
      }
      return { rows: [] };
    }

    // 3) The persisted check — the proof a brand was fully checked.
    if (/INSERT INTO health_checks/i.test(sql)) {
      state.healthInserts.push(params[0]);
      return {
        rows: [
          {
            check_id: `c${state.healthInserts.length}`,
            brand_id: params[0],
            overall_status: params[1],
            issues_found: params[2],
            issues_auto_fixed: params[3],
            issues_requiring_attention: params[4],
            ai_analysis: params[5],
          },
        ],
      };
    }

    // Everything else (detection probes) throws — safeProbe must contain it.
    throw new Error(`makeHealthSweepDb: unexpected query: ${sql.slice(0, 80)}`);
  }

  return { query, state };
}

test("runHourlyHealthSweep: a hard failure for brand 1 never stops brand 2's check", async () => {
  const fake = makeHealthSweepDb({
    brands: [
      { brand_id: "b1", brand_name: "Broken Co", user_id: "u1" },
      { brand_id: "b2", brand_name: "Fine Co", user_id: "u2" },
    ],
    failHistoryForBrands: ["b1"],
  });

  const origQuery = db.query;
  db.query = fake.query;
  try {
    // Must resolve — brand 1's throw is contained by the per-brand guard.
    await runHourlyHealthSweep();

    // Brand 1's check never persisted (its failure happened mid-check)...
    assert.ok(
      !fake.state.healthInserts.includes("b1"),
      "the broken brand must not record a completed check",
    );
    // ...but brand 2 was still fully checked and persisted.
    assert.deepStrictEqual(
      fake.state.healthInserts,
      ["b2"],
      "the next brand must still be health-checked after brand 1 throws",
    );
  } finally {
    db.query = origQuery;
  }
});

// --- Weekly analytics / report run -------------------------------------------

/**
 * In-memory stand-in for db.query covering the weekly run's happy path for a
 * healthy brand (Facebook integration lookup, active-campaign scan, weekly
 * conversion count, analytics upsert). The configured broken brand's very
 * first query (the integration lookup) throws a hard db error, which must be
 * contained by the run's per-brand analytics guard. Every unrecognized query
 * throws so all the follow-on best-effort steps (optimization, creative
 * refresh, feedback report, ROI snapshot, intelligence, funding scan) fail
 * loudly into their own guards instead of silently reaching AI/network calls.
 */
function makeWeeklySweepDb(seed) {
  const state = { analyticsInserts: [], integrationLookups: [] };

  async function query(sql, params = []) {
    // 1) Brand discovery (the run's first, unguarded query).
    if (/FROM brands b/i.test(sql) && /JOIN campaigns c/i.test(sql)) {
      return { rows: seed.brands.map((b) => ({ ...b })) };
    }

    // 2) Facebook integration lookup — first thing analytics does per brand.
    if (/FROM api_integrations/i.test(sql)) {
      state.integrationLookups.push(params[0]);
      if ((seed.failIntegrationForUsers || []).includes(params[0])) {
        throw new Error(`api_integrations unreadable for ${params[0]}`);
      }
      return {
        rows: [
          {
            api_token_encrypted: encrypt("fb-token"),
            account_ref: "act_123",
            connection_status: "connected",
          },
        ],
      };
    }

    // 3) Active campaigns with a Facebook id (none → no Graph API calls).
    if (/FROM campaigns/i.test(sql) && /facebook_campaign_id IS NOT NULL/i.test(sql)) {
      return { rows: [] };
    }

    // 4) Weekly converted-leads count.
    if (/FROM leads/i.test(sql) && /conversion_status/i.test(sql)) {
      return { rows: [{ count: 0 }] };
    }

    // 5) The analytics upsert — the proof a brand's weekly record landed.
    if (/INSERT INTO analytics/i.test(sql)) {
      state.analyticsInserts.push(params[0]);
      return {
        rows: [
          {
            analytics_id: `a${state.analyticsInserts.length}`,
            brand_id: params[0],
            week_date: params[1],
            total_spend: params[2],
            total_leads: params[3],
          },
        ],
      };
    }

    // Everything else throws — each best-effort step's guard must contain it.
    throw new Error(`makeWeeklySweepDb: unexpected query: ${sql.slice(0, 80)}`);
  }

  return { query, state };
}

test("runWeeklyAnalytics: a hard failure for brand 1 never stops brand 2's weekly record", async () => {
  const fake = makeWeeklySweepDb({
    brands: [
      { brand_id: "b1", user_id: "u1" },
      { brand_id: "b2", user_id: "u2" },
    ],
    failIntegrationForUsers: ["u1"],
  });

  const origQuery = db.query;
  db.query = fake.query;
  try {
    // Must resolve — every per-brand/per-step failure stays inside its guard.
    await runWeeklyAnalytics();

    // Brand 1 was attempted first and blew up before recording anything...
    assert.strictEqual(
      fake.state.integrationLookups[0],
      "u1",
      "the broken brand must have been attempted first",
    );
    assert.ok(
      !fake.state.analyticsInserts.includes("b1"),
      "the broken brand must not record weekly analytics",
    );
    // ...but brand 2's weekly analytics still landed.
    assert.deepStrictEqual(
      fake.state.analyticsInserts,
      ["b2"],
      "the next brand's weekly analytics must still be recorded",
    );
    // And the run kept going for brand 2 (its integration was looked up —
    // by analytics and again by the optimization step).
    assert.ok(
      fake.state.integrationLookups.includes("u2"),
      "brand 2 must still be processed after brand 1's throw",
    );
  } finally {
    db.query = origQuery;
  }
});
