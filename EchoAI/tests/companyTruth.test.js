/**
 * Company Truth tests (Phase 1 of the chain-of-command spec).
 *
 * - validateCompanyReport: strict contract — missing sections / empty
 *   classification / non-object all throw aiInvalid; arrays clean up;
 *   missingInformation may be empty.
 * - gatherCompanyData: fail-honest — a broken probe records the source as
 *   unavailable with the reason, never fabricated, never throws.
 * - Lifecycle: generate claims the one-generating slot (double-generate →
 *   409), success promotes the claim to pending_approval and replaces a
 *   prior pending draft; AI failure deletes the claim (no half-built rows)
 *   and maps to 502.
 * - Approve: atomic row-count flip; nothing pending → 409; a new approval
 *   supersedes the old Truth in the same transaction (one approved per brand).
 * - Edits: only valid sections, only on the pending draft; edit_log grows.
 * - Ownership: a foreign brand is always a 404.
 * - getApprovedCompanyTruth: null until approved; never returns drafts.
 */
const test = require("node:test");
const assert = require("node:assert");

require("./dbGuard");
const db = require("../config/db");
const anthropicModule = require("../config/anthropic");
const { validateCompanyReport, gatherCompanyData, SECTION_KEYS } = require("../utils/companyTruth");
const controller = require("../controllers/companyTruthController");

const originalCreate = anthropicModule.anthropic.messages.create;
function stubAi(impl) {
  anthropicModule.anthropic.messages.create = async (params) => impl(params);
}
function restoreAi() {
  anthropicModule.anthropic.messages.create = originalCreate;
}

function goodSections() {
  const sections = {};
  for (const key of SECTION_KEYS) sections[key] = `Real content for ${key}.`;
  sections.excludedCategories = ["Storage buildings — we build pole barns, not storage units"];
  sections.missingInformation = ["Pricing details not provided"];
  return sections;
}
function aiReport() {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          plainSummary: "Here is what we understand about your company.",
          sections: goodSections(),
        }),
      },
    ],
  };
}

