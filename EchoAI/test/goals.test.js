const { test } = require("node:test");
const assert = require("node:assert");

const goals = require("../config/goals");
const db = require("../config/db");
const goalMetrics = require("../utils/goalMetrics");
const goalAlerts = require("../utils/goalAlerts");

// --- config/goals.js pure math + registry -----------------------------------

test("computePercent: increase goals scale current/target", () => {
  assert.strictEqual(goals.computePercent(50, 100, "increase"), 50);
  assert.strictEqual(goals.computePercent(100, 100, "increase"), 100);
  assert.strictEqual(goals.computePercent(150, 100, "increase"), 150);
});

test("computePercent: decrease goals reward being at/below target", () => {
  // Cost per lead: target $10, current $20 -> 50% (twice the target = behind).
  assert.strictEqual(goals.computePercent(20, 10, "decrease"), 50);
  // At target -> 100%; below target -> over 100% (overachievement visible).
  assert.strictEqual(goals.computePercent(10, 10, "decrease"), 100);
  assert.strictEqual(goals.computePercent(5, 10, "decrease"), 200);
});

test("computePercent: no measurable basis returns null", () => {
  // Decrease goal with no current reading is not measurable yet.
  assert.strictEqual(goals.computePercent(0, 10, "decrease"), null);
  assert.strictEqual(goals.computePercent("x", 10, "increase"), null);
});

test("classifyProgress buckets by percent then projection", () => {
  assert.strictEqual(goals.classifyProgress(120, 120), goals.STATUS_EXCEEDING);
  assert.strictEqual(goals.classifyProgress(105, 105), goals.STATUS_HIT);
  assert.strictEqual(goals.classifyProgress(50, 95), goals.STATUS_ON_TRACK);
  assert.strictEqual(goals.classifyProgress(40, 60), goals.STATUS_AT_RISK);
  assert.strictEqual(goals.classifyProgress(null, null), goals.STATUS_NO_DATA);
});

test("clampScore keeps the score within 0..100", () => {
  assert.strictEqual(goals.clampScore(150), 100);
  assert.strictEqual(goals.clampScore(-10), 0);
  assert.strictEqual(goals.clampScore(null), 0);
  assert.strictEqual(goals.clampScore(73.2), 73.2);
});

test("brand type gating exposes only allowed metrics", () => {
  // Affiliate brands can target affiliate metrics; standard brands cannot.
  assert.ok(goals.metricAllowedForBrandType("commission", "affiliate"));
  assert.ok(!goals.metricAllowedForBrandType("commission", "standard"));
  // Standard brands get campaign metrics; affiliate brands don't.
  assert.ok(goals.metricAllowedForBrandType("cost_per_lead", "standard"));
  assert.ok(!goals.metricAllowedForBrandType("cost_per_lead", "affiliate"));
  // Affiliate brands optimize by click-through rate and cost per acquisition
  // (spec: "Atlas specifically optimizes for CTR and CPA for affiliate brands");
  // standard brands do not get these affiliate ad-efficiency metrics.
  assert.ok(goals.metricAllowedForBrandType("ctr", "affiliate"));
  assert.ok(goals.metricAllowedForBrandType("cpa", "affiliate"));
  assert.ok(!goals.metricAllowedForBrandType("ctr", "standard"));
  assert.ok(!goals.metricAllowedForBrandType("cpa", "standard"));
  // Unknown brand type falls back to the standard category set.
  const std = goals.metricsForBrandType("standard");
  assert.deepStrictEqual(goals.metricsForBrandType("nonsense"), std);
});

test("ctr/cpa metrics carry the right direction + unit for optimization", () => {
  const ctr = goals.getMetric("ctr");
  const cpa = goals.getMetric("cpa");
  // Higher CTR is better; lower CPA is better.
  assert.strictEqual(ctr.direction, "increase");
  assert.strictEqual(ctr.unit, "percent");
  assert.strictEqual(cpa.direction, "decrease");
  assert.strictEqual(cpa.unit, "currency");
});

