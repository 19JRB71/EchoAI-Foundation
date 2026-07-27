/**
 * Sage V2 Phase 1 tests.
 *
 * - companyContextForBrand: dark by default (flag off → "", zero behavior
 *   change); flag on + approved Truth → digest with the authoritative header;
 *   flag on + NO approved Truth → "" AND the per-brand flying-blind counter
 *   increments (once per cache window); drafts are never injected.
 * - withCompanyContext: appends the digest to a built system prompt; no-op
 *   when dark.
 * - buildWeeklyBriefingForBrand: no-op when the flag is off; atomic per
 *   (brand_id, iso_week) claim — the second build of the same week returns
 *   null and leaves ONE row; missing source reports are recorded honestly as
 *   available:false with the DRAFT empty copy, never fabricated.
 * - getWeeklyBriefing / getContextStats endpoints: foreign brand → 404;
 *   flags off → { enabled: false } so the client renders nothing.
 * - isoWeekOf: correct ISO week ids across year boundaries.
 */
const test = require("node:test");
const assert = require("node:assert");

require("./dbGuard");
const db = require("../config/db");
const {
  companyContextForBrand,
  withCompanyContext,
  _resetCacheForTests,
} = require("../utils/companyContext");
const {
  buildWeeklyBriefingForBrand,
  getWeeklyBriefing,
  getContextStats,
  isoWeekOf,
} = require("../controllers/sageBriefingController");

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

async function createUserAndBrand() {
  const email = `sage-v2-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const u = await db.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING user_id",
    [email, "test-not-a-real-hash"],
  );
  const userId = u.rows[0].user_id;
  const b = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, $2) RETURNING brand_id",
    [userId, "Sage V2 Test Brand"],
  );
  return { userId, brandId: b.rows[0].brand_id };
}

async function deleteUser(userId) {
  await db.query("DELETE FROM users WHERE user_id = $1", [userId]);
}

async function insertTruth(brandId, status, version = 1) {
  await db.query(
    `INSERT INTO company_truth_reports (brand_id, version, status, report)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [
      brandId,
      version,
      status,
      JSON.stringify({
        identity: "Acme Pole Barns — family-owned builder in Ohio.",
        pricing: "Barns start at $20k.",
        excludedCategories: ["Storage units"],
      }),
    ],
  );
}

async function flyingBlindCount(brandId) {
  const { rows } = await db.query(
    "SELECT flying_blind_count FROM sage_context_stats WHERE brand_id = $1",
    [brandId],
  );
  return rows.length ? Number(rows[0].flying_blind_count) : 0;
}

function withFlag(name, value, fn) {
  return async (...args) => {
    const prev = process.env[name];
    process.env[name] = value;
    try {
      return await fn(...args);
    } finally {
      if (prev === undefined) delete process.env[name];
      else process.env[name] = prev;
    }
  };
}

test("companyContext: flag off → empty string, no flying-blind count", async () => {
  const { userId, brandId } = await createUserAndBrand();
  try {
    _resetCacheForTests();
    delete process.env.SAGE_V2_CONTEXT;
    assert.strictEqual(await companyContextForBrand(brandId), "");
    assert.strictEqual(await flyingBlindCount(brandId), 0);
  } finally {
    await deleteUser(userId);
  }
});

test(
  "companyContext: flag on + approved Truth → digest; drafts never injected",
  withFlag("SAGE_V2_CONTEXT", "true", async () => {
    const { userId, brandId } = await createUserAndBrand();
    try {
      _resetCacheForTests();
      await insertTruth(brandId, "pending_approval", 1);
      assert.strictEqual(await companyContextForBrand(brandId), "", "pending draft must not inject");

      _resetCacheForTests();
      await insertTruth(brandId, "approved", 2);
      const ctx = await companyContextForBrand(brandId);
      assert.match(ctx, /^COMPANY TRUTH/);
      assert.match(ctx, /Acme Pole Barns/);
      assert.match(ctx, /Never offer \/ excluded: Storage units/);

      const sys = await withCompanyContext("You are Nova.", brandId);
      assert.match(sys, /^You are Nova\.\n\nCOMPANY TRUTH/);
    } finally {
      await deleteUser(userId);
    }
  }),
);

