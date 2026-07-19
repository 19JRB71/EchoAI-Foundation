// Sage V2 Phase 6 — channel scorecards, forecasts, Top-3-bets strategy +
// Executive Debate, self-eval. All 4 flags default OFF; tests flip them via
// process.env and restore after. AI-path validation is tested through the
// exported pure validators (no test calls real AI); the refusal paths that
// fire BEFORE any AI call (live strategy, no evidence, debate cap) are
// exercised for real against the DB.
require("./dbGuard");

const test = require("node:test");
const assert = require("node:assert");
const db = require("../config/db");

const { getScorecards, computeAllChannelMetrics, computeChannelMetrics } = require("../utils/channelScorecards");
const { getForecasts, forecastSeries, MIN_WEEKS } = require("../utils/sageForecasts");
const { getSelfEval, buildAggregates, refreshSelfEvalCaches } = require("../utils/sageSelfEval");
const {
  getStrategyState,
  generateStrategy,
  approveStrategy,
  declineStrategy,
  reviseStrategy,
  validateDebateOptions,
  validateBets,
  validateBudgetLine,
  verifyBetEvidence,
  DEBATE_MONTHLY_CAP,
} = require("../utils/sageStrategy");

function withFlag(name, value, fn) {
  return async () => {
    const prev = process.env[name];
    process.env[name] = value;
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env[name];
      else process.env[name] = prev;
    }
  };
}

