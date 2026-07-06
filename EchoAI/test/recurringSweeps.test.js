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

// --- Competitor scan (every 6 hours) ------------------------------------------

const anthropicModule = require("../config/anthropic");

/**
 * In-memory stand-in for db.query covering the 6-hourly competitor scan. The
 * scan's per-brand work is runCompetitorAnalysisForBrand: an Anthropic call
 * followed by the competitor_intelligence insert. The AI client is stubbed in
 * the test itself (throwing for the broken brand's niche), so the fake db only
 * needs brand discovery + the insert. Every unrecognized query throws so
 * nothing can silently reach a real table.
 */
function makeCompetitorScanDb(seed) {
  const state = { intelInserts: [] };

  async function query(sql, params = []) {
    // 1) Brand discovery (the scan's first, unguarded query).
    if (/FROM brands/i.test(sql) && /is_demo = false/i.test(sql) && /FROM campaigns WHERE status = 'active'/i.test(sql)) {
      return { rows: seed.brands.map((b) => ({ ...b })) };
    }

    // 2) The persisted report — the proof a brand was fully scanned.
    if (/INSERT INTO competitor_intelligence/i.test(sql)) {
      state.intelInserts.push(params[0]);
      return {
        rows: [
          { intelligence_id: `i${state.intelInserts.length}`, created_at: new Date().toISOString() },
        ],
      };
    }

    throw new Error(`makeCompetitorScanDb: unexpected query: ${sql.slice(0, 80)}`);
  }

  return { query, state };
}

test("runCompetitorScan: brand 1's AI failure never stops brand 2's scan", async () => {
  const { runCompetitorScan } = require("../utils/scheduler");

  const fake = makeCompetitorScanDb({
    brands: [
      { brand_id: "b1", brand_name: "Broken Co", user_id: "u1", niche: "broken-niche" },
      { brand_id: "b2", brand_name: "Fine Co", user_id: "u2", niche: "fine-niche" },
    ],
  });

  const aiCalls = [];
  const origQuery = db.query;
  const origCreate = anthropicModule.anthropic.messages.create;
  db.query = fake.query;
  // The broken brand's analysis dies at the AI call (e.g. Anthropic down);
  // the healthy brand gets a valid JSON report back. Non-transient message so
  // the createMessage-style retry logic (not used here, but defensively) can't
  // mask the failure.
  anthropicModule.anthropic.messages.create = async (params) => {
    const prompt = params.messages[0].content;
    aiCalls.push(prompt.includes("broken-niche") ? "b1" : "b2");
    if (prompt.includes("broken-niche")) {
      throw new Error("AI exploded for Broken Co");
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            niche: "fine-niche",
            targetAudience: "everyone",
            competitors: [],
            gaps: ["gap"],
            opportunities: ["opportunity"],
          }),
        },
      ],
    };
  };

  try {
    // Must resolve — brand 1's AI throw is contained by the per-brand guard.
    await runCompetitorScan();

    // Both brands were attempted, in order...
    assert.deepStrictEqual(aiCalls, ["b1", "b2"], "both brands must be attempted in order");
    // ...brand 1 never persisted a report, but brand 2's report landed.
    assert.deepStrictEqual(
      fake.state.intelInserts,
      ["b2"],
      "the next brand's competitor report must still be saved after brand 1 throws",
    );
  } finally {
    db.query = origQuery;
    anthropicModule.anthropic.messages.create = origCreate;
  }
});

// --- Daily portfolio health snapshots -----------------------------------------

/**
 * In-memory stand-in for db.query covering the daily health snapshot sweep.
 * snapshotHealth is deterministic (no AI): three metric reads, a prior-snapshot
 * read, and the upsert. The configured broken brand's leads read throws a hard
 * db error, which must be contained by the sweep's per-brand guard. Every
 * unrecognized query throws.
 */
function makeHealthSnapshotDb(seed) {
  const state = { snapshotInserts: [] };

  async function query(sql, params = []) {
    // 1) Brand discovery (the sweep's first, unguarded query).
    if (/SELECT brand_id FROM brands WHERE is_demo = false/i.test(sql)) {
      return { rows: seed.brands.map((b) => ({ ...b })) };
    }

    // 2) Lead metrics inside computeHealthForBrand — throws for the broken brand.
    if (/FROM leads/i.test(sql) && /temperature = 'hot'/i.test(sql) && /prev_7d/i.test(sql)) {
      if ((seed.failLeadsForBrands || []).includes(params[0])) {
        throw new Error(`leads unreadable for ${params[0]}`);
      }
      return {
        rows: [{ total: 10, last_7d: 3, prev_7d: 2, hot: 1, open: 4, converted: 2 }],
      };
    }

    // 3) Active-campaign count.
    if (/FROM campaigns WHERE brand_id/i.test(sql) && /status = 'active'/i.test(sql)) {
      return { rows: [{ active: 1 }] };
    }

    // 4) 28-day ROAS aggregate.
    if (/FROM analytics/i.test(sql) && /return_on_ad_spend/i.test(sql)) {
      return { rows: [{ avg_roas: 0, weeks: 0 }] };
    }

    // 5) Prior-snapshot read (for the drivers explanation).
    if (/FROM portfolio_health_scores/i.test(sql) && /score_date </i.test(sql)) {
      return { rows: [] };
    }

    // 6) The snapshot upsert — the proof a brand was fully scored.
    if (/INSERT INTO portfolio_health_scores/i.test(sql)) {
      state.snapshotInserts.push(params[0]);
      return { rows: [] };
    }

    throw new Error(`makeHealthSnapshotDb: unexpected query: ${sql.slice(0, 80)}`);
  }

  return { query, state };
}