test(
  "companyContext: flag on + no Truth → empty + flying-blind increments once per cache window",
  withFlag("SAGE_V2_CONTEXT", "true", async () => {
    const { userId, brandId } = await createUserAndBrand();
    try {
      _resetCacheForTests();
      assert.strictEqual(await companyContextForBrand(brandId), "");
      // second call within the cache window must NOT double-count
      assert.strictEqual(await companyContextForBrand(brandId), "");
      // the increment is fire-and-forget; give it a beat
      await new Promise((r) => setTimeout(r, 100));
      assert.strictEqual(await flyingBlindCount(brandId), 1);
      assert.strictEqual(await withCompanyContext("Prompt.", brandId), "Prompt.");
    } finally {
      await deleteUser(userId);
    }
  }),
);

test("weekly briefing: flag off → no-op, no row", async () => {
  const { userId, brandId } = await createUserAndBrand();
  try {
    delete process.env.SAGE_V2_WEEKLY_BRIEFING;
    assert.strictEqual(await buildWeeklyBriefingForBrand({ brand_id: brandId }), null);
    const { rows } = await db.query(
      "SELECT 1 FROM sage_weekly_briefings WHERE brand_id = $1",
      [brandId],
    );
    assert.strictEqual(rows.length, 0);
  } finally {
    await deleteUser(userId);
  }
});

test(
  "weekly briefing: builds honestly from missing sources; per-week claim is atomic",
  withFlag("SAGE_V2_WEEKLY_BRIEFING", "true", async () => {
    const { userId, brandId } = await createUserAndBrand();
    try {
      const id = await buildWeeklyBriefingForBrand({ brand_id: brandId });
      assert.ok(id, "first build returns the briefing id");
      // same-week rebuild is refused by the (brand_id, iso_week) claim
      assert.strictEqual(await buildWeeklyBriefingForBrand({ brand_id: brandId }), null);

      const { rows } = await db.query(
        "SELECT * FROM sage_weekly_briefings WHERE brand_id = $1",
        [brandId],
      );
      assert.strictEqual(rows.length, 1, "exactly one row per brand per ISO week");
      const row = rows[0];
      assert.strictEqual(row.status, "ready");
      assert.strictEqual(row.iso_week, isoWeekOf().isoWeek);
      const sections = row.sections;
      assert.strictEqual(sections.length, 6);
      for (const s of sections) {
        assert.strictEqual(s.available, false, `${s.key} must be honestly unavailable`);
        assert.strictEqual(s.data, null, `${s.key} must not fabricate data`);
      }
      // empty-state copy is the DRAFT placeholder, present for every section
      assert.ok(sections.every((s) => typeof s.title === "string" && s.title.length > 0));
    } finally {
      await deleteUser(userId);
    }
  }),
);

test(
  "weekly briefing: aggregates real analytics rows when present",
  withFlag("SAGE_V2_WEEKLY_BRIEFING", "true", async () => {
    const { userId, brandId } = await createUserAndBrand();
    try {
      const monday = isoWeekOf().monday;
      await db.query(
        `INSERT INTO analytics (brand_id, week_date, total_spend, total_leads,
                                cost_per_lead, conversions, return_on_ad_spend)
         VALUES ($1, $2, 500, 25, 20, 5, 3.2)`,
        [brandId, monday],
      );
      await buildWeeklyBriefingForBrand({ brand_id: brandId });
      const { rows } = await db.query(
        "SELECT sections, sources FROM sage_weekly_briefings WHERE brand_id = $1",
        [brandId],
      );
      const perf = rows[0].sections.find((s) => s.key === "performance");
      assert.strictEqual(perf.available, true);
      assert.strictEqual(perf.data.totalSpend, 500);
      assert.strictEqual(perf.data.totalLeads, 25);
      assert.strictEqual(rows[0].sources.performance, true);
      assert.strictEqual(rows[0].sources.roi, false);
    } finally {
      await deleteUser(userId);
    }
  }),
);

