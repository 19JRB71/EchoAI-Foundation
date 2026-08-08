/**
 * Prompt 011 — Corrective fix regressions.
 *
 * FIX 1: immutable version history survives user deletion attempts
 *   (approved_by ON DELETE RESTRICT, migration 139) + documented brand
 *   cascade behavior.
 * FIX 3: dedicated Company Truth approve-vs-regeneration race regressions,
 *   both interleavings, plus the system-retirement audit convention
 *   (review_note = 'superseded_by_regeneration', reviewed_by NULL).
 * Hardening A: strict standards-compliant provenance URL parsing.
 */
const test = require("node:test");
const assert = require("node:assert");

require("./dbGuard");
const db = require("../config/db");
const knowledge = require("../utils/brandKnowledge");
const ct = require("../controllers/companyTruthController");

const PROV = {
  sources: [{ source: "stated", basis: "Owner typed it in the profile editor." }],
  confidence: "high",
  conflict: false,
  alternatives: [],
};

async function createUser() {
  const email = `bkfix-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const { rows } = await db.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING user_id",
    [email, "test-not-a-real-hash"]
  );
  return rows[0].user_id;
}

async function createBrand(userId, name = "BK Fix Brand") {
  const { rows } = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, $2) RETURNING brand_id",
    [userId, name]
  );
  return rows[0].brand_id;
}

async function cleanup(userId) {
  await db.query("DELETE FROM brands WHERE user_id = $1", [userId]);
  await db.query("DELETE FROM users WHERE user_id = $1", [userId]);
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
}

// ---------------------------------------------------------------------------
// FIX 1A — deleting a user who approved knowledge history FAILS LOUDLY.
// ---------------------------------------------------------------------------
test("FIX1A: user deletion is blocked while approved knowledge history exists", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    await knowledge.ownerEditFields({
      brandId,
      userId,
      fields: [{ fieldKey: "tagline", value: "Immutable history survives." }],
    });
    const before = await db.query(
      "SELECT * FROM brand_knowledge_versions WHERE brand_id = $1 ORDER BY version_id",
      [brandId]
    );
    assert.equal(before.rows.length, 1);

    await assert.rejects(
      db.query("DELETE FROM users WHERE user_id = $1", [userId]),
      (err) => err.code === "23503", // foreign_key_violation — fails loudly
      "user deletion must be blocked by the approved_by RESTRICT FK"
    );

    const after = await db.query(
      "SELECT * FROM brand_knowledge_versions WHERE brand_id = $1 ORDER BY version_id",
      [brandId]
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(after.rows)),
      JSON.parse(JSON.stringify(before.rows)),
      "approved version rows must remain byte-identical"
    );
    const stillThere = await db.query("SELECT 1 FROM users WHERE user_id = $1", [userId]);
    assert.equal(stillThere.rows.length, 1, "user row must remain");
  } finally {
    await cleanup(userId);
  }
});

// ---------------------------------------------------------------------------
// FIX 1B — brand deletion cascades brand-scoped knowledge history (deliberate
// current behavior; Prompt 029 reviews full deletion semantics).
// ---------------------------------------------------------------------------
test("FIX1B: brand deletion cascades versions and revisions exactly as documented", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    await knowledge.ownerEditFields({
      brandId,
      userId,
      fields: [{ fieldKey: "tagline", value: "Cascade target." }],
    });
    await knowledge.proposeRevision({
      brandId,
      fieldKey: "description",
      proposedValue: "A pending revision that dies with the brand.",
      provenance: PROV,
      sourceKind: "stated",
      proposedBy: "sage_draft",
    });
    const counts = async () => {
      const v = await db.query(
        "SELECT COUNT(*)::int AS n FROM brand_knowledge_versions WHERE brand_id = $1", [brandId]);
      const r = await db.query(
        "SELECT COUNT(*)::int AS n FROM brand_knowledge_revisions WHERE brand_id = $1", [brandId]);
      return { versions: v.rows[0].n, revisions: r.rows[0].n };
    };
    const before = await counts();
    assert.ok(before.versions >= 1 && before.revisions >= 1);

    await db.query("DELETE FROM brands WHERE brand_id = $1", [brandId]);

    const after = await counts();
    assert.deepEqual(after, { versions: 0, revisions: 0 },
      "brand deletion removes brand-scoped knowledge history via CASCADE");
    const userRow = await db.query("SELECT 1 FROM users WHERE user_id = $1", [userId]);
    assert.equal(userRow.rows.length, 1, "the approving user is untouched");
  } finally {
    await cleanup(userId);
  }
});

// ---------------------------------------------------------------------------
// FIX 3 helpers — drive the REAL runGeneration with a controllable AI phase.
// ---------------------------------------------------------------------------
const FAKE_REPORT = {
  sections: { whatWeDo: "Fresh regeneration output." },
  plainSummary: "Fresh regeneration output.",
};

async function seedPendingPair(brandId, version) {
  const rep = await db.query(
    `INSERT INTO company_truth_reports (brand_id, version, status, plain_summary)
     VALUES ($1, $2, 'pending_approval', 'Old pending draft') RETURNING report_id`,
    [brandId, version]
  );
  const proposed = await knowledge.proposeRevision({
    brandId,
    fieldKey: "company_truth_report",
    kind: "company_truth_report",
    proposedValue: { version, plainSummary: "Old pending draft" },
    provenance: {
      sources: [{ source: "inferred", basis: "Generated by Sage (test seed)." }],
    },
    sourceKind: "inferred",
    proposedBy: "company_truth",
    refId: rep.rows[0].report_id,
  });
  return { reportId: rep.rows[0].report_id, revisionId: proposed.revision.revision_id };
}

async function seedGeneratingClaim(brandId, version) {
  const { rows } = await db.query(
    `INSERT INTO company_truth_reports (brand_id, version, status, plain_summary)
     VALUES ($1, $2, 'generating', '') RETURNING report_id`,
    [brandId, version]
  );
  return rows[0].report_id;
}

function stubAiPhase(gate) {
  const orig = { ...ct._aiPhase };
  ct._aiPhase.gatherCompanyData = async () => ({ sources: [] });
  ct._aiPhase.generateCompanyReport = async () => {
    if (gate) await gate;
    return FAKE_REPORT;
  };
  return () => Object.assign(ct._aiPhase, orig);
}

async function ctState(brandId) {
  const reports = await db.query(
    `SELECT version, status FROM company_truth_reports WHERE brand_id = $1 ORDER BY version`,
    [brandId]
  );
  const revisions = await db.query(
    `SELECT status, reviewed_by, review_note FROM brand_knowledge_revisions
      WHERE brand_id = $1 AND kind = 'company_truth_report' ORDER BY created_at`,
    [brandId]
  );
  return { reports: reports.rows, revisions: revisions.rows };
}

// ---------------------------------------------------------------------------
// FIX 3A — owner approval lands BETWEEN runGeneration's pre-read and its
// promote transaction. The approved report/revision must survive; the fresh
// draft becomes the one pending pair. Exactly one deterministic outcome.
// ---------------------------------------------------------------------------
test("FIX3A: CT approval racing regeneration — approved history survives, fresh draft pends", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    await seedPendingPair(brandId, 1);
    const claimId = await seedGeneratingClaim(brandId, 2);

    let release;
    const gate = new Promise((r) => { release = r; });
    const restore = stubAiPhase(gate);
    try {
      const run = ct._runGeneration({ brand_id: brandId, brand_name: "BK Fix Brand" }, claimId, null);
      // Regeneration is now parked inside its AI phase, AFTER the pre-read
      // of the pending report. The owner approves the old draft now.
      await new Promise((r) => setTimeout(r, 50));
      const res = mockRes();
      await ct.approve({ user: { userId }, body: { brandId } }, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));

      release();
      await run;
    } finally {
      restore();
    }

    const s = await ctState(brandId);
    // v1 approved and NOT deleted; v2 is the pending draft.
    assert.deepEqual(s.reports, [
      { version: 1, status: "approved" },
      { version: 2, status: "pending_approval" },
    ]);
    // Old revision: honest owner approval retained. New revision: pending.
    assert.equal(s.revisions.length, 2);
    assert.equal(s.revisions[0].status, "approved");
    assert.equal(s.revisions[0].reviewed_by, userId);
    assert.equal(s.revisions[1].status, "pending");
    // No divergence: exactly one approved report, paired states consistent.
    const approvedCount = s.reports.filter((r) => r.status === "approved").length;
    assert.equal(approvedCount, 1);
    // Approved truth reader returns v1.
    const truth = await ct.getApprovedCompanyTruth(brandId);
    assert.equal(truth.version, 1);
  } finally {
    await cleanup(userId);
  }
});

// ---------------------------------------------------------------------------
// FIX 3B — regeneration claims first; approval arrives second. The old
// pending revision is SYSTEM-retired with the exact audit constant; the
// late approval deterministically approves the fresh draft.
// ---------------------------------------------------------------------------
test("FIX3B: regeneration first, approval second — system retirement + honest late approval", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    await seedPendingPair(brandId, 1);
    const claimId = await seedGeneratingClaim(brandId, 2);

    const restore = stubAiPhase(null);
    try {
      await ct._runGeneration({ brand_id: brandId, brand_name: "BK Fix Brand" }, claimId, null);
    } finally {
      restore();
    }

    let s = await ctState(brandId);
    // Old pending report retired (deleted — it was still pending), fresh v2 pends.
    assert.deepEqual(s.reports, [{ version: 2, status: "pending_approval" }]);
    // Old revision retained as an audit record with the SYSTEM convention.
    assert.equal(s.revisions.length, 2);
    assert.equal(s.revisions[0].status, "base_superseded");
    assert.equal(s.revisions[0].reviewed_by, null);
    assert.equal(s.revisions[0].review_note, ct.SUPERSEDED_BY_REGENERATION);
    assert.equal(s.revisions[1].status, "pending");

    // The late approval acts on the CURRENT pending pair — deterministic.
    const res = mockRes();
    await ct.approve({ user: { userId }, body: { brandId } }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    s = await ctState(brandId);
    assert.deepEqual(s.reports, [{ version: 2, status: "approved" }]);
    assert.equal(s.revisions.filter((r) => r.status === "approved").length, 1);
    assert.equal(s.revisions.filter((r) => r.status === "pending").length, 0);
  } finally {
    await cleanup(userId);
  }
});

// ---------------------------------------------------------------------------
// Hardening A — strict standards-compliant provenance URL parsing.
// ---------------------------------------------------------------------------
test("Hardening A: provenance URLs must fully parse as http(s)", async () => {
  const bad = [
    "https://", // scheme only — new URL() rejects
    "http://exa mple.com/x", // embedded space
    "ftp://example.com/file",
    "javascript:alert(1)",
    "https://user:pass@example.com/page", // credentials
  ];
  for (const url of bad) {
    assert.throws(
      () => knowledge.assertProvenance(
        { sources: [{ source: "website", url, basis: "x" }] },
        "website"
      ),
      /http\(s\) URL|credentials/,
      `must reject: ${url}`
    );
  }
  // A well-formed URL still passes.
  knowledge.assertProvenance(
    { sources: [{ source: "website", url: "https://example.com/about?utm=1", basis: "x" }] },
    "website"
  );
});
