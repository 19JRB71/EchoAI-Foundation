/**
 * Vision — Visual Intelligence Agent tests.
 *
 * - parseKnowledge validates AI output honestly: rejects empty/malformed
 *   responses, clamps confidence, never fabricates content.
 * - knowledgeToGuidanceText builds Forge guidance from a knowledge row and
 *   always carries the never-copy rule.
 * - getGuidanceForImageRequest is fail-open: null when no knowledge exists;
 *   a real consult logs a vision_guidance_log row.
 * - studyBrand records a failed run honestly when the AI is unavailable
 *   (no knowledge row is written, sources counts are real).
 */
const test = require("node:test");
const assert = require("node:assert");

require("./dbGuard");
const db = require("../config/db");
const visionEngine = require("../utils/visionEngine");
const {
  parseKnowledge,
  knowledgeToGuidanceText,
  getGuidanceForImageRequest,
  studyBrand,
} = visionEngine;

async function createUserAndBrand({ isDemo = false } = {}) {
  const email = `vision-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const u = await db.query(
    "INSERT INTO users (email, password_hash, industry) VALUES ($1, $2, $3) RETURNING user_id",
    [email, "test-not-a-real-hash", "pole barn construction"]
  );
  const userId = u.rows[0].user_id;
  const b = await db.query(
    "INSERT INTO brands (user_id, brand_name, is_demo) VALUES ($1, $2, $3) RETURNING brand_id",
    [userId, "Vision Test Brand", isDemo]
  );
  return { userId, brandId: b.rows[0].brand_id };
}

async function cleanup(userId) {
  await db.query("DELETE FROM users WHERE user_id = $1", [userId]);
}

// ---------------------------------------------------------------------------
// parseKnowledge
// ---------------------------------------------------------------------------
test("parseKnowledge accepts a valid response and clamps confidence", () => {
  const out = parseKnowledge(
    JSON.stringify({
      structural_standards: ["gable roofs at 4/12 pitch", 42],
      composition: [],
      lighting: ["golden hour"],
      color_palettes: [],
      seasonal_trends: [],
      customer_emotions: [],
      market_observations: [],
      avoid: ["clip-art styles"],
      summary: "Learned the basics.",
      confidence: 250,
    })
  );
  assert.strictEqual(out.confidence, 100);
  assert.deepStrictEqual(out.lighting, ["golden hour"]);
  // non-string array entries are coerced to strings, empties dropped
  assert.ok(out.structural_standards.includes("42"));
  assert.strictEqual(out.summary, "Learned the basics.");
});

test("parseKnowledge rejects a response with no knowledge content", () => {
  assert.throws(
    () =>
      parseKnowledge(
        JSON.stringify({
          structural_standards: [],
          summary: "nothing",
          confidence: 10,
        })
      ),
    /empty knowledge base/
  );
});

test("parseKnowledge rejects non-JSON and missing summary", () => {
  assert.throws(() => parseKnowledge("no json here"), /no JSON object/);
  assert.throws(
    () =>
      parseKnowledge(
        JSON.stringify({ lighting: ["soft"], summary: "", confidence: 5 })
      ),
    /missing the summary/
  );
});

// ---------------------------------------------------------------------------
// knowledgeToGuidanceText
// ---------------------------------------------------------------------------
test("knowledgeToGuidanceText includes sections and the never-copy rule", () => {
  const text = knowledgeToGuidanceText({
    industry: "pole barn construction",
    version: 3,
    confidence: 62,
    knowledge: {
      structural_standards: ["correct 6x6 post spacing"],
      composition: ["three-quarter exterior angle"],
      lighting: [],
      color_palettes: ["earth tones"],
      seasonal_trends: [],
      customer_emotions: ["pride of ownership"],
      avoid: ["cartoonish rendering"],
    },
  });
  assert.match(text, /pole barn construction/);
  assert.match(text, /knowledge v3, confidence 62\/100/);
  assert.match(text, /correct 6x6 post spacing/);
  assert.match(text, /never copy any company's artwork/);
  assert.doesNotMatch(text, /Lighting:/); // empty sections omitted
});

// ---------------------------------------------------------------------------
// getGuidanceForImageRequest (fail-open + honest logging)
// ---------------------------------------------------------------------------
test("getGuidanceForImageRequest returns null when Vision has not studied the brand", async () => {
  const { userId, brandId } = await createUserAndBrand();
  try {
    const out = await getGuidanceForImageRequest({
      brandId,
      requester: "forge_image_studio",
      requestSummary: "test image",
    });
    assert.strictEqual(out, null);
    const logs = await db.query(
      "SELECT COUNT(*)::int AS n FROM vision_guidance_log WHERE brand_id = $1",
      [brandId]
    );
    assert.strictEqual(logs.rows[0].n, 0, "no consult logged when there is no knowledge");
  } finally {
    await cleanup(userId);
  }
});

test("getGuidanceForImageRequest returns guidance and logs the consult", async () => {
  const { userId, brandId } = await createUserAndBrand();
  try {
    await db.query(
      `INSERT INTO vision_knowledge (brand_id, industry, knowledge, confidence, version, sources_studied, last_studied_at)
       VALUES ($1, 'roofing', $2::jsonb, 55, 2, '{}'::jsonb, NOW())`,
      [brandId, JSON.stringify({ structural_standards: ["real shingle overlap patterns"] })]
    );
    const out = await getGuidanceForImageRequest({
      brandId,
      requester: "forge_ad_studio",
      requestSummary: "spring roofing promo",
    });
    assert.ok(out && out.text.includes("real shingle overlap patterns"));
    assert.strictEqual(out.version, 2);
    // consult log insert is fire-and-forget; give it a beat
    await new Promise((r) => setTimeout(r, 150));
    const logs = await db.query(
      "SELECT requester, knowledge_version FROM vision_guidance_log WHERE brand_id = $1",
      [brandId]
    );
    assert.strictEqual(logs.rows.length, 1);
    assert.strictEqual(logs.rows[0].requester, "forge_ad_studio");
    assert.strictEqual(logs.rows[0].knowledge_version, 2);
  } finally {
    await cleanup(userId);
  }
});

test("getGuidanceForImageRequest fails open (null) on a query error", async () => {
  const out = await getGuidanceForImageRequest({
    brandId: "not-a-uuid",
    requester: "forge_image_studio",
    requestSummary: "x",
  });
  assert.strictEqual(out, null);
});

// ---------------------------------------------------------------------------
// studyBrand — per-brand claim (no overlapping studies)
// ---------------------------------------------------------------------------
test("studyBrand skips when another study is already running for the brand", async () => {
  const { userId, brandId } = await createUserAndBrand();
  try {
    await db.query(
      "INSERT INTO vision_study_runs (brand_id, trigger, status) VALUES ($1, 'manual', 'running')",
      [brandId]
    );
    const out = await studyBrand(
      { brand_id: brandId, brand_name: "Vision Test Brand", industry: "roofing" },
      { trigger: "scheduled" }
    );
    assert.strictEqual(out.status, "skipped");
    const runs = await db.query(
      "SELECT COUNT(*)::int AS n FROM vision_study_runs WHERE brand_id = $1",
      [brandId]
    );
    assert.strictEqual(runs.rows[0].n, 1, "no second run row created");
  } finally {
    await cleanup(userId);
  }
});

test("studyBrand reclaims a dead (stale) running claim", async (t) => {
  const { userId, brandId } = await createUserAndBrand();
  try {
    await db.query(
      `INSERT INTO vision_study_runs (brand_id, trigger, status, started_at)
       VALUES ($1, 'manual', 'running', NOW() - INTERVAL '20 minutes')`,
      [brandId]
    );
    // Stub the AI so no real call is made — the point of this test is only
    // that the stale claim is NOT refused (the run proceeds and finalizes).
    const anthropicConfig = require("../config/anthropic");
    const original = anthropicConfig.createMessage;
    anthropicConfig.createMessage = async () => {
      throw new Error("forced test failure");
    };
    t.after(() => {
      anthropicConfig.createMessage = original;
      delete require.cache[require.resolve("../utils/visionEngine")];
      require("../utils/visionEngine");
    });
    delete require.cache[require.resolve("../utils/visionEngine")];
    const freshEngine = require("../utils/visionEngine");

    const out = await freshEngine.studyBrand(
      { brand_id: brandId, brand_name: "Vision Test Brand", industry: "roofing" },
      { trigger: "scheduled" }
    );
    assert.notStrictEqual(out.status, "skipped");
  } finally {
    await cleanup(userId);
  }
});

// ---------------------------------------------------------------------------
// studyBrand — honest failure when AI is unavailable
// ---------------------------------------------------------------------------
test("studyBrand records a failed run and writes no knowledge when the AI call fails", async (t) => {
  const { userId, brandId } = await createUserAndBrand();
  try {
    // ANTHROPIC_API_KEY may or may not be set in the test env; force the AI
    // call to fail deterministically by stubbing the anthropic config module.
    const anthropicConfig = require("../config/anthropic");
    const original = anthropicConfig.createMessage;
    anthropicConfig.createMessage = async () => {
      throw new Error("forced test failure");
    };
    t.after(() => {
      anthropicConfig.createMessage = original;
    });
    // Re-require a fresh copy so the stub is picked up.
    delete require.cache[require.resolve("../utils/visionEngine")];
    const freshEngine = require("../utils/visionEngine");

    const out = await freshEngine.studyBrand(
      { brand_id: brandId, brand_name: "Vision Test Brand", industry: "roofing" },
      { trigger: "manual" }
    );
    assert.strictEqual(out.status, "failed");

    const runs = await db.query(
      "SELECT status, trigger, sources, error FROM vision_study_runs WHERE brand_id = $1",
      [brandId]
    );
    assert.strictEqual(runs.rows.length, 1);
    assert.strictEqual(runs.rows[0].status, "failed");
    assert.strictEqual(runs.rows[0].trigger, "manual");
    assert.ok(runs.rows[0].error, "failure reason recorded honestly");
    // Real source counts were still recorded (0 rows each for a fresh brand).
    const sources = runs.rows[0].sources;
    assert.strictEqual(sources.competitor_facebook_ads, 0);
    assert.strictEqual(sources.brand_image_library, 0);

    const knowledge = await db.query(
      "SELECT COUNT(*)::int AS n FROM vision_knowledge WHERE brand_id = $1",
      [brandId]
    );
    assert.strictEqual(knowledge.rows[0].n, 0, "no knowledge fabricated on failure");

    delete require.cache[require.resolve("../utils/visionEngine")];
    require("../utils/visionEngine");
  } finally {
    await cleanup(userId);
  }
});