test(
  "weekly briefing: stale (older-than-week) source rows are honestly excluded",
  withFlag("SAGE_V2_WEEKLY_BRIEFING", "true", async () => {
    const { userId, brandId } = await createUserAndBrand();
    try {
      // Rows from ~3 weeks ago: real data, but NOT this week's output.
      const old = new Date(isoWeekOf().monday);
      old.setUTCDate(old.getUTCDate() - 21);
      await Promise.all([
        db.query(
          `INSERT INTO customer_intelligence (brand_id, week_date, trajectory_score)
           VALUES ($1, $2, 7)`,
          [brandId, old],
        ),
        db.query(
          `INSERT INTO roi_advanced_snapshots (brand_id, period_start, period_end, roi_percentage)
           VALUES ($1, $2, $2, 150)`,
          [brandId, old],
        ),
        db.query(
          `INSERT INTO competitor_ad_reports (brand_id, week_date, summary)
           VALUES ($1, $2, 'old summary')`,
          [brandId, old],
        ),
        db.query(
          `INSERT INTO feedback_reports (brand_id, analysis_period_start, analysis_period_end, created_at)
           VALUES ($1, $2, $2, $2)`,
          [brandId, old],
        ),
      ]);
      await buildWeeklyBriefingForBrand({ brand_id: brandId });
      const { rows } = await db.query(
        "SELECT sources FROM sage_weekly_briefings WHERE brand_id = $1",
        [brandId],
      );
      for (const key of ["intelligence", "roi", "competitors", "feedback"]) {
        assert.strictEqual(rows[0].sources[key], false, `${key} must be stale-excluded`);
      }
    } finally {
      await deleteUser(userId);
    }
  }),
);

test("endpoints: foreign brand → 404; flags off → enabled:false", async () => {
  const a = await createUserAndBrand();
  const b = await createUserAndBrand();
  try {
    delete process.env.SAGE_V2_WEEKLY_BRIEFING;
    delete process.env.SAGE_V2_CONTEXT;

    let res = mockRes();
    await getWeeklyBriefing({ user: { userId: a.userId }, query: { brandId: b.brandId } }, res);
    assert.strictEqual(res.statusCode, 404, "foreign brand is a 404");

    res = mockRes();
    await getWeeklyBriefing({ user: { userId: a.userId }, query: { brandId: a.brandId } }, res);
    assert.deepStrictEqual(res.body, { enabled: false, briefing: null });

    res = mockRes();
    await getContextStats({ user: { userId: a.userId }, query: { brandId: a.brandId } }, res);
    assert.strictEqual(res.body.enabled, false);
    assert.strictEqual(res.body.hasApprovedTruth, false);
  } finally {
    await deleteUser(a.userId);
    await deleteUser(b.userId);
  }
});

test(
  "getContextStats: reports approved truth + flying-blind count when enabled",
  withFlag("SAGE_V2_CONTEXT", "true", async () => {
    const { userId, brandId } = await createUserAndBrand();
    try {
      _resetCacheForTests();
      await companyContextForBrand(brandId); // records one flying-blind hit
      await new Promise((r) => setTimeout(r, 100));
      let res = mockRes();
      await getContextStats({ user: { userId }, query: { brandId } }, res);
      assert.strictEqual(res.body.enabled, true);
      assert.strictEqual(res.body.hasApprovedTruth, false);
      assert.strictEqual(Number(res.body.flyingBlindCount), 1);
      assert.ok(typeof res.body.copy.banner === "string" && res.body.copy.banner.length > 0);

      await insertTruth(brandId, "approved", 1);
      res = mockRes();
      await getContextStats({ user: { userId }, query: { brandId } }, res);
      assert.strictEqual(res.body.hasApprovedTruth, true);
    } finally {
      await deleteUser(userId);
    }
  }),
);

test("isoWeekOf: correct ISO week ids", () => {
  assert.strictEqual(isoWeekOf(new Date(Date.UTC(2026, 6, 17))).isoWeek, "2026-W29");
  // Jan 1 2027 is a Friday → ISO week 53 of 2026
  assert.strictEqual(isoWeekOf(new Date(Date.UTC(2027, 0, 1))).isoWeek, "2026-W53");
  assert.strictEqual(isoWeekOf(new Date(Date.UTC(2026, 0, 5))).isoWeek, "2026-W02");
});
