/**
 * Learning Engine tests.
 *
 * - recordSignal is truly fire-and-forget: bad input never throws, good input
 *   persists a trimmed signal row.
 * - learningContextForBrand: null when nothing learned; a compact prompt block
 *   (evidence-ordered) once learnings exist; inactive learnings excluded.
 * - studyBrand honors the minimum-signal threshold (no AI call, signals stay
 *   undistilled).
 * - runWeeklyLearningStudy: skips demo brands, guards each brand so one
 *   failure never stops the sweep.
 */
const test = require("node:test");
const assert = require("node:assert");

require("./dbGuard");
const db = require("../config/db");
const learningEngine = require("../utils/learningEngine");
const { recordSignal, learningContextForBrand, studyBrand } = learningEngine;

async function createUserAndBrand({ isDemo = false } = {}) {
  const email = `learning-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const u = await db.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING user_id",
    [email, "test-not-a-real-hash"]
  );
  const userId = u.rows[0].user_id;
  const b = await db.query(
    "INSERT INTO brands (user_id, brand_name, is_demo) VALUES ($1, $2, $3) RETURNING brand_id",
    [userId, "Learning Test Brand", isDemo]
  );
  return { userId, brandId: b.rows[0].brand_id };
}

async function cleanup(userId) {
  await db.query("DELETE FROM users WHERE user_id = $1", [userId]);
}

// ---------------------------------------------------------------------------
// recordSignal
// ---------------------------------------------------------------------------

test("recordSignal persists a trimmed signal row", async () => {
  const { userId, brandId } = await createUserAndBrand();
  try {
    await recordSignal({
      brandId,
      userId,
      source: "autopilot",
      itemType: "post",
      platform: "facebook",
      action: "revise",
      instruction: "  shorter please  ".padEnd(600, "x"),
      content: "line one\n\nline   two " + "y".repeat(400),
    });
    const { rows } = await db.query(
      "SELECT * FROM echo_learning_signals WHERE brand_id = $1",
      [brandId]
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].action, "revise");
    assert.ok(rows[0].instruction.length <= 500, "instruction capped at 500");
    assert.ok(rows[0].content_excerpt.length <= 300, "content capped at 300");
    assert.ok(!/\n/.test(rows[0].content_excerpt), "content whitespace collapsed");
    assert.strictEqual(rows[0].distilled_at, null);
  } finally {
    await cleanup(userId);
  }
});

test("recordSignal never throws on garbage input", async () => {
  // Violates NOT NULL + CHECK constraints — must swallow, not throw.
  await recordSignal({ brandId: null, userId: null, source: "nope", itemType: "post", action: "approve" });
  await recordSignal({});
});

// ---------------------------------------------------------------------------
// learningContextForBrand
// ---------------------------------------------------------------------------

test("learningContextForBrand: null with nothing learned, block once learned, inactive excluded", async () => {
  const { userId, brandId } = await createUserAndBrand();
  try {
    assert.strictEqual(await learningContextForBrand(brandId), null);
    assert.strictEqual(await learningContextForBrand(null), null);

    await db.query(
      `INSERT INTO echo_learnings (brand_id, user_id, insight, category, evidence_count)
       VALUES ($1, $2, 'Keep posts under 3 sentences', 'content_preference', 5),
              ($1, $2, 'Never use emojis', 'content_preference', 2)`,
      [brandId, userId]
    );
    const block = await learningContextForBrand(brandId);
    assert.ok(block.includes("Keep posts under 3 sentences"));
    assert.ok(block.includes("Never use emojis"));
    assert.ok(
      block.indexOf("Keep posts") < block.indexOf("Never use emojis"),
      "higher evidence first"
    );

    await db.query(
      "UPDATE echo_learnings SET active = FALSE WHERE brand_id = $1",
      [brandId]
    );
    assert.strictEqual(await learningContextForBrand(brandId), null);
  } finally {
    await cleanup(userId);
  }
});

// ---------------------------------------------------------------------------
// studyBrand threshold
// ---------------------------------------------------------------------------

test("studyBrand skips honestly below the signal threshold (signals stay undistilled)", async () => {
  const { userId, brandId } = await createUserAndBrand();
  try {
    for (let i = 0; i < 3; i += 1) {
      await recordSignal({
        brandId,
        userId,
        source: "autopilot",
        itemType: "post",
        platform: "facebook",
        action: "approve",
        content: `post ${i}`,
      });
    }
    // 3 < MIN_SIGNALS_TO_STUDY(4): returns before any AI call.
    const result = await studyBrand({ brand_id: brandId, user_id: userId, brand_name: "T" });
    assert.strictEqual(result.studied, false);
    const { rows } = await db.query(
      "SELECT COUNT(*)::int AS n FROM echo_learning_signals WHERE brand_id = $1 AND distilled_at IS NULL",
      [brandId]
    );
    assert.strictEqual(rows[0].n, 3, "signals stay undistilled for next week");
  } finally {
    await cleanup(userId);
  }
});

// ---------------------------------------------------------------------------
// runWeeklyLearningStudy sweep guard + demo exclusion
// ---------------------------------------------------------------------------

test("runWeeklyLearningStudy guards each brand and excludes demo brands", async () => {
  const real1 = await createUserAndBrand();
  const real2 = await createUserAndBrand();
  const demo = await createUserAndBrand({ isDemo: true });
  const originalStudy = learningEngine.studyBrand;
  try {
    for (const { userId, brandId } of [real1, real2, demo]) {
      await recordSignal({
        brandId,
        userId,
        source: "autopilot",
        itemType: "post",
        action: "decline",
        content: "x",
      });
    }
    const studied = [];
    learningEngine.studyBrand = async (brand) => {
      studied.push(String(brand.brand_id));
      if (String(brand.brand_id) === String(real1.brandId)) {
        throw new Error("simulated AI outage");
      }
      return { studied: true, learnings: 1, questions: 0 };
    };
    await learningEngine.runWeeklyLearningStudy();

    assert.ok(studied.includes(String(real1.brandId)), "real brand 1 studied");
    assert.ok(studied.includes(String(real2.brandId)), "one failure never stops the sweep");
    assert.ok(!studied.includes(String(demo.brandId)), "demo brands excluded");
  } finally {
    learningEngine.studyBrand = originalStudy;
    await cleanup(real1.userId);
    await cleanup(real2.userId);
    await cleanup(demo.userId);
  }
});