function mockRes() {
  const res = {
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
  return res;
}

async function createUserBrand() {
  const email = `truth-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const u = await db.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING user_id",
    [email, "test-not-a-real-hash"],
  );
  const userId = u.rows[0].user_id;
  const b = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, $2) RETURNING brand_id",
    [userId, "Truth Test Brand"],
  );
  return { userId, brandId: b.rows[0].brand_id };
}

async function cleanup(brandId) {
  await db.query("DELETE FROM company_truth_reports WHERE brand_id = $1", [brandId]);
}

// --- validateCompanyReport ---------------------------------------------------

test("validateCompanyReport: accepts a complete report and cleans arrays", () => {
  const sections = goodSections();
  sections.terminology = ["  post-frame  ", "", 42, "pole barn"];
  const out = validateCompanyReport({ plainSummary: " Summary. ", sections });
  assert.strictEqual(out.plainSummary, "Summary.");
  assert.deepStrictEqual(out.sections.terminology, ["post-frame", "pole barn"]);
  for (const key of SECTION_KEYS) assert.ok(key in out.sections);
});

test("validateCompanyReport: rejects missing/empty sections with aiInvalid", () => {
  for (const bad of [
    null,
    { plainSummary: "", sections: goodSections() },
    { plainSummary: "ok", sections: null },
  ]) {
    assert.throws(() => validateCompanyReport(bad), (e) => e.aiInvalid === true);
  }
  const noCls = { plainSummary: "ok", sections: { ...goodSections(), classification: "" } };
  assert.throws(() => validateCompanyReport(noCls), (e) => e.aiInvalid === true);
  const hole = { plainSummary: "ok", sections: goodSections() };
  delete hole.sections.pricing;
  assert.throws(() => validateCompanyReport(hole), (e) => e.aiInvalid === true);
});

test("validateCompanyReport: missingInformation may be empty; other sections may not", () => {
  const ok = { plainSummary: "ok", sections: { ...goodSections(), missingInformation: [] } };
  const out = validateCompanyReport(ok);
  assert.deepStrictEqual(out.sections.missingInformation, []);
});

// --- gatherCompanyData: fail-honest -------------------------------------------

test("gatherCompanyData: broken probe recorded as unavailable, never throws", async () => {
  const { userId, brandId } = await createUserBrand();
  const brand = { brand_id: brandId, user_id: userId, brand_name: "Truth Test Brand" };
  const originalQuery = db.query;
  try {
    db.query = async (text, params) => {
      if (/FROM reviews/.test(text)) throw new Error("reviews table exploded");
      return originalQuery.call(db, text, params);
    };
    const gathered = await gatherCompanyData(brand);
    const reviews = gathered.sources.find((s) => s.name === "reviews");
    assert.strictEqual(reviews.available, false);
    assert.match(reviews.error, /exploded/);
    assert.deepStrictEqual(gathered.summary.reviews, {
      unavailable: true,
      error: reviews.error,
    });
    const owner = gathered.sources.find((s) => s.name === "owner_profile");
    assert.strictEqual(owner.available, true);
  } finally {
    db.query = originalQuery;
    await cleanup(brandId);
  }
});

// --- lifecycle -----------------------------------------------------------------

test("lifecycle: generate → pending; approve atomic; new approval supersedes", async () => {
  const { userId, brandId } = await createUserBrand();
  try {
    stubAi(aiReport);

    // Generate v1.
    let res = mockRes();
    await controller.generate({ user: { userId }, body: { brandId } }, res);
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.pending.status, "pending_approval");
    assert.strictEqual(res.body.pending.version, 1);
    assert.ok(Array.isArray(res.body.pending.sources));

    // Nothing approved yet — Layer 2 consumer must see null.
    assert.strictEqual(await controller.getApprovedCompanyTruth(brandId), null);

    // Approve v1.
    res = mockRes();
    await controller.approve({ user: { userId }, body: { brandId } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.approved.status, "approved");

    // Approve again with nothing pending → 409 (atomic row-count branch).
    res = mockRes();
    await controller.approve({ user: { userId }, body: { brandId } }, res);
    assert.strictEqual(res.statusCode, 409);

    const truth = await controller.getApprovedCompanyTruth(brandId);
    assert.strictEqual(truth.version, 1);

    // Generate v2 and approve → v1 superseded, only one approved row.
    res = mockRes();
    await controller.generate({ user: { userId }, body: { brandId } }, res);
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.pending.version, 2);
    res = mockRes();
    await controller.approve({ user: { userId }, body: { brandId } }, res);
    assert.strictEqual(res.statusCode, 200);
    const rows = await db.query(
      "SELECT version, status FROM company_truth_reports WHERE brand_id = $1 ORDER BY version",
      [brandId],
    );
    assert.deepStrictEqual(
      rows.rows.map((r) => `${r.version}:${r.status}`),
      ["1:superseded", "2:approved"],
    );
  } finally {
    restoreAi();
    await cleanup(brandId);
  }
});

test("generate: AI failure deletes the claim row and maps to 502", async () => {
  const { userId, brandId } = await createUserBrand();
  try {
    stubAi(() => {
      const err = new Error("upstream down");
      err.status = 500;
      throw err;
    });
    const res = mockRes();
    await controller.generate({ user: { userId }, body: { brandId } }, res);
    assert.strictEqual(res.statusCode, 502);
    const rows = await db.query(
      "SELECT 1 FROM company_truth_reports WHERE brand_id = $1",
      [brandId],
    );
    assert.strictEqual(rows.rows.length, 0);
  } finally {
    restoreAi();
    await cleanup(brandId);
  }
});

test("generate: concurrent claim blocked by the one-generating index → 409", async () => {
  const { userId, brandId } = await createUserBrand();
  try {
    // Simulate an in-flight run by holding the claim row.
    await db.query(
      "INSERT INTO company_truth_reports (brand_id, version, status) VALUES ($1, 1, 'generating')",
      [brandId],
    );
    stubAi(aiReport);
    const res = mockRes();
    await controller.generate({ user: { userId }, body: { brandId } }, res);
    assert.strictEqual(res.statusCode, 409);
  } finally {
    restoreAi();
    await cleanup(brandId);
  }
});

test("generate: a stale (dead) generating claim is rescued, not a permanent 409", async () => {
  const { userId, brandId } = await createUserBrand();
  try {
    // A claim whose process died mid-run (deploy/crash): old created_at,
    // cleanup never ran. Without the rescue every generate would 409 forever.
    await db.query(
      `INSERT INTO company_truth_reports (brand_id, version, status, created_at)
       VALUES ($1, 1, 'generating', NOW() - INTERVAL '11 minutes')`,
      [brandId],
    );
    stubAi(aiReport);
    const res = mockRes();
    await controller.generate({ user: { userId }, body: { brandId } }, res);
    assert.strictEqual(res.statusCode, 201);
    assert.ok(res.body.pending);
    // The dead claim is gone; only the fresh pending report remains.
    const { rows } = await db.query(
      "SELECT status FROM company_truth_reports WHERE brand_id = $1",
      [brandId],
    );
    assert.deepStrictEqual(
      rows.map((r) => r.status),
      ["pending_approval"],
    );
  } finally {
    restoreAi();
    await cleanup(brandId);
  }
});

test("getState: a stale generating claim does not report generating=true", async () => {
  const { userId, brandId } = await createUserBrand();
  try {
    await db.query(
      `INSERT INTO company_truth_reports (brand_id, version, status, created_at)
       VALUES ($1, 1, 'generating', NOW() - INTERVAL '11 minutes')`,
      [brandId],
    );
    const res = mockRes();
    await controller.getState({ user: { userId }, query: { brandId } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.generating, false);

    // A fresh claim (in-flight run) still reports generating=true.
    await db.query(
      `UPDATE company_truth_reports SET created_at = NOW() WHERE brand_id = $1`,
      [brandId],
    );
    const res2 = mockRes();
    await controller.getState({ user: { userId }, query: { brandId } }, res2);
    assert.strictEqual(res2.body.generating, true);
  } finally {
    await cleanup(brandId);
  }
});

test("generate: replaces a prior pending draft and consumes its research request", async () => {
  const { userId, brandId } = await createUserBrand();
  try {
    stubAi(aiReport);
    let res = mockRes();
    await controller.generate({ user: { userId }, body: { brandId } }, res);
    assert.strictEqual(res.statusCode, 201);

    // Owner requests more research on the pending draft.
    res = mockRes();
    await controller.requestResearch(
      { user: { userId }, body: { brandId, note: "We build pole barns, not storage units." } },
      res,
    );
    assert.strictEqual(res.statusCode, 200);

    // Regeneration must carry the note into the prompt and replace the draft.
    let sawNote = false;
    stubAi((params) => {
      const text = JSON.stringify(params.messages);
      if (/pole barns, not storage units/.test(text)) sawNote = true;
      return aiReport();
    });
    res = mockRes();
    await controller.generate({ user: { userId }, body: { brandId } }, res);
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(sawNote, true);
    assert.strictEqual(res.body.pending.researchRequest, null);

    const rows = await db.query(
      "SELECT status FROM company_truth_reports WHERE brand_id = $1",
      [brandId],
    );
    assert.strictEqual(rows.rows.length, 1);
    assert.strictEqual(rows.rows[0].status, "pending_approval");
  } finally {
    restoreAi();
    await cleanup(brandId);
  }
});

// --- edits ----------------------------------------------------------------------

test("editSection: valid section on pending draft only; edit_log grows", async () => {
  const { userId, brandId } = await createUserBrand();
  try {
    stubAi(aiReport);
    let res = mockRes();
    await controller.generate({ user: { userId }, body: { brandId } }, res);
    assert.strictEqual(res.statusCode, 201);

    // Unknown section → 400.
    res = mockRes();
    await controller.editSection(
      { user: { userId }, body: { brandId, section: "hacks", content: "x" } },
      res,
    );
    assert.strictEqual(res.statusCode, 400);

    // Empty content on a required section → 400.
    res = mockRes();
    await controller.editSection(
      { user: { userId }, body: { brandId, section: "pricing", content: "   " } },
      res,
    );
    assert.strictEqual(res.statusCode, 400);

    // Real edit sticks and is logged.
    res = mockRes();
    await controller.editSection(
      { user: { userId }, body: { brandId, section: "classification", content: "Post-frame (pole barn) construction company" } },
      res,
    );
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(
      res.body.pending.report.classification,
      "Post-frame (pole barn) construction company",
    );
    assert.strictEqual(res.body.pending.editLog.length, 1);
    assert.strictEqual(res.body.pending.editLog[0].section, "classification");

    // Approve, then editing (no pending) → 409.
    res = mockRes();
    await controller.approve({ user: { userId }, body: { brandId } }, res);
    assert.strictEqual(res.statusCode, 200);
    res = mockRes();
    await controller.editSection(
      { user: { userId }, body: { brandId, section: "pricing", content: "new" } },
      res,
    );
    assert.strictEqual(res.statusCode, 409);
  } finally {
    restoreAi();
    await cleanup(brandId);
  }
});

// --- ownership -------------------------------------------------------------------

test("ownership: foreign brand is a 404 on every endpoint", async () => {
  const a = await createUserBrand();
  const b = await createUserBrand();
  try {
    stubAi(aiReport);
    const attempts = [
      (res) => controller.getState({ user: { userId: b.userId }, query: { brandId: a.brandId } }, res),
      (res) => controller.generate({ user: { userId: b.userId }, body: { brandId: a.brandId } }, res),
      (res) => controller.approve({ user: { userId: b.userId }, body: { brandId: a.brandId } }, res),
      (res) =>
        controller.editSection(
          { user: { userId: b.userId }, body: { brandId: a.brandId, section: "pricing", content: "x" } },
          res,
        ),
      (res) =>
        controller.requestResearch(
          { user: { userId: b.userId }, body: { brandId: a.brandId, note: "x" } },
          res,
        ),
    ];
    for (const attempt of attempts) {
      const res = mockRes();
      await attempt(res);
      assert.strictEqual(res.statusCode, 404);
    }
  } finally {
    restoreAi();
    await cleanup(a.brandId);
    await cleanup(b.brandId);
  }
});