test("runDailyHealthSnapshots: brand 1's hard failure never stops brand 2's score", async () => {
  const { runDailyHealthSnapshots } = require("../utils/scheduler");

  const fake = makeHealthSnapshotDb({
    brands: [{ brand_id: "b1" }, { brand_id: "b2" }],
    failLeadsForBrands: ["b1"],
  });

  const origQuery = db.query;
  db.query = fake.query;
  try {
    // Must resolve — brand 1's throw is contained by the per-brand guard.
    await runDailyHealthSnapshots();

    assert.ok(
      !fake.state.snapshotInserts.includes("b1"),
      "the broken brand must not record a health snapshot",
    );
    assert.deepStrictEqual(
      fake.state.snapshotInserts,
      ["b2"],
      "the next brand must still be scored after brand 1 throws",
    );
  } finally {
    db.query = origQuery;
  }
});

// --- Weekly cross-business intelligence ---------------------------------------

/**
 * In-memory stand-in for db.query covering the weekly cross-business run. Each
 * owner's portfolio is gathered (brands, health, week metrics, lifetime leads,
 * audience) before the AI synthesis. The configured broken owner's week-metrics
 * leads read throws a hard db error, which must be contained by the run's
 * per-owner guard so the next owner still gets a report. Every unrecognized
 * query throws so nothing can silently reach AI/network beyond the stub.
 */
function makeCrossBusinessDb(seed) {
  const state = { reportInserts: [] };

  async function query(sql, params = []) {
    // 1) Owner discovery (the run's first, unguarded query).
    if (/SELECT DISTINCT user_id FROM brands/i.test(sql)) {
      return { rows: seed.owners.map((u) => ({ user_id: u })) };
    }

    // 2) The owner's real brands.
    if (/SELECT brand_id, brand_name/i.test(sql) && /FROM brands/i.test(sql)) {
      return {
        rows: (seed.brandsByOwner[params[0]] || []).map((b) => ({ ...b })),
      };
    }

    // 3) Latest health snapshot (none → health is null, still valid).
    if (/FROM portfolio_health_scores/i.test(sql)) {
      return { rows: [] };
    }

    // 4) Week metrics: 7-day lead count — throws for the broken owner's brands.
    if (/FROM leads WHERE brand_id = \$1 AND created_at >= \$2/i.test(sql)) {
      if ((seed.failWeekLeadsForBrands || []).includes(params[0])) {
        throw new Error(`leads unreadable for ${params[0]}`);
      }
      return { rows: [{ n: 3 }] };
    }

    // 5) Week metrics: latest ad spend + revenue (none recorded).
    if (/SELECT total_spend FROM analytics/i.test(sql)) return { rows: [] };
    if (/FROM roi_advanced_snapshots/i.test(sql)) return { rows: [] };

    // 6) Lifetime lead signal.
    if (/FROM leads WHERE brand_id/i.test(sql) && /conversion_status = 'converted'/i.test(sql)) {
      return { rows: [{ total_leads: 10, converted: 2, hot: 1 }] };
    }

    // 7) Audience/personality read.
    if (/SELECT brand_personality, target_audience FROM brands/i.test(sql)) {
      return { rows: [{ brand_personality: "warm", target_audience: "locals" }] };
    }

    // 8) The report upsert — the proof an owner's report landed.
    if (/INSERT INTO cross_business_intelligence/i.test(sql)) {
      state.reportInserts.push(params[0]);
      return { rows: [] };
    }

    throw new Error(`makeCrossBusinessDb: unexpected query: ${sql.slice(0, 80)}`);
  }

  return { query, state };
}

test("runWeeklyCrossBusinessIntelligence: owner 1's failure never stops owner 2's report", async () => {
  const { runWeeklyCrossBusinessIntelligence } = require("../utils/scheduler");

  const fake = makeCrossBusinessDb({
    owners: ["u1", "u2"],
    brandsByOwner: {
      u1: [
        { brand_id: "u1a", brand_name: "Broken One" },
        { brand_id: "u1b", brand_name: "Broken Two" },
      ],
      u2: [
        { brand_id: "u2a", brand_name: "Cafe" },
        { brand_id: "u2b", brand_name: "Gym" },
      ],
    },
    failWeekLeadsForBrands: ["u1a", "u1b"],
  });

  let aiCalls = 0;
  const origQuery = db.query;
  const origCreate = anthropicModule.anthropic.messages.create;
  db.query = fake.query;
  // Owner 1 blows up while gathering portfolio data (before any AI call);
  // owner 2 reaches the AI, which returns a valid cross-business report.
  anthropicModule.anthropic.messages.create = async () => {
    aiCalls += 1;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            insights: [
              {
                category: "cross_referral",
                title: "Send cafe regulars to the gym",
                businesses: ["Cafe", "Gym"],
                insight: "Both serve the same local audience.",
                recommendedAction: "Run a joint referral offer.",
                impactScore: 8,
              },
            ],
            summary: "Momentum is strong; cross-promote the two local businesses.",
          }),
        },
      ],
    };
  };

  try {
    // Must resolve — owner 1's throw is contained by the per-owner guard.
    await runWeeklyCrossBusinessIntelligence();

    // Only owner 2's portfolio ever reached the AI...
    assert.strictEqual(aiCalls, 1, "only the healthy owner's portfolio reaches the AI");
    // ...and only owner 2's report was persisted.
    assert.ok(
      !fake.state.reportInserts.includes("u1"),
      "the broken owner must not record a cross-business report",
    );
    assert.deepStrictEqual(
      fake.state.reportInserts,
      ["u2"],
      "the next owner's report must still be generated after owner 1 throws",
    );
  } finally {
    db.query = origQuery;
    anthropicModule.anthropic.messages.create = origCreate;
  }
});