async function createBrand(fields = {}) {
  const email = `sagep6-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const u = await db.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING user_id",
    [email],
  );
  const b = await db.query(
    "INSERT INTO brands (user_id, brand_name, is_demo) VALUES ($1, 'SageP6 Test Brand', $2) RETURNING *",
    [u.rows[0].user_id, fields.isDemo || false],
  );
  return { userId: u.rows[0].user_id, brandId: b.rows[0].brand_id, brand: b.rows[0] };
}

async function deleteUser(userId) {
  await db.query("DELETE FROM sage_strategies WHERE brand_id IN (SELECT brand_id FROM brands WHERE user_id = $1)", [userId]).catch(() => {});
  await db.query("DELETE FROM users WHERE user_id = $1", [userId]);
}

async function createOpportunity(brandId, status = "approved") {
  const r = await db.query(
    `INSERT INTO sage_opportunities (brand_id, title, thesis, category, confidence, recommended_department, status, content_key)
     VALUES ($1, 'P6 opp', 'thesis', 'growth', 'reported', 'owner', $2, $3) RETURNING opportunity_id`,
    [brandId, status, `p6-${Date.now()}-${Math.random().toString(36).slice(2)}`],
  );
  return String(r.rows[0].opportunity_id);
}

function goodBet(oppId, overrides = {}) {
  return {
    title: "Double down on referrals",
    thesis: "Referrals convert best in the data",
    objective: "Grow referral leads 30%",
    expected_timeframe: "6-8 weeks",
    primary_kpi: "referral leads per week",
    success_threshold: "8+ referral leads/week",
    review_date: "2026-10-01",
    opportunity_ids: [oppId],
    ...overrides,
  };
}

function goodOptions() {
  return {
    options: [
      { title: "Do nothing", description: "Costs momentum", tradeoffs: "t", risks: "r", expected_effect: "flat", is_baseline: true },
      { title: "Option B", description: "d", tradeoffs: "t", risks: "r", expected_effect: "e" },
      { title: "Option C", description: "d", tradeoffs: "t", risks: "r", expected_effect: "e" },
    ],
    chosen_option_title: "Option B",
    chosen_because: "best evidence",
  };
}

// ---------------------------------------------------------------------------
// Flags dark — every read util answers { enabled:false }, zero writes
// ---------------------------------------------------------------------------

test("dark flags: scorecards/forecasts/self-eval answer enabled:false", async () => {
  const { userId, brandId } = await createBrand();
  try {
    assert.deepStrictEqual(await getScorecards(brandId), { enabled: false });
    assert.deepStrictEqual(await getForecasts(brandId), { enabled: false });
    assert.deepStrictEqual(await getSelfEval(brandId), { enabled: false });
    assert.deepStrictEqual(await refreshSelfEvalCaches(), { refreshed: 0 });
    const rows = await db.query("SELECT COUNT(*)::int AS n FROM sage_self_eval WHERE brand_id = $1", [brandId]);
    assert.strictEqual(rows.rows[0].n, 0);
  } finally {
    await deleteUser(userId);
  }
});

// ---------------------------------------------------------------------------
// Scorecard arithmetic — null-not-zero
// ---------------------------------------------------------------------------

test("scorecards: no analytics history is reported, never zero-filled", () => {
  const { metrics, sourceRowCounts } = computeAllChannelMetrics([]);
  assert.strictEqual(metrics.unavailable, true);
  assert.strictEqual(metrics.reason, "no_analytics_history");
  assert.strictEqual(sourceRowCounts.analytics_weeks, 0);
});

test("scorecards: missing cost_per_lead stays null with a reason code", () => {
  const { metrics } = computeAllChannelMetrics([
    { week_date: "2026-07-13", total_spend: null, total_leads: 0, cost_per_lead: null, conversions: 0, return_on_ad_spend: null },
  ]);
  assert.strictEqual(metrics.cost_per_lead, null);
  assert.strictEqual(metrics.cost_per_lead_reason, "no_leads_or_spend_this_week");
  assert.strictEqual(metrics.roas, null);
  assert.strictEqual(metrics.roas_reason, "not_reported_this_week");
});

test("scorecards: per-channel spend is honestly null (no per-channel spend data)", () => {
  const { metrics } = computeChannelMetrics({ leads_30d: 5, leads_prev_30d: 3, won: 1, lost: 1, measured: 2 });
  assert.strictEqual(metrics.spend, null);
  assert.strictEqual(metrics.spend_reason, "no_per_channel_spend_data");
  assert.strictEqual(metrics.cost_per_lead, null);
  assert.strictEqual(metrics.leads_30d, 5);
});

test("scorecards: derives cost_per_lead and trailing averages from analytics", () => {
  const rows = [
    { week_date: "2026-07-13", total_spend: 200, total_leads: 10, cost_per_lead: null, conversions: 2, return_on_ad_spend: 2.5 },
    { week_date: "2026-07-06", total_spend: 100, total_leads: 5, cost_per_lead: 20, conversions: 1, return_on_ad_spend: null },
  ];
  const { metrics, sourceRowCounts } = computeAllChannelMetrics(rows);
  assert.strictEqual(metrics.cost_per_lead, 20); // 200/10 derived
  assert.strictEqual(metrics.trailing_avg.weeks, 2);
  assert.strictEqual(metrics.trailing_avg.spend, 150);
  assert.strictEqual(sourceRowCounts.analytics_weeks, 2);
  assert.ok(metrics.week_over_week); // decomposition terms present
});

// ---------------------------------------------------------------------------
// Forecast math — 8-week refusal, band ordering, non-negative clamp
// ---------------------------------------------------------------------------

test("forecasts: below 8 weeks refuses honestly, stores nothing", () => {
  const f = forecastSeries([10, 12, 11, 9, 10, 11, 12]);
  assert.strictEqual(f.sufficient, false);
  assert.strictEqual(f.weeks_available, 7);
  assert.strictEqual(f.weeks_needed, MIN_WEEKS);
  assert.strictEqual(f.low, undefined);
});

test("forecasts: band ordering low ≤ expected ≤ high, basis stored", () => {
  const f = forecastSeries([10, 12, 11, 13, 12, 14, 13, 15, 14, 16]);
  assert.strictEqual(f.sufficient, true);
  assert.ok(f.low <= f.expected && f.expected <= f.high);
  assert.strictEqual(f.basis.method, "trailing_linear_trend_v1");
  assert.strictEqual(f.basis.weeks_of_history, 10);
  assert.ok(Array.isArray(f.basis.assumptions) && f.basis.assumptions.length >= 2);
});

test("forecasts: declining series clamps low at zero, never negative", () => {
  const f = forecastSeries([40, 30, 22, 15, 10, 6, 3, 1]);
  assert.strictEqual(f.sufficient, true);
  assert.ok(f.low >= 0);
  assert.ok(f.expected >= 0);
});

test(
  "forecasts: end-to-end insufficient history answers sufficient:false and stores nothing",
  withFlag("SAGE_V2_FORECASTS", "true", async () => {
    const { userId, brandId } = await createBrand();
    try {
      const res = await getForecasts(brandId);
      assert.strictEqual(res.enabled, true);
      assert.strictEqual(res.forecasts.leads.sufficient, false);
      const n = await db.query("SELECT COUNT(*)::int AS n FROM sage_forecasts WHERE brand_id = $1", [brandId]);
      assert.strictEqual(n.rows[0].n, 0);
    } finally {
      await deleteUser(userId);
    }
  }),
);

// ---------------------------------------------------------------------------
// Debate + bet validators (the write chokepoint's pure half)
// ---------------------------------------------------------------------------

test("debate: fewer than 3 options rejected", () => {
  const p = goodOptions();
  p.options = p.options.slice(0, 2);
  assert.match(validateDebateOptions(p), /fewer than 3/);
});

test("debate: missing do-nothing baseline rejected", () => {
  const p = goodOptions();
  delete p.options[0].is_baseline;
  assert.match(validateDebateOptions(p), /baseline/);
});

test("debate: two baselines rejected; empty field rejected; bad chosen rejected", () => {
  let p = goodOptions();
  p.options[1].is_baseline = true;
  assert.match(validateDebateOptions(p), /exactly one/);
  p = goodOptions();
  p.options[2].risks = "  ";
  assert.match(validateDebateOptions(p), /missing risks/);
  p = goodOptions();
  p.chosen_option_title = "Option Z";
  assert.match(validateDebateOptions(p), /does not match/);
});

test("debate: valid option set passes", () => {
  assert.strictEqual(validateDebateOptions(goodOptions()), null);
});

test("bets: each CEO-refinement field is individually required", () => {
  for (const field of ["objective", "expected_timeframe", "primary_kpi", "success_threshold"]) {
    const bet = goodBet("x", { [field]: "" });
    assert.match(validateBets([bet]), new RegExp(field));
  }
  assert.match(validateBets([goodBet("x", { review_date: "soonish" })]), /review_date/);
  assert.match(validateBets([goodBet("x", { opportunity_ids: [] })]), /no evidence/);
  assert.match(validateBets([]), /1 to 3/);
  assert.match(validateBets([goodBet("a"), goodBet("b"), goodBet("c"), goodBet("d")]), /1 to 3/);
  assert.strictEqual(validateBets([goodBet("x")]), null);
});

test("budget line: negative or fractional cents rejected", () => {
  assert.strictEqual(validateBudgetLine(null), null);
  assert.match(validateBudgetLine({ statement: "s", channels: [{ channel: "fb", amount_cents: -1 }] }), /non-negative integer cents/);
  assert.match(validateBudgetLine({ statement: "s", channels: [{ channel: "fb", amount_cents: 10.5 }] }), /non-negative integer cents/);
  assert.strictEqual(validateBudgetLine({ statement: "s", channels: [{ channel: "fb", amount_cents: 5000 }] }), null);
});

// ---------------------------------------------------------------------------
// Evidence chokepoint against the real DB
// ---------------------------------------------------------------------------

test(
  "evidence chokepoint: foreign, expired, and unknown citations rejected",
  withFlag("SAGE_V2_STRATEGY", "true", async () => {
    const a = await createBrand();
    const b = await createBrand();
    try {
      const good = await createOpportunity(a.brandId, "approved");
      const expired = await createOpportunity(a.brandId, "expired");
      const foreign = await createOpportunity(b.brandId, "approved");
      const client = await db.pool.connect();
      try {
        assert.strictEqual(await verifyBetEvidence(client, a.brandId, [goodBet(good)]), null);
        assert.match(await verifyBetEvidence(client, a.brandId, [goodBet(expired)]), /expired/);
        assert.match(await verifyBetEvidence(client, a.brandId, [goodBet(foreign)]), /does not exist/);
      } finally {
        client.release();
      }
    } finally {
      await deleteUser(a.userId);
      await deleteUser(b.userId);
    }
  }),
);

// ---------------------------------------------------------------------------
// Pre-AI refusals: live strategy, no evidence, debate cap (no AI is called)
// ---------------------------------------------------------------------------

async function insertStrategy(brandId, status = "proposed", bets = null) {
  const r = await db.query(
    `INSERT INTO sage_strategies (brand_id, bets, status) VALUES ($1, $2::jsonb, $3) RETURNING *`,
    [brandId, JSON.stringify(bets || [goodBet("ignored")].map(({ opportunity_ids, ...b }) => b)), status],
  );
  return r.rows[0];
}

test(
  "generate refuses when a live strategy exists (409, no AI call)",
  withFlag("SAGE_V2_STRATEGY", "true", async () => {
    const { userId, brandId, brand } = await createBrand();
    try {
      await insertStrategy(brandId, "proposed");
      await assert.rejects(() => generateStrategy(brand), (err) => {
        assert.strictEqual(err.code, "live_strategy_exists");
        assert.strictEqual(err.status, 409);
        return true;
      });
    } finally {
      await deleteUser(userId);
    }
  }),
);

test(
  "generate refuses with no live opportunities (no evidence, no bet)",
  withFlag("SAGE_V2_STRATEGY", "true", async () => {
    const { userId, brand } = await createBrand();
    try {
      await assert.rejects(() => generateStrategy(brand), (err) => err.code === "no_evidence");
    } finally {
      await deleteUser(userId);
    }
  }),
);

test(
  "debate cap: 2 debates this month refuses a third before any AI call",
  withFlag("SAGE_V2_STRATEGY", "true", async () => {
    const { userId, brandId, brand } = await createBrand();
    try {
      for (let i = 0; i < DEBATE_MONTHLY_CAP; i++) {
        await db.query(
          `INSERT INTO sage_debates (brand_id, trigger_event, options) VALUES ($1, 'new_strategy', '[]'::jsonb)`,
          [brandId],
        );
      }
      await assert.rejects(() => generateStrategy(brand), (err) => err.code === "debate_limit");
    } finally {
      await deleteUser(userId);
    }
  }),
);

// ---------------------------------------------------------------------------
// Status transitions — row-count branched, one live strategy per brand
// ---------------------------------------------------------------------------

test(
  "approve: proposed → approved; double-approve rejected; foreign brand 404",
  withFlag("SAGE_V2_STRATEGY", "true", async () => {
    const { userId, brandId, brand } = await createBrand();
    const other = await createBrand();
    try {
      const s = await insertStrategy(brandId, "proposed");
      await assert.rejects(
        () => approveStrategy(other.brand, s.strategy_id),
        (err) => err.status === 404,
      );
      const approved = await approveStrategy(brand, s.strategy_id, "go");
      assert.strictEqual(approved.status, "approved");
      assert.ok(approved.decidedAt);
      await assert.rejects(() => approveStrategy(brand, s.strategy_id), (err) => err.code === "invalid_transition");
    } finally {
      await deleteUser(userId);
      await deleteUser(other.userId);
    }
  }),
);

test(
  "approve blocks when budget exceeds brand constraints (never silently altered)",
  withFlag("SAGE_V2_STRATEGY", "true", async () => {
    const { userId, brandId, brand } = await createBrand();
    try {
      await db.query(
        `INSERT INTO brand_constraints (brand_id, monthly_budget_cents) VALUES ($1, 50000)`,
        [brandId],
      );
      const r = await db.query(
        `INSERT INTO sage_strategies (brand_id, bets, budget_line, status)
         VALUES ($1, '[]'::jsonb, $2::jsonb, 'proposed') RETURNING strategy_id`,
        [brandId, JSON.stringify({ statement: "s", channels: [{ channel: "fb", amount_cents: 60000 }] })],
      );
      await assert.rejects(
        () => approveStrategy(brand, r.rows[0].strategy_id),
        (err) => err.code === "constraint_violation" && /exceeds/.test(err.message),
      );
      const check = await db.query(`SELECT status, budget_line FROM sage_strategies WHERE strategy_id = $1`, [r.rows[0].strategy_id]);
      assert.strictEqual(check.rows[0].status, "proposed"); // blocked, not altered
      assert.strictEqual(check.rows[0].budget_line.channels[0].amount_cents, 60000);
    } finally {
      await deleteUser(userId);
    }
  }),
);

test(
  "decline: proposed → declined; repeat rejected",
  withFlag("SAGE_V2_STRATEGY", "true", async () => {
    const { userId, brandId, brand } = await createBrand();
    try {
      const s = await insertStrategy(brandId, "proposed");
      const declined = await declineStrategy(brand, s.strategy_id, "not now");
      assert.strictEqual(declined.status, "declined");
      assert.strictEqual(declined.ownerNote, "not now");
      await assert.rejects(() => declineStrategy(brand, s.strategy_id), (err) => err.code === "invalid_transition");
    } finally {
      await deleteUser(userId);
    }
  }),
);

test(
  "revise: supersedes old atomically, re-validates evidence, keeps one live strategy",
  withFlag("SAGE_V2_STRATEGY", "true", async () => {
    const { userId, brandId, brand } = await createBrand();
    try {
      const opp = await createOpportunity(brandId, "approved");
      const s = await insertStrategy(brandId, "approved");
      // invalid bets → 400, nothing changes
      await assert.rejects(
        () => reviseStrategy(brand, s.strategy_id, { bets: [goodBet(opp, { objective: "" })] }),
        (err) => err.status === 400,
      );
      const revised = await reviseStrategy(brand, s.strategy_id, {
        bets: [goodBet(opp)],
        budgetLine: { statement: "modest", channels: [{ channel: "fb", amount_cents: 10000 }] },
        ownerNote: "tightened",
      });
      assert.strictEqual(revised.status, "proposed");
      assert.strictEqual(revised.origin, "owner_revision");
      assert.deepStrictEqual(revised.bets[0].opportunity_ids, [opp]);
      const old = await db.query(`SELECT status, superseded_by FROM sage_strategies WHERE strategy_id = $1`, [s.strategy_id]);
      assert.strictEqual(old.rows[0].status, "superseded");
      assert.strictEqual(String(old.rows[0].superseded_by), String(revised.strategyId));
      const live = await db.query(
        `SELECT COUNT(*)::int AS n FROM sage_strategies WHERE brand_id = $1 AND status IN ('proposed','approved')`,
        [brandId],
      );
      assert.strictEqual(live.rows[0].n, 1);
      const state = await getStrategyState(brandId);
      assert.strictEqual(String(state.strategy.strategyId), String(revised.strategyId));
    } finally {
      await deleteUser(userId);
    }
  }),
);

test("DB enforces at most one live strategy per brand", async () => {
  const { userId, brandId } = await createBrand();
  try {
    await insertStrategy(brandId, "proposed");
    await assert.rejects(() => insertStrategy(brandId, "approved"), /uniq_sage_strategies_live|duplicate key/);
  } finally {
    await deleteUser(userId);
  }
});

// ---------------------------------------------------------------------------
// Self-eval aggregation — denominators, inconclusive bucket, honest nulls
// ---------------------------------------------------------------------------

test("self-eval: denominators stated; inconclusive never counts as a win", () => {
  const agg = buildAggregates({
    proposed: 7, approved: 5, declined: 2, expired: 0,
    wins: 2, misses: 1, inconclusive: 1, measured: 4, aiCostUsd: 1.25,
  });
  assert.deepStrictEqual(agg.measured_of_approved, { measured: 4, of: 5 });
  assert.strictEqual(agg.wins, 2);
  assert.strictEqual(agg.inconclusive, 1);
  assert.strictEqual(agg.not_yet_measurable, 1);
  assert.strictEqual(agg.ai_cost_cents, 125);
  assert.strictEqual(agg.cost_per_approved_cents, 25);
});

test("self-eval: no cost data reports null with reason, never zero", () => {
  const agg = buildAggregates({ proposed: 0, approved: 0, declined: 0, expired: 0, wins: 0, misses: 0, inconclusive: 0, measured: 0, aiCostUsd: null });
  assert.strictEqual(agg.ai_cost_cents, null);
  assert.strictEqual(agg.cost_per_approved_cents, null);
  assert.strictEqual(agg.cost_per_approved_reason, "no_approved_recommendations_yet");
});

test(
  "self-eval end-to-end: caches per (brand, period) and counts real rows",
  withFlag("SAGE_V2_SELF_EVAL", "true", async () => {
    const { userId, brandId } = await createBrand();
    try {
      const opp = await createOpportunity(brandId, "succeeded");
      await db.query(
        `INSERT INTO sage_decisions (brand_id, subject_type, subject_id, decided) VALUES ($1, 'opportunity', $2, 'approved')`,
        [brandId, opp],
      );
      const res = await getSelfEval(brandId, "90d");
      assert.strictEqual(res.enabled, true);
      assert.strictEqual(res.aggregates.approved, 1);
      assert.strictEqual(res.aggregates.wins, 1);
      const cached = await db.query(`SELECT * FROM sage_self_eval WHERE brand_id = $1 AND period = '90d'`, [brandId]);
      assert.strictEqual(cached.rows.length, 1);
      // recompute upserts, never duplicates
      await getSelfEval(brandId, "90d");
      const again = await db.query(`SELECT COUNT(*)::int AS n FROM sage_self_eval WHERE brand_id = $1`, [brandId]);
      assert.strictEqual(again.rows[0].n, 1);
    } finally {
      await deleteUser(userId);
    }
  }),
);

test(
  "self-eval nightly refresh excludes demo brands",
  withFlag("SAGE_V2_SELF_EVAL", "true", async () => {
    const demo = await createBrand({ isDemo: true });
    try {
      const opp = await createOpportunity(demo.brandId, "approved");
      await db.query(
        `INSERT INTO sage_decisions (brand_id, subject_type, subject_id, decided) VALUES ($1, 'opportunity', $2, 'approved')`,
        [demo.brandId, opp],
      );
      await refreshSelfEvalCaches();
      const rows = await db.query(`SELECT COUNT(*)::int AS n FROM sage_self_eval WHERE brand_id = $1`, [demo.brandId]);
      assert.strictEqual(rows.rows[0].n, 0);
    } finally {
      await deleteUser(demo.userId);
    }
  }),
);

// ---------------------------------------------------------------------------
// Scorecards end-to-end with flag on
// ---------------------------------------------------------------------------

test(
  "scorecards end-to-end: computes, caches, and reports source row counts",
  withFlag("SAGE_V2_SCORECARDS", "true", async () => {
    const { userId, brandId } = await createBrand();
    try {
      await db.query(
        `INSERT INTO analytics (brand_id, week_date, total_spend, total_leads, conversions)
         VALUES ($1, CURRENT_DATE - 7, 100, 10, 2), ($1, CURRENT_DATE - 14, 80, 8, 1)`,
        [brandId],
      );
      const res = await getScorecards(brandId);
      assert.strictEqual(res.enabled, true);
      const all = res.scorecards.find((c) => c.channel === "all");
      assert.ok(all);
      assert.strictEqual(all.source_row_counts.analytics_weeks, 2);
      const cachedRes = await getScorecards(brandId);
      assert.strictEqual(cachedRes.cached, true);
    } finally {
      await deleteUser(userId);
    }
  }),
);