test("isValidBrandType / isValidMetric reject unknowns", () => {
  assert.ok(goals.isValidBrandType("restaurant"));
  assert.ok(!goals.isValidBrandType("spaceship"));
  assert.ok(goals.isValidMetric("new_leads"));
  assert.ok(!goals.isValidMetric("teleportation"));
});

// --- utils/goalMetrics.js buildGoalProgress (stubbed db) --------------------

function withStub(handler, fn) {
  const original = db.query;
  db.query = handler;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      db.query = original;
    });
}

test("buildGoalProgress computes percent, projection, trend for cumulative goal", async () => {
  await withStub(
    async (sql) => {
      // Metric measurement (new_leads count) -> 10 so far this month.
      if (/FROM leads/i.test(sql)) return { rows: [{ value: 10 }] };
      // Prior snapshot for trend -> yesterday we had 6, so trend is "up".
      if (/FROM goal_snapshots/i.test(sql))
        return { rows: [{ current_value: 6 }] };
      return { rows: [] };
    },
    async () => {
      const progress = await goalMetrics.buildGoalProgress({
        goal_id: "g1",
        brand_id: "b1",
        metric_key: "new_leads",
        category: "lead",
        label: "New Leads",
        target_value: 100,
        sort_order: 0,
      });
      assert.strictEqual(progress.metricKey, "new_leads");
      assert.strictEqual(progress.currentValue, 10);
      assert.strictEqual(progress.percentToGoal, 10);
      assert.strictEqual(progress.trend, "up");
      // Projection is at least the current value (linear month-to-date).
      assert.ok(progress.projectedEom >= progress.currentValue);
      assert.ok(
        [
          goals.STATUS_AT_RISK,
          goals.STATUS_ON_TRACK,
          goals.STATUS_HIT,
          goals.STATUS_EXCEEDING,
        ].includes(progress.status),
      );
    },
  );
});

