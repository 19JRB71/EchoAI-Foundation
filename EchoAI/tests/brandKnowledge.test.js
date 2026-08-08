/**
 * Prompt 011 — Versioned Brand Knowledge tests.
 *
 * Covers: schema enforcement (enums, one-current, immutability, cascade),
 * owner edits (v1, atomicity, column-less fields, supersede, tenancy),
 * propose→approve/reject lifecycle (provenance byte-equality, duplicates,
 * stale-base 409 + base_superseded), provenance validation, fault-injection
 * atomicity, controller integration (createBrand v1, updateBrand split),
 * Company Truth revision-as-authority + derived mirror (divergence 409,
 * reject mirror), native inbox projection + adapter ratchet, Autonomous
 * Growth silent-overwrite removal (B2), and structural no-bypass grep.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

require("./dbGuard");
const db = require("../config/db");
const knowledge = require("../utils/brandKnowledge");
const brandController = require("../controllers/brandController");
const knowledgeController = require("../controllers/brandKnowledgeController");
const approvalsController = require("../controllers/approvalsController");
const growth = require("../controllers/autonomousGrowthController");

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

async function createUser() {
  const email = `bk-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const { rows } = await db.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING user_id",
    [email, "test-not-a-real-hash"]
  );
  return rows[0].user_id;
}

async function createBrand(userId, name = "BK Test Brand") {
  const { rows } = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, $2) RETURNING brand_id",
    [userId, name]
  );
  return rows[0].brand_id;
}

async function deleteUser(userId) {
  await db.query("DELETE FROM users WHERE user_id = $1", [userId]);
}

const PROV = {
  sources: [{ source: "stated", basis: "Owner typed it in the profile editor." }],
  confidence: "high",
  conflict: false,
  alternatives: [],
};

// ---------------------------------------------------------------------------
// Schema enforcement
// ---------------------------------------------------------------------------

test("schema: field/source enums are enforced", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    await assert.rejects(
      db.query(
        `INSERT INTO brand_knowledge_versions
           (brand_id, field_key, version_no, value, provenance, source_kind, proposed_by, status, approved_by)
         VALUES ($1, 'nonsense_field', 1, '"x"'::jsonb, $2::jsonb, 'stated', 'owner', 'current', $3)`,
        [brandId, JSON.stringify(PROV), userId]
      ),
      /check/i
    );
    await assert.rejects(
      db.query(
        `INSERT INTO brand_knowledge_versions
           (brand_id, field_key, version_no, value, provenance, source_kind, proposed_by, status, approved_by)
         VALUES ($1, 'tagline', 1, '"x"'::jsonb, $2::jsonb, 'rumor', 'owner', 'current', $3)`,
        [brandId, JSON.stringify(PROV), userId]
      ),
      /check/i
    );
  } finally {
    await deleteUser(userId);
  }
});

test("schema: only one current version per (brand, field)", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    await db.query(
      `INSERT INTO brand_knowledge_versions
         (brand_id, field_key, version_no, value, provenance, source_kind, proposed_by, status, approved_by)
       VALUES ($1, 'tagline', 1, '"a"'::jsonb, $2::jsonb, 'stated', 'owner', 'current', $3)`,
      [brandId, JSON.stringify(PROV), userId]
    );
    await assert.rejects(
      db.query(
        `INSERT INTO brand_knowledge_versions
           (brand_id, field_key, version_no, value, provenance, source_kind, proposed_by, status, approved_by)
         VALUES ($1, 'tagline', 2, '"b"'::jsonb, $2::jsonb, 'stated', 'owner', 'current', $3)`,
        [brandId, JSON.stringify(PROV), userId]
      ),
      /brand_knowledge_versions_one_current|duplicate key/i
    );
  } finally {
    await deleteUser(userId);
  }
});

test("schema: version rows are immutable except current→superseded; direct DELETE blocked", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    const { rows } = await db.query(
      `INSERT INTO brand_knowledge_versions
         (brand_id, field_key, version_no, value, provenance, source_kind, proposed_by, status, approved_by)
       VALUES ($1, 'tagline', 1, '"a"'::jsonb, $2::jsonb, 'stated', 'owner', 'current', $3)
       RETURNING version_id`,
      [brandId, JSON.stringify(PROV), userId]
    );
    const vid = rows[0].version_id;
    // Value rewrite is rejected.
    await assert.rejects(
      db.query(`UPDATE brand_knowledge_versions SET value = '"HACKED"'::jsonb WHERE version_id = $1`, [vid]),
      /immutable/i
    );
    // Direct DELETE is rejected...
    await assert.rejects(
      db.query(`DELETE FROM brand_knowledge_versions WHERE version_id = $1`, [vid]),
      /immutable|append-only/i
    );
    // ...but the allowed lifecycle flip works.
    await db.query(
      `UPDATE brand_knowledge_versions SET status = 'superseded' WHERE version_id = $1`,
      [vid]
    );
  } finally {
    // Cascade delete (trigger depth > 1) must clean everything up.
    await deleteUser(userId);
  }
  const orphan = await db.query(
    "SELECT 1 FROM brand_knowledge_versions v LEFT JOIN brands b ON b.brand_id = v.brand_id WHERE b.brand_id IS NULL"
  );
  assert.equal(orphan.rows.length, 0, "brand cascade removes version rows");
});

// ---------------------------------------------------------------------------
// Owner edits
// ---------------------------------------------------------------------------

test("owner edit: creates version 1 and materializes the legacy column", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    await knowledge.ownerEditFields({
      brandId,
      userId,
      fields: [{ fieldKey: "tagline", value: "We build barns that outlive you." }],
    });
    const v = await db.query(
      `SELECT * FROM brand_knowledge_versions WHERE brand_id = $1 AND field_key = 'tagline'`,
      [brandId]
    );
    assert.equal(v.rows.length, 1);
    assert.equal(v.rows[0].version_no, 1);
    assert.equal(v.rows[0].status, "current");
    assert.equal(v.rows[0].source_kind, "stated");
    assert.equal(v.rows[0].value, "We build barns that outlive you.");
    const b = await db.query("SELECT tagline FROM brands WHERE brand_id = $1", [brandId]);
    assert.equal(b.rows[0].tagline, "We build barns that outlive you.");
  } finally {
    await deleteUser(userId);
  }
});

test("owner edit: multi-field save is atomic (C1) — one bad field rolls back all", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    await assert.rejects(
      knowledge.ownerEditFields({
        brandId,
        userId,
        fields: [
          { fieldKey: "tagline", value: "Good value" },
          { fieldKey: "description", value: "   " }, // blank → validation error
        ],
      }),
      (err) => err.statusCode === 400
    );
    const v = await db.query("SELECT 1 FROM brand_knowledge_versions WHERE brand_id = $1", [brandId]);
    assert.equal(v.rows.length, 0, "nothing persisted");
  } finally {
    await deleteUser(userId);
  }
});

test("owner edit: column-less fields (C3) version without touching brands", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    const before = await db.query("SELECT * FROM brands WHERE brand_id = $1", [brandId]);
    await knowledge.ownerEditFields({
      brandId,
      userId,
      fields: [{ fieldKey: "service_area", value: "Family-owned; 30-year warranty." }],
    });
    const after = await db.query("SELECT * FROM brands WHERE brand_id = $1", [brandId]);
    assert.deepEqual(
      { ...after.rows[0], updated_at: null },
      { ...before.rows[0], updated_at: null },
      "brands row unchanged apart from updated_at"
    );
    const approved = await knowledge.getApprovedKnowledge(brandId);
    const diff = approved.service_area;
    assert.ok(diff);
    assert.equal(diff.value, "Family-owned; 30-year warranty.");
  } finally {
    await deleteUser(userId);
  }
});

test("owner edit: second save supersedes v1 and creates v2 (C6 lineage)", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    await knowledge.ownerEditFields({ brandId, userId, fields: [{ fieldKey: "tagline", value: "One" }] });
    await knowledge.ownerEditFields({ brandId, userId, fields: [{ fieldKey: "tagline", value: "Two" }] });
    const v = await db.query(
      `SELECT version_no, status, value FROM brand_knowledge_versions
        WHERE brand_id = $1 AND field_key = 'tagline' ORDER BY version_no`,
      [brandId]
    );
    assert.equal(v.rows.length, 2);
    assert.deepEqual(
      v.rows.map((r) => [r.version_no, r.status, r.value]),
      [
        [1, "superseded", "One"],
        [2, "current", "Two"],
      ]
    );
  } finally {
    await deleteUser(userId);
  }
});

test("owner edit: foreign brand is 404; client-sent actor fields are ignored", async () => {
  const owner = await createUser();
  const stranger = await createUser();
  const brandId = await createBrand(owner);
  try {
    await assert.rejects(
      knowledge.ownerEditFields({
        brandId,
        userId: stranger,
        fields: [{ fieldKey: "tagline", value: "Hijack" }],
      }),
      (err) => err.statusCode === 404
    );
    // Controller path: forged proposedBy/sourceKind in the body are ignored.
    const res = mockRes();
    await knowledgeController.ownerEdit(
      {
        user: { userId: owner },
        params: { brandId },
        body: {
          fields: { tagline: "Honest" },
          proposedBy: "sage_research",
          sourceKind: "website",
        },
      },
      res
    );
    assert.equal(res.statusCode, 200);
    const v = await db.query(
      `SELECT source_kind, proposed_by FROM brand_knowledge_versions
        WHERE brand_id = $1 AND field_key = 'tagline' AND status = 'current'`,
      [brandId]
    );
    assert.equal(v.rows[0].source_kind, "stated");
    assert.equal(v.rows[0].proposed_by, `owner:${owner}`);
  } finally {
    await deleteUser(owner);
    await deleteUser(stranger);
  }
});

test("owner edit: fault injection — a failing materialize write rolls back the version row", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    await db.query(`
      CREATE OR REPLACE FUNCTION bk_test_boom() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'bk_test_boom'; END;
      $$ LANGUAGE plpgsql;
    `);
    await db.query(`
      CREATE TRIGGER bk_test_boom_trg BEFORE UPDATE OF brand_name, tagline ON brands
      FOR EACH ROW EXECUTE FUNCTION bk_test_boom();
    `);
    await assert.rejects(
      knowledge.ownerEditFields({ brandId, userId, fields: [{ fieldKey: "tagline", value: "Boom" }] }),
      /bk_test_boom/
    );
    const v = await db.query("SELECT 1 FROM brand_knowledge_versions WHERE brand_id = $1", [brandId]);
    assert.equal(v.rows.length, 0, "version row rolled back with the failed column write");
  } finally {
    await db.query("DROP TRIGGER IF EXISTS bk_test_boom_trg ON brands").catch(() => {});
    await db.query("DROP FUNCTION IF EXISTS bk_test_boom()").catch(() => {});
    await deleteUser(userId);
  }
});

// ---------------------------------------------------------------------------
// Propose → approve / reject
// ---------------------------------------------------------------------------

test("propose→approve: provenance carried byte-for-byte onto the version", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    const provenance = {
      sources: [
        { source: "website", url: "https://example.com/about", excerpt: "Since 1987 we have built..." },
      ],
      confidence: "medium",
      conflict: false,
      alternatives: [{ value: "Alt description" }],
    };
    const { revision } = await knowledge.proposeRevision({
      brandId,
      fieldKey: "description",
      proposedValue: "A pole-barn builder serving three counties since 1987.",
      provenance,
      sourceKind: "website",
      proposedBy: "sage_research",
    });
    const approved = await knowledge.approveRevision({
      brandId,
      userId,
      revisionId: revision.revision_id,
    });
    assert.equal(approved.version.status, "current");
    assert.deepEqual(approved.version.provenance, provenance, "provenance identical");
    assert.equal(approved.version.source_kind, "website");
    const r = await db.query(
      "SELECT status, reviewed_by FROM brand_knowledge_revisions WHERE revision_id = $1",
      [revision.revision_id]
    );
    assert.equal(r.rows[0].status, "approved");
    assert.equal(r.rows[0].reviewed_by, userId);
  } finally {
    await deleteUser(userId);
  }
});

test("reject: proposal retained in history; no version written", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    const { revision } = await knowledge.proposeRevision({
      brandId,
      fieldKey: "description",
      proposedValue: "Construction",
      provenance: PROV,
      sourceKind: "inferred",
      proposedBy: "sage_research",
    });
    await knowledge.rejectRevision({ brandId, userId, revisionId: revision.revision_id });
    const r = await db.query("SELECT status FROM brand_knowledge_revisions WHERE revision_id = $1", [
      revision.revision_id,
    ]);
    assert.equal(r.rows[0].status, "rejected");
    const v = await db.query(
      "SELECT 1 FROM brand_knowledge_versions WHERE brand_id = $1 AND field_key = 'description'",
      [brandId]
    );
    assert.equal(v.rows.length, 0);
  } finally {
    await deleteUser(userId);
  }
});

test("duplicate proposal for the same field is an idempotent no-op", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    const first = await knowledge.proposeRevision({
      brandId,
      fieldKey: "services",
      proposedValue: "Pole barns",
      provenance: PROV,
      sourceKind: "inferred",
      proposedBy: "sage_research",
    });
    const second = await knowledge.proposeRevision({
      brandId,
      fieldKey: "services",
      proposedValue: "Pole barns and garages",
      provenance: PROV,
      sourceKind: "inferred",
      proposedBy: "sage_research",
    });
    assert.equal(second.duplicate, true);
    assert.equal(String(second.existing.revision_id), String(first.revision.revision_id));
    const count = await db.query(
      `SELECT COUNT(*) AS n FROM brand_knowledge_revisions
        WHERE brand_id = $1 AND field_key = 'services' AND status = 'pending'`,
      [brandId]
    );
    assert.equal(Number(count.rows[0].n), 1);
  } finally {
    await deleteUser(userId);
  }
});

test("stale base (C5): owner edit after proposal → approve 409s and flips to base_superseded", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    await knowledge.ownerEditFields({ brandId, userId, fields: [{ fieldKey: "tagline", value: "Base" }] });
    const { revision } = await knowledge.proposeRevision({
      brandId,
      fieldKey: "tagline",
      proposedValue: "Proposed on the old base",
      provenance: PROV,
      sourceKind: "inferred",
      proposedBy: "sage_research",
    });
    // Owner edits again — the pending proposal's base is now stale, and the
    // owner edit itself supersedes the pending proposal (never deletes it).
    await knowledge.ownerEditFields({ brandId, userId, fields: [{ fieldKey: "tagline", value: "Newer" }] });
    let r = await db.query("SELECT status FROM brand_knowledge_revisions WHERE revision_id = $1", [
      revision.revision_id,
    ]);
    assert.equal(r.rows[0].status, "base_superseded", "owner edit retires the pending proposal");

    // Force the race the other way: re-flip to pending and try to approve —
    // the frozen base no longer matches the current version.
    await db.query(
      "UPDATE brand_knowledge_revisions SET status = 'pending', reviewed_at = NULL, reviewed_by = NULL WHERE revision_id = $1",
      [revision.revision_id]
    );
    await assert.rejects(
      knowledge.approveRevision({ brandId, userId, revisionId: revision.revision_id }),
      (err) => err.statusCode === 409 && /older value/i.test(err.message)
    );
    r = await db.query("SELECT status FROM brand_knowledge_revisions WHERE revision_id = $1", [
      revision.revision_id,
    ]);
    assert.equal(r.rows[0].status, "base_superseded");
    const cur = await db.query(
      `SELECT value FROM brand_knowledge_versions
        WHERE brand_id = $1 AND field_key = 'tagline' AND status = 'current'`,
      [brandId]
    );
    assert.equal(cur.rows[0].value, "Newer", "current value untouched by the failed approval");
  } finally {
    await deleteUser(userId);
  }
});

test("tenancy: a stranger cannot approve someone else's revision", async () => {
  const owner = await createUser();
  const stranger = await createUser();
  const brandId = await createBrand(owner);
  try {
    const { revision } = await knowledge.proposeRevision({
      brandId,
      fieldKey: "hours",
      proposedValue: "Mon-Fri 8-5",
      provenance: PROV,
      sourceKind: "inferred",
      proposedBy: "sage_research",
    });
    await assert.rejects(
      knowledge.approveRevision({ brandId, userId: stranger, revisionId: revision.revision_id }),
      (err) => err.statusCode === 404
    );
  } finally {
    await deleteUser(owner);
    await deleteUser(stranger);
  }
});

// ---------------------------------------------------------------------------
// Provenance validation
// ---------------------------------------------------------------------------

test("provenance validation matrix", async () => {
  const cases = [
    [{}, /sources/i],
    [{ sources: [] }, /sources/i],
    [{ sources: [{ source: "rumor" }] }, /source/i],
    [{ sources: [{ source: "website", url: "ftp://x" }] }, /http/i],
    [{ sources: [{ source: "website", url: "https://user:pw@example.com/" }] }, /credential|userinfo/i],
    [{ sources: [{ source: "website", url: "https://example.com/?api_key=abc" }] }, /credential/i],
    [{ sources: [{ source: "website", url: "https://example.com", excerpt: "x".repeat(1001) }] }, /excerpt/i],
    [{ sources: [{ source: "inferred" }] }, /basis/i],
  ];
  for (const [prov, re] of cases) {
    assert.throws(() => knowledge.assertProvenance(prov), re, JSON.stringify(prov).slice(0, 80));
  }
  // Valid shapes pass.
  knowledge.assertProvenance(PROV);
  knowledge.assertProvenance({
    sources: [{ source: "inferred", basis: "Derived from the interview." }],
  });
});

// ---------------------------------------------------------------------------
// Controller integration
// ---------------------------------------------------------------------------

test("createBrand writes business_name v1 in the same transaction", async () => {
  const userId = await createUser();
  let brandId = null;
  try {
    const res = mockRes();
    await brandController.createBrand({ user: { userId }, body: { name: "Spine Barns" } }, res);
    assert.equal(res.statusCode, 201);
    brandId = res.body.brand_id;
    const v = await db.query(
      `SELECT value, version_no, status FROM brand_knowledge_versions
        WHERE brand_id = $1 AND field_key = 'business_name'`,
      [brandId]
    );
    assert.equal(v.rows.length, 1);
    assert.equal(v.rows[0].value, "Spine Barns");
    assert.equal(v.rows[0].version_no, 1);
    assert.equal(v.rows[0].status, "current");
  } finally {
    await deleteUser(userId);
  }
});

test("updateBrand split: knowledge fields version; operational fields don't; failure is atomic", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    const res = mockRes();
    await brandController.updateBrand(
      {
        user: { userId },
        params: { brandId },
        body: { name: "Renamed Barns", tagline: "Built right.", brandType: "standard" },
      },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.brand_name, "Renamed Barns");
    assert.equal(res.body.tagline, "Built right.");
    assert.equal(res.body.brand_type, "standard");
    const v = await db.query(
      `SELECT field_key FROM brand_knowledge_versions WHERE brand_id = $1 AND status = 'current'`,
      [brandId]
    );
    assert.deepEqual(v.rows.map((r) => r.field_key).sort(), ["business_name", "tagline"]);

    // Blank tagline is a 400 AND rolls back the operational change too.
    const bad = mockRes();
    await brandController.updateBrand(
      { user: { userId }, params: { brandId }, body: { tagline: "   ", websiteUrl: "https://new.example.com" } },
      bad
    );
    assert.equal(bad.statusCode, 400);
    const b = await db.query("SELECT website_url, tagline FROM brands WHERE brand_id = $1", [brandId]);
    assert.equal(b.rows[0].website_url, null, "operational write rolled back with the failed knowledge write");
    assert.equal(b.rows[0].tagline, "Built right.");
  } finally {
    await deleteUser(userId);
  }
});

// ---------------------------------------------------------------------------
// Company Truth: revision-as-authority + derived mirror
// ---------------------------------------------------------------------------

async function seedPendingCt(brandId, version = 501) {
  const rep = await db.query(
    `INSERT INTO company_truth_reports (brand_id, version, status, plain_summary)
     VALUES ($1, $2, 'pending_approval', 'summary') RETURNING report_id`,
    [brandId, version]
  );
  const { revision } = await knowledge.proposeRevision({
    brandId,
    fieldKey: "company_truth_report",
    kind: "company_truth_report",
    proposedValue: { version, plainSummary: "summary" },
    provenance: {
      sources: [{ source: "inferred", basis: "Generated by Sage from stored account data." }],
    },
    sourceKind: "inferred",
    proposedBy: "company_truth",
    refId: rep.rows[0].report_id,
  });
  return { reportId: rep.rows[0].report_id, revisionId: revision.revision_id };
}

test("CT approve: revision authoritative; mirror flips in the same tx; no knowledge version row", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    // Existing approved Truth gets superseded by the new approval.
    await db.query(
      `INSERT INTO company_truth_reports (brand_id, version, status, plain_summary, approved_at)
       VALUES ($1, 500, 'approved', 'old', NOW())`,
      [brandId]
    );
    const { revisionId } = await seedPendingCt(brandId, 501);
    await knowledge.approveRevision({ brandId, userId, revisionId });
    const reports = await db.query(
      "SELECT version, status FROM company_truth_reports WHERE brand_id = $1 ORDER BY version",
      [brandId]
    );
    assert.deepEqual(
      reports.rows.map((r) => [r.version, r.status]),
      [
        [500, "superseded"],
        [501, "approved"],
      ]
    );
    const r = await db.query("SELECT status FROM brand_knowledge_revisions WHERE revision_id = $1", [revisionId]);
    assert.equal(r.rows[0].status, "approved");
    const v = await db.query(
      "SELECT 1 FROM brand_knowledge_versions WHERE brand_id = $1 AND field_key = 'company_truth_report'",
      [brandId]
    );
    assert.equal(v.rows.length, 0, "CT approval writes no knowledge version row");
  } finally {
    await deleteUser(userId);
  }
});

test("CT divergence: approving a revision whose report vanished is a surfaced 409, never repaired", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    const { reportId, revisionId } = await seedPendingCt(brandId, 502);
    await db.query("DELETE FROM company_truth_reports WHERE report_id = $1", [reportId]);
    await assert.rejects(
      knowledge.approveRevision({ brandId, userId, revisionId }),
      (err) => err.statusCode === 409 && /divergence/i.test(err.message)
    );
    const r = await db.query("SELECT status FROM brand_knowledge_revisions WHERE revision_id = $1", [revisionId]);
    assert.equal(r.rows[0].status, "pending", "revision untouched — divergence is surfaced, not repaired");
  } finally {
    await deleteUser(userId);
  }
});

test("CT reject: mirror flips the report to 'rejected' in the same tx", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    const { reportId, revisionId } = await seedPendingCt(brandId, 503);
    await knowledge.rejectRevision({ brandId, userId, revisionId });
    const rep = await db.query("SELECT status FROM company_truth_reports WHERE report_id = $1", [reportId]);
    assert.equal(rep.rows[0].status, "rejected");
    const r = await db.query("SELECT status FROM brand_knowledge_revisions WHERE revision_id = $1", [revisionId]);
    assert.equal(r.rows[0].status, "rejected");
  } finally {
    await deleteUser(userId);
  }
});

// ---------------------------------------------------------------------------
// Approvals inbox (native class)
// ---------------------------------------------------------------------------

test("inbox: native knowledge_revision items, CONTESTED marker, tenancy, adapter ratchet at 3", async () => {
  const owner = await createUser();
  const stranger = await createUser();
  const brandId = await createBrand(owner);
  const foreignBrandId = await createBrand(stranger);
  try {
    await knowledge.proposeRevision({
      brandId,
      fieldKey: "description",
      proposedValue: "Contested description",
      provenance: {
        sources: [
          { source: "website", url: "https://a.example.com", excerpt: "A" },
          { source: "social_profile", url: "https://b.example.com", excerpt: "B" },
        ],
        conflict: true,
      },
      sourceKind: "website",
      proposedBy: "sage_research",
    });
    await knowledge.proposeRevision({
      brandId: foreignBrandId,
      fieldKey: "description",
      proposedValue: "Foreign",
      provenance: PROV,
      sourceKind: "inferred",
      proposedBy: "sage_research",
    });

    const res = mockRes();
    await approvalsController.getInbox({ user: { userId: owner }, query: {} }, res);
    assert.equal(res.statusCode, 200);
    const native = res.body.items.filter((i) => i.kind === "knowledge_revision");
    assert.equal(native.length, 1, "only the owner's revision appears");
    assert.equal(native[0].source, "native");
    assert.match(native[0].detail || "", /CONTESTED/);
    assert.deepEqual(native[0].actions, ["approve", "reject"]);
    assert.equal(typeof res.body.counts.native, "number");
    assert.equal(res.body.adapterInventory.length, 3, "adapter ratchet: 4 → 3");
    assert.ok(!res.body.adapterInventory.some((a) => a.key === "company_truth"));

    // Foreign approve through the controller is a 404.
    const foreignRev = await db.query(
      "SELECT revision_id FROM brand_knowledge_revisions WHERE brand_id = $1",
      [foreignBrandId]
    );
    const deny = mockRes();
    await knowledgeController.approve(
      {
        user: { userId: owner },
        params: { brandId: foreignBrandId, revisionId: foreignRev.rows[0].revision_id },
        body: {},
      },
      deny
    );
    assert.equal(deny.statusCode, 404);
  } finally {
    await deleteUser(owner);
    await deleteUser(stranger);
  }
});

// ---------------------------------------------------------------------------
// Autonomous Growth (B2): silent overwrite removed
// ---------------------------------------------------------------------------

test("growth audience update proposes a pending revision — target_audience byte-identical; idempotent", async () => {
  const userId = await createUser();
  const brandId = await createBrand(userId);
  try {
    await db.query(`UPDATE brands SET target_audience = '{"who":"farmers"}'::jsonb WHERE brand_id = $1`, [brandId]);
    for (let i = 0; i < 12; i++) {
      await db.query(
        `INSERT INTO leads (brand_id, lead_name, conversion_status)
         VALUES ($1, $2, $3)`,
        [brandId, `Lead ${i}`, i < 3 ? "converted" : "new"]
      );
    }
    const brandRow = (
      await db.query("SELECT * FROM brands WHERE brand_id = $1", [brandId])
    ).rows[0];
    const counts = { audience: 0 };
    await growth._runAudienceUpdate(brandRow, {}, counts);
    assert.equal(counts.audience, 1);

    const after = await db.query("SELECT target_audience FROM brands WHERE brand_id = $1", [brandId]);
    assert.deepEqual(after.rows[0].target_audience, { who: "farmers" }, "brands column untouched (B2)");
    const rev = await db.query(
      `SELECT status, proposed_by, source_kind FROM brand_knowledge_revisions
        WHERE brand_id = $1 AND field_key = 'target_audience'`,
      [brandId]
    );
    assert.equal(rev.rows.length, 1);
    assert.equal(rev.rows[0].status, "pending");
    assert.equal(rev.rows[0].proposed_by, "autonomous_growth");
    assert.equal(rev.rows[0].source_kind, "inferred");

    // Second run: duplicate proposal collapses to a no-op.
    await growth._runAudienceUpdate(brandRow, {}, counts);
    const rev2 = await db.query(
      `SELECT COUNT(*) AS n FROM brand_knowledge_revisions
        WHERE brand_id = $1 AND field_key = 'target_audience' AND status = 'pending'`,
      [brandId]
    );
    assert.equal(Number(rev2.rows[0].n), 1);
  } finally {
    await deleteUser(userId);
  }
});

// ---------------------------------------------------------------------------
// Structural guards
// ---------------------------------------------------------------------------

test("structural: no direct writes to knowledge columns outside the boundary", () => {
  const ROOT = path.join(__dirname, "..");
  const ALLOWED = new Set([
    "utils/brandKnowledge.js",
    "controllers/demoController.js",
    "utils/demoSeeder.js",
  ]);
  const offenders = [];
  const dirs = ["controllers", "utils", "routes", "jobs", "services"].filter((d) =>
    fs.existsSync(path.join(ROOT, d))
  );
  const pattern =
    /UPDATE\s+brands\s+SET[^;]*(brand_name|tagline|brand_personality|voice_description|target_audience)\s*=/is;
  for (const dir of dirs) {
    for (const file of fs.readdirSync(path.join(ROOT, dir))) {
      if (!file.endsWith(".js")) continue;
      const rel = `${dir}/${file}`;
      if (ALLOWED.has(rel)) continue;
      const src = fs.readFileSync(path.join(ROOT, dir, file), "utf8");
      if (pattern.test(src)) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], `knowledge-column writes outside the boundary: ${offenders.join(", ")}`);
});

test("structural: Hermes untouched (D-9)", () => {
  const ROOT = path.join(__dirname, "..");
  const hermesFiles = [];
  for (const dir of ["utils", "controllers", "config"]) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full)) {
      if (/hermes/i.test(f)) hermesFiles.push(path.join(dir, f));
    }
  }
  for (const rel of hermesFiles) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.ok(!/brandKnowledge|brand_knowledge/.test(src), `${rel} must not reference brand knowledge`);
  }
});