test("buildGoalProgress reports no_data for a decrease goal with no reading", async () => {
  await withStub(
    async (sql) => {
      // 'latest' rate metric with no analytics row -> null current value.
      if (/FROM analytics/i.test(sql)) return { rows: [] };
      if (/FROM goal_snapshots/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    async () => {
      const progress = await goalMetrics.buildGoalProgress({
        goal_id: "g2",
        brand_id: "b1",
        metric_key: "cost_per_lead",
        category: "campaign",
        label: "Cost Per Lead",
        target_value: 10,
        sort_order: 0,
      });
      assert.strictEqual(progress.currentValue, null);
      assert.strictEqual(progress.percentToGoal, null);
      assert.strictEqual(progress.status, goals.STATUS_NO_DATA);
    },
  );
});

test("computeBrandGoals averages clamped percents into a 0-100 score", async () => {
  await withStub(
    async (sql) => {
      // Two active goals.
      if (/FROM brand_goals/i.test(sql) && /status = 'active'/i.test(sql)) {
        return {
          rows: [
            {
              goal_id: "g1",
              brand_id: "b1",
              metric_key: "new_leads",
              category: "lead",
              label: "New Leads",
              target_value: 100,
              sort_order: 0,
            },
            {
              goal_id: "g2",
              brand_id: "b1",
              metric_key: "hot_leads",
              category: "lead",
              label: "Hot Leads",
              target_value: 100,
              sort_order: 1,
            },
          ],
        };
      }
      // new_leads -> 100 (100%), hot_leads -> 50 (50%). Score = 75.
      if (/AS value/i.test(sql) && /created_at/i.test(sql)) {
        return { rows: [{ value: /temperature/i.test(sql) ? 50 : 100 }] };
      }
      if (/FROM goal_snapshots/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    async () => {
      const out = await goalMetrics.computeBrandGoals("b1");
      assert.strictEqual(out.goalCount, 2);
      assert.strictEqual(out.goals.length, 2);
      assert.ok(out.score >= 0 && out.score <= 100);
    },
  );
});

// --- utils/goalAlerts.js alert derivation ----------------------------------

test("deriveAlertKinds: hit and exceeding map to status alerts", () => {
  assert.deepStrictEqual(
    goalAlerts.deriveAlertKinds({ status: "hit", percentToGoal: 100 }, null),
    [{ kind: "hit" }],
  );
  assert.deepStrictEqual(
    goalAlerts.deriveAlertKinds({ status: "exceeding", percentToGoal: 130 }, null),
    [{ kind: "exceeding" }],
  );
});

test("deriveAlertKinds: at_risk splits into early vs urgent by projection", () => {
  // Mildly behind but projected to nearly recover -> early heads-up.
  assert.deepStrictEqual(
    goalAlerts.deriveAlertKinds(
      { status: "at_risk", percentToGoal: 55, projectedPercent: 80 },
      null,
    ),
    [{ kind: "at_risk_early" }],
  );
  // Projected to fall well short -> urgent.
  assert.deepStrictEqual(
    goalAlerts.deriveAlertKinds(
      { status: "at_risk", percentToGoal: 30, projectedPercent: 45 },
      null,
    ),
    [{ kind: "at_risk_urgent" }],
  );
});

test("deriveAlertKinds: on_track/no_data raise no status alert", () => {
  assert.deepStrictEqual(
    goalAlerts.deriveAlertKinds({ status: "on_track", percentToGoal: 70 }, null),
    [],
  );
  assert.deepStrictEqual(
    goalAlerts.deriveAlertKinds({ status: "no_data", percentToGoal: null }, null),
    [],
  );
});

test("deriveAlertKinds: large single-day swing adds a momentum alert", () => {
  // +25pp in a day -> swing_up alongside the status bucket.
  const up = goalAlerts.deriveAlertKinds(
    { status: "on_track", percentToGoal: 75 },
    50,
  );
  assert.deepStrictEqual(up, [{ kind: "swing_up", delta: 25 }]);

  // -30pp in a day while behind -> both urgent status AND swing_down.
  const down = goalAlerts.deriveAlertKinds(
    { status: "at_risk", percentToGoal: 20, projectedPercent: 40 },
    50,
  );
  assert.deepStrictEqual(down, [
    { kind: "at_risk_urgent" },
    { kind: "swing_down", delta: -30 },
  ]);

  // A small day-over-day move stays quiet.
  assert.deepStrictEqual(
    goalAlerts.deriveAlertKinds({ status: "on_track", percentToGoal: 60 }, 50),
    [],
  );
});

test("buildAlertCopy: each kind produces a distinct spoken line + title", () => {
  const base = {
    metricKey: "new_leads",
    label: "New Leads",
    targetValue: 100,
    currentValue: 40,
    percentToGoal: 40,
  };
  const early = goalAlerts.buildAlertCopy(base, "Acme", "at_risk_early");
  const urgent = goalAlerts.buildAlertCopy(base, "Acme", "at_risk_urgent");
  assert.notStrictEqual(early.title, urgent.title);
  assert.ok(/Acme/.test(early.speak("Sam")));

  const up = goalAlerts.buildAlertCopy(base, "Acme", "swing_up", { delta: 25 });
  const down = goalAlerts.buildAlertCopy(base, "Acme", "swing_down", { delta: -30 });
  assert.ok(/25 points/.test(up.speak("Sam")));
  assert.ok(/30 points/.test(down.speak("Sam")));
  assert.notStrictEqual(up.title, down.title);
});

// --- utils/echoBriefing.js goal narration ----------------------------------

const echoBriefing = require("../utils/echoBriefing");

/** A quiet briefing payload (no leads/appts/etc.) with just goals attached. */
function quietBriefing(goals, brands) {
  return {
    brands: brands || [{ brand_id: "b1", brand_name: "Acme" }],
    newLeads: [],
    hotLeads: 0,
    todaysAppointments: [],
    followUpsCompleted: 0,
    campaigns: [],
    sentinelFixes: [],
    pendingApprovals: 0,
    competitorNote: null,
    facebookConnected: true,
    goals,
  };
}

test("hasActivity: goal state alone counts as briefing-worthy activity", () => {
  const noGoals = quietBriefing(null);
  assert.strictEqual(echoBriefing.hasActivity(noGoals), false);

  const withGoals = quietBriefing({
    score: 40,
    perBusiness: [{ brandId: "b1", brandName: "Acme", score: 40, atRisk: ["New Leads"], achieved: [], farAhead: [] }],
  });
  assert.strictEqual(echoBriefing.hasActivity(withGoals), true);
});

test("templateMorning: goals-only day narrates goals, not the empty welcome", () => {
  const data = quietBriefing({
    score: 40,
    perBusiness: [{ brandId: "b1", brandName: "Acme", score: 40, atRisk: ["New Leads"], achieved: [], farAhead: [] }],
  });
  const text = echoBriefing.templateMorning("Sam", data);
  assert.ok(/behind pace/.test(text), text);
  assert.ok(!/standing by/.test(text), "should not fall into the empty-account branch");
});

test("templateMorning: a brand with both far-ahead and at-risk reports both", () => {
  const data = quietBriefing({
    score: 70,
    perBusiness: [
      {
        brandId: "b1",
        brandName: "Acme",
        score: 70,
        atRisk: ["Cost Per Lead"],
        achieved: [],
        farAhead: ["New Leads"],
      },
    ],
  });
  const text = echoBriefing.templateMorning("Sam", data);
  // Both the win and the risk must appear — far-ahead must not silence at-risk.
  assert.ok(/far ahead on New Leads/.test(text), text);
  assert.ok(/Cost Per Lead .*behind pace/.test(text), text);
});

// --- Department category scoping (Prompt 67 spec) ----------------------------

test("DEPARTMENT_CATEGORIES: Atlas = campaign only, ROI = revenue only", () => {
  assert.deepStrictEqual(goals.DEPARTMENT_CATEGORIES.atlas, ["campaign"]);
  assert.deepStrictEqual(goals.DEPARTMENT_CATEGORIES.roi, ["revenue"]);
  assert.deepStrictEqual(goals.DEPARTMENT_CATEGORIES.nova, ["content"]);
  assert.deepStrictEqual(goals.DEPARTMENT_CATEGORIES.pulse, ["lead", "appointment"]);
});

// --- Atlas affiliate optimization guardrails (CTR / CPA) --------------------

const {
  buildCampaignOptimizationPrompt,
} = require("../prompts/campaignOptimizationPrompt");

test("affiliate goal targets inject CTR + CPA optimization guardrails", () => {
  // An affiliate brand that set click-through-rate and cost-per-acquisition
  // goals steers Atlas by those metrics.
  const prompt = buildCampaignOptimizationPrompt({
    brand: { brand_name: "Acme" },
    performance: [],
    goalTargets: { ctr: 2.5, cpa: 18 },
  });
  assert.ok(/Click-through rate target: 2\.5%/.test(prompt), prompt);
  assert.ok(/Cost per acquisition target: \$18/.test(prompt), prompt);
  // The guardrails frame it as affiliate-specific optimization.
  assert.ok(/optimize specifically for click-through rate/.test(prompt));
  assert.ok(/optimize specifically for cost per acquisition/.test(prompt));
});

test("standard CPL/ROAS targets do not emit affiliate CTR/CPA lines", () => {
  const prompt = buildCampaignOptimizationPrompt({
    brand: { brand_name: "Acme" },
    performance: [],
    goalTargets: { costPerLead: 15, roas: 4 },
  });
  assert.ok(/Cost per lead target: \$15/.test(prompt));
  assert.ok(!/Cost per acquisition target/.test(prompt));
  assert.ok(!/Click-through rate target/.test(prompt));
});

// --- Goal setup AI parse helpers (conversational wizard) ---------------------

const goalSetupPrompt = require("../prompts/goalSetupPrompt");

const parseCatalog = [
  { metricKey: "new_leads", label: "New Leads" },
  { metricKey: "cost_per_lead", label: "Cost Per Lead" },
];

test("buildGoalSetupPrompt lists only the catalog metricKeys", () => {
  const p = goalSetupPrompt.buildGoalSetupPrompt("standard", parseCatalog);
  assert.ok(p.includes("new_leads"));
  assert.ok(p.includes("cost_per_lead"));
  assert.ok(!p.includes("referrals"));
});

test("parseGoalSuggestions parses a clean JSON object", () => {
  const raw = '{"goals":[{"metricKey":"new_leads","targetValue":40}]}';
  assert.deepStrictEqual(goalSetupPrompt.parseGoalSuggestions(raw, parseCatalog), [
    { metricKey: "new_leads", targetValue: 40 },
  ]);
});

test("parseGoalSuggestions strips code fences and extracts embedded JSON", () => {
  const raw = 'Sure!\n```json\n{"goals":[{"metricKey":"cost_per_lead","targetValue":15}]}\n```';
  assert.deepStrictEqual(goalSetupPrompt.parseGoalSuggestions(raw, parseCatalog), [
    { metricKey: "cost_per_lead", targetValue: 15 },
  ]);
});

test("parseGoalSuggestions drops metrics not in the catalog and bad targets", () => {
  const raw = JSON.stringify({
    goals: [
      { metricKey: "new_leads", targetValue: 40 },
      { metricKey: "not_a_metric", targetValue: 10 },
      { metricKey: "cost_per_lead", targetValue: -5 },
      { metricKey: "cost_per_lead", targetValue: "abc" },
    ],
  });
  assert.deepStrictEqual(goalSetupPrompt.parseGoalSuggestions(raw, parseCatalog), [
    { metricKey: "new_leads", targetValue: 40 },
  ]);
});

test("parseGoalSuggestions dedups repeated metrics and handles junk safely", () => {
  const dup = JSON.stringify({
    goals: [
      { metricKey: "new_leads", targetValue: 40 },
      { metricKey: "new_leads", targetValue: 99 },
    ],
  });
  assert.deepStrictEqual(goalSetupPrompt.parseGoalSuggestions(dup, parseCatalog), [
    { metricKey: "new_leads", targetValue: 40 },
  ]);
  assert.deepStrictEqual(goalSetupPrompt.parseGoalSuggestions("not json at all", parseCatalog), []);
  assert.deepStrictEqual(goalSetupPrompt.parseGoalSuggestions("", parseCatalog), []);
});

// --- parseGoals controller: AI-failure contract ------------------------------

const goalController = require("../controllers/goalController");
const anthropicModule = require("../config/anthropic");

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

test("parseGoals maps an upstream AI failure to 502 (not 500)", async () => {
  const origQuery = db.query;
  const origCreate = anthropicModule.anthropic.messages.create;
  db.query = async () => ({
    rows: [{ brand_id: "b1", brand_name: "Acme", brand_type: "standard" }],
  });
  anthropicModule.anthropic.messages.create = async () => {
    throw new Error("anthropic unreachable");
  };
  try {
    const req = {
      user: { userId: "u1" },
      params: { brandId: "b1" },
      body: { message: "about 40 leads a month" },
    };
    const res = fakeRes();
    await goalController.parseGoals(req, res);
    assert.strictEqual(res.statusCode, 502);
  } finally {
    db.query = origQuery;
    anthropicModule.anthropic.messages.create = origCreate;
  }
});

test("parseGoals returns 400 when the message is missing", async () => {
  const origQuery = db.query;
  db.query = async () => ({
    rows: [{ brand_id: "b1", brand_name: "Acme", brand_type: "standard" }],
  });
  try {
    const req = { user: { userId: "u1" }, params: { brandId: "b1" }, body: {} };
    const res = fakeRes();
    await goalController.parseGoals(req, res);
    assert.strictEqual(res.statusCode, 400);
  } finally {
    db.query = origQuery;
  }
});

test("parseGoals returns validated suggestions on a good AI reply", async () => {
  const origQuery = db.query;
  const origCreate = anthropicModule.anthropic.messages.create;
  db.query = async () => ({
    rows: [{ brand_id: "b1", brand_name: "Acme", brand_type: "standard" }],
  });
  anthropicModule.anthropic.messages.create = async () => ({
    content: [
      {
        type: "text",
        text: '{"goals":[{"metricKey":"new_leads","targetValue":40},{"metricKey":"bogus","targetValue":9}]}',
      },
    ],
  });
  try {
    const req = {
      user: { userId: "u1" },
      params: { brandId: "b1" },
      body: { message: "40 leads a month" },
    };
    const res = fakeRes();
    await goalController.parseGoals(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.suggestions));
    // Out-of-catalog "bogus" is dropped; new_leads kept.
    assert.ok(res.body.suggestions.every((s) => s.metricKey !== "bogus"));
    assert.ok(res.body.suggestions.some((s) => s.metricKey === "new_leads"));
  } finally {
    db.query = origQuery;
    anthropicModule.anthropic.messages.create = origCreate;
  }
});

// --- runDailyGoalTracking() end-to-end sweep (stateful fake db) --------------
//
// Integration coverage for the daily sweep: it must read the PRIOR day's
// snapshot before writing today's, fire momentum alerts on >=20pt swings,
// never touch demo brands, allow a status + momentum alert for the same goal
// on the same day, and never re-alert the same (goal, kind, day) twice.

const pushController = require("../controllers/pushController");
const mobilePushController = require("../controllers/mobilePushController");

/**
 * A stateful in-memory fake of every query runDailyGoalTracking touches
 * (brand discovery, prior snapshots, brand_goals, metric reads, snapshot
 * upserts, the goal_alert_log claim, and the voice-notification insert).
 * It implements the same semantics as the real SQL so consecutive runs see
 * the state left behind by earlier ones.
 */
function makeGoalSweepDb(seed) {
  const today = new Date().toISOString().slice(0, 10);
  const state = {
    snapshots: seed.snapshots.map((s) => ({ ...s })),
    alertLog: new Set(), // `${goalId}:${kind}:${date}` claims
    voiceRows: [],
    voiceDedup: new Set(),
    sawDemoFilter: false,
  };

  async function query(sql, params = []) {
    // 1) Real-brand discovery (the sweep's first query).
    if (/FROM brand_goals g/i.test(sql) && /JOIN brands b/i.test(sql)) {
      // The demo-brand exclusion must live in this SQL — flag its presence and
      // implement the same filter so a removed clause would surface demo rows.
      state.sawDemoFilter = /is_demo\s*=\s*false/i.test(sql);
      const rows = seed.brands
        .filter(
          (b) =>
            (state.sawDemoFilter ? !b.is_demo : true) &&
            seed.goals.some((g) => g.brand_id === b.brand_id && g.status === "active"),
        )
        .map((b) => ({
          brand_id: b.brand_id,
          brand_name: b.brand_name,
          user_id: b.user_id,
        }));
      return { rows };
    }

    // 2) Prior percent-to-goal per goal (read BEFORE today's snapshot lands).
    if (/DISTINCT ON \(goal_id\)/i.test(sql)) {
      const brandId = params[0];
      const latest = new Map();
      for (const s of state.snapshots) {
        if (s.brand_id !== brandId || s.snapshot_date >= today) continue;
        const cur = latest.get(s.goal_id);
        if (!cur || s.snapshot_date > cur.snapshot_date) latest.set(s.goal_id, s);
      }
      return {
        rows: [...latest.values()].map((s) => ({
          goal_id: s.goal_id,
          percent_to_goal: s.percent_to_goal,
        })),
      };
    }

    // 3) Active goals for a brand (computeBrandGoals).
    if (/FROM brand_goals/i.test(sql) && /status = 'active'/i.test(sql)) {
      return {
        rows: seed.goals.filter((g) => g.brand_id === params[0] && g.status === "active"),
      };
    }

    // 4) Metric measurements (only lead metrics used in this scenario).
    if (/FROM leads/i.test(sql)) {
      const metrics = seed.metrics[params[0]] || {};
      const key = /temperature = 'hot'/i.test(sql) ? "hot_leads" : "new_leads";
      return { rows: [{ value: metrics[key] == null ? 0 : metrics[key] }] };
    }

    // 5) Trend lookup (latest earlier snapshot for one goal).
    if (/FROM goal_snapshots/i.test(sql) && /current_value/i.test(sql) && /LIMIT 1/i.test(sql)) {
      const goalId = params[0];
      const prior = state.snapshots
        .filter((s) => s.goal_id === goalId && s.snapshot_date < today)
        .sort((a, b) => (a.snapshot_date < b.snapshot_date ? 1 : -1))[0];
      return { rows: prior ? [{ current_value: prior.current_value }] : [] };
    }

    // 6) Today's snapshot upsert.
    if (/INSERT INTO goal_snapshots/i.test(sql)) {
      const [goal_id, brand_id, snapshot_date, current_value, target_value, pct, proj] = params;
      const existing = state.snapshots.find(
        (s) => s.goal_id === goal_id && s.snapshot_date === snapshot_date,
      );
      const row = {
        goal_id,
        brand_id,
        snapshot_date,
        current_value,
        target_value,
        percent_to_goal: pct,
        projected_eom: proj,
      };
      if (existing) Object.assign(existing, row);
      else state.snapshots.push(row);
      return { rowCount: 1, rows: [] };
    }

    // 7) The per-(goal, kind, day) alert claim — first tick wins, rest skip.
    if (/INSERT INTO goal_alert_log/i.test(sql)) {
      const key = `${params[0]}:${params[1]}:${today}`;
      if (state.alertLog.has(key)) return { rowCount: 0, rows: [] };
      state.alertLog.add(key);
      return { rowCount: 1, rows: [] };
    }

    // 8) Owner lookup for the voice event (defaults => voice enabled).
    if (/FROM users/i.test(sql)) {
      return { rows: [{ first_name: "Sam", voice_settings: null }] };
    }

    // 9) Voice notification insert (dedup on user + dedup_key).
    if (/INSERT INTO echo_voice_notifications/i.test(sql)) {
      const [userId, brandId, eventType, , , payload, dedupKey] = params;
      const key = `${userId}:${dedupKey}`;
      if (dedupKey != null && state.voiceDedup.has(key)) return { rows: [] };
      state.voiceDedup.add(key);
      state.voiceRows.push({
        userId,
        brandId,
        eventType,
        payload: payload == null ? null : JSON.parse(payload),
      });
      return { rows: [{ notification_id: `n${state.voiceRows.length}` }] };
    }

    return { rows: [] };
  }

  return { query, state };
}

test("runDailyGoalTracking: swings alert, demo brands stay silent, dedup holds", async () => {
  // Two consecutive days of data:
  //  - g1 (Acme, new_leads/100): yesterday 100% -> today 130% (=> exceeding
  //    status AND a +30pt swing_up on the SAME goal, same day).
  //  - g2 (Acme, hot_leads/100): yesterday 40% -> today 10% (=> -30pt swing_down).
  //  - g3 belongs to a DEMO brand with a huge jump — must never alert.
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const fake = makeGoalSweepDb({
    brands: [
      { brand_id: "b1", brand_name: "Acme", user_id: "u1", is_demo: false },
      { brand_id: "bdemo", brand_name: "Demo Co", user_id: "u1", is_demo: true },
    ],
    goals: [
      { goal_id: "g1", brand_id: "b1", metric_key: "new_leads", category: "lead", label: "New Leads", target_value: 100, sort_order: 0, status: "active" },
      { goal_id: "g2", brand_id: "b1", metric_key: "hot_leads", category: "lead", label: "Hot Leads", target_value: 100, sort_order: 1, status: "active" },
      { goal_id: "g3", brand_id: "bdemo", metric_key: "new_leads", category: "lead", label: "New Leads", target_value: 100, sort_order: 0, status: "active" },
    ],
    metrics: {
      b1: { new_leads: 130, hot_leads: 10 },
      bdemo: { new_leads: 500 },
    },
    snapshots: [
      { goal_id: "g1", brand_id: "b1", snapshot_date: yesterday, current_value: 100, target_value: 100, percent_to_goal: 100 },
      { goal_id: "g2", brand_id: "b1", snapshot_date: yesterday, current_value: 40, target_value: 100, percent_to_goal: 40 },
      { goal_id: "g3", brand_id: "bdemo", snapshot_date: yesterday, current_value: 5, target_value: 100, percent_to_goal: 5 },
    ],
  });

  const pushCalls = [];
  const origQuery = db.query;
  const origPush = pushController.sendPushToUser;
  const origMobile = mobilePushController.sendToUser;
  db.query = fake.query;
  pushController.sendPushToUser = async (userId, payload) => {
    pushCalls.push({ userId, ...payload.data });
  };
  mobilePushController.sendToUser = async () => {};

  try {
    const first = await goalAlerts.runDailyGoalTracking();

    // Only the real brand is swept; the demo brand is excluded in SQL.
    assert.ok(fake.state.sawDemoFilter, "brand discovery SQL must filter is_demo = false");
    assert.strictEqual(first.brandsProcessed, 1);

    const kindsFor = (goalId) =>
      pushCalls.filter((c) => c.goalId === goalId).map((c) => c.kind).sort();

    // g1 fires BOTH a status alert and a momentum alert on the same day.
    assert.deepStrictEqual(kindsFor("g1"), ["exceeding", "swing_up"]);
    // g2's -30pt day-over-day drop fires swing_down.
    assert.ok(kindsFor("g2").includes("swing_down"), `g2 kinds: ${kindsFor("g2")}`);
    // The demo brand's goal never alerts anywhere (push, voice, or claim log).
    assert.deepStrictEqual(kindsFor("g3"), []);
    assert.ok(fake.state.voiceRows.every((v) => v.brandId !== "bdemo"));
    assert.ok([...fake.state.alertLog].every((k) => !k.startsWith("g3:")));

    // Voice events mirror the push alerts (voice enabled by default settings).
    const voiceKinds = fake.state.voiceRows.map((v) => v.payload.kind).sort();
    assert.deepStrictEqual(voiceKinds, pushCalls.map((c) => c.kind).sort());
    assert.strictEqual(first.alertsSent, pushCalls.length);

    // Today's snapshot was written for both real goals with the new percents.
    const today = new Date().toISOString().slice(0, 10);
    const todayRows = fake.state.snapshots.filter((s) => s.snapshot_date === today);
    assert.deepStrictEqual(
      todayRows.map((s) => [s.goal_id, s.percent_to_goal]).sort(),
      [["g1", 130], ["g2", 10]],
    );

    // Second sweep the same day: same kinds derive again (prior read still
    // excludes today's snapshot), but every (goal, kind, day) is already
    // claimed — nothing is re-alerted.
    const before = pushCalls.length;
    const second = await goalAlerts.runDailyGoalTracking();
    assert.strictEqual(second.brandsProcessed, 1);
    assert.strictEqual(second.alertsSent, 0, "same-day rerun must dedup all alerts");
    assert.strictEqual(pushCalls.length, before, "no push may be re-sent on rerun");
  } finally {
    db.query = origQuery;
    pushController.sendPushToUser = origPush;
    mobilePushController.sendToUser = origMobile;
  }
});
