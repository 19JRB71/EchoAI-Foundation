/**
 * Versioned Brand Knowledge — the ONE canonical write boundary (Prompt 011).
 *
 * Every approved brand-knowledge value lives as an immutable row in
 * brand_knowledge_versions; every proposed change waits in
 * brand_knowledge_revisions for the owner's decision. Legacy brands columns
 * (brand_name, tagline, brand_personality, voice_description,
 * target_audience) are MATERIALIZATIONS of the current version — kept in sync
 * here and only here. No other module may write those columns (structural
 * test enforces this; the enumerated exceptions are brand creation's initial
 * INSERT, brand discovery's brand INSERT, and the demo seeding system).
 *
 * Owner rulings:
 *  - Actors always come from server-side auth (callers pass userId from
 *    req.user), never from client bodies.
 *  - Provenance is frozen at proposal time and copied byte-equivalent into
 *    the version row on approval.
 *  - Owner edits take effect immediately (source 'stated' unless the caller
 *    is brand discovery, which records 'inferred' + interview basis), and
 *    supersede any pending revision for the same field (kept as
 *    'base_superseded', never deleted).
 *  - Stale base: approving a revision whose base_version_id is no longer the
 *    current version is a 409; the revision flips to base_superseded.
 *  - Company Truth (kind 'company_truth_report'): the revision row is the
 *    authoritative approval record; company_truth_reports.status is a derived
 *    mirror flipped in the SAME transaction. Divergence is surfaced as a 409
 *    defect and never silently repaired.
 */
const db = require("../config/db");

const FIELD_KEYS = [
  "business_name",
  "tagline",
  "brand_personality",
  "voice_description",
  "target_audience",
  "description",
  "email",
  "phone",
  "address",
  "hours",
  "services",
  "service_area",
];

const SOURCE_KINDS = ["website", "facebook", "public_web", "inferred", "stated", "connected"];

// Legacy brands columns materialized from the current version. Fields absent
// here are column-less: they exist only in the version history.
const FIELD_COLUMNS = {
  business_name: { column: "brand_name", type: "text" },
  tagline: { column: "tagline", type: "text" },
  brand_personality: { column: "brand_personality", type: "text" },
  voice_description: { column: "voice_description", type: "text" },
  target_audience: { column: "target_audience", type: "jsonb" },
};

const MAX_TEXT_BYTES = 8 * 1024;
const MAX_PROVENANCE_BYTES = 20 * 1024;
const MAX_EXCERPT_CHARS = 1000;

function httpError(statusCode, message, code2) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code2) err.code2 = code2;
  return err;
}

function assertFieldKey(fieldKey, { allowCompanyTruth = false } = {}) {
  const ok =
    FIELD_KEYS.includes(fieldKey) || (allowCompanyTruth && fieldKey === "company_truth_report");
  if (!ok) throw httpError(400, `Unknown knowledge field: ${String(fieldKey)}`, "bad_field_key");
}

function assertValue(fieldKey, value) {
  if (value === undefined || value === null) {
    throw httpError(400, `A value is required for ${fieldKey}`, "bad_value");
  }
  const col = FIELD_COLUMNS[fieldKey];
  const wantsText = !col || col.type === "text";
  if (fieldKey === "company_truth_report") return;
  if (wantsText && fieldKey !== "target_audience") {
    if (typeof value !== "string") {
      throw httpError(400, `${fieldKey} must be a text value`, "bad_value");
    }
    if (!value.trim()) {
      throw httpError(400, `${fieldKey} cannot be blank`, "bad_value");
    }
    if (Buffer.byteLength(value, "utf8") > MAX_TEXT_BYTES) {
      throw httpError(400, `${fieldKey} is too long (max 8KB)`, "bad_value");
    }
  } else {
    // jsonb fields: any non-null JSON value; strings must be non-blank.
    if (typeof value === "string" && !value.trim()) {
      throw httpError(400, `${fieldKey} cannot be blank`, "bad_value");
    }
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_TEXT_BYTES) {
      throw httpError(400, `${fieldKey} is too large (max 8KB)`, "bad_value");
    }
  }
}

function urlHasCredentials(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false; // protocol check handles it
  }
  if (u.username || u.password) return true;
  const SUSPECT = /(token|secret|password|api_?key|access_?key|auth)/i;
  for (const [k] of u.searchParams) {
    if (SUSPECT.test(k)) return true;
  }
  return false;
}

function assertProvenance(provenance, sourceKind) {
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    throw httpError(400, "Provenance must be an object with a sources array", "bad_provenance");
  }
  if (Buffer.byteLength(JSON.stringify(provenance), "utf8") > MAX_PROVENANCE_BYTES) {
    throw httpError(400, "Provenance is too large (max 20KB)", "bad_provenance");
  }
  const sources = provenance.sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    throw httpError(400, "Provenance must include at least one entry in sources[]", "bad_provenance");
  }
  for (const s of sources) {
    if (!s || typeof s !== "object") {
      throw httpError(400, "Each provenance source must be an object", "bad_provenance");
    }
    if (!SOURCE_KINDS.includes(s.source)) {
      throw httpError(400, `Unknown provenance source type: ${String(s.source)}`, "bad_provenance");
    }
    for (const key of ["url", "source_url"]) {
      const u = s[key];
      if (u === undefined || u === null) continue;
      // Strict standards-compliant parse: the value must BE a valid http(s)
      // URL, not merely start with a scheme.
      let parsed = null;
      if (typeof u === "string") {
        try {
          parsed = new URL(u);
        } catch {
          parsed = null;
        }
      }
      if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
        throw httpError(400, `${key} must be a valid http(s) URL`, "bad_provenance");
      }
      if (urlHasCredentials(u)) {
        throw httpError(400, `${key} must not contain credentials or tokens`, "bad_provenance");
      }
    }
    if (s.excerpt !== undefined && s.excerpt !== null) {
      if (typeof s.excerpt !== "string" || s.excerpt.length > MAX_EXCERPT_CHARS) {
        throw httpError(400, `Excerpts are capped at ${MAX_EXCERPT_CHARS} characters`, "bad_provenance");
      }
    }
    if (s.source === "inferred" && !(typeof s.basis === "string" && s.basis.trim())) {
      throw httpError(400, "Inferred sources must state their basis", "bad_provenance");
    }
  }
  if (sourceKind && !SOURCE_KINDS.includes(sourceKind)) {
    throw httpError(400, `Unknown source kind: ${String(sourceKind)}`, "bad_provenance");
  }
}

async function assertBrandOwned(client, brandId, userId) {
  const r = await client.query(
    "SELECT brand_id FROM brands WHERE brand_id = $1 AND user_id = $2",
    [brandId, userId],
  );
  if (r.rows.length === 0) throw httpError(404, "Brand not found", "not_found");
  return r.rows[0];
}

/** Materialize the current value into the legacy brands column (if any). */
async function materialize(client, brandId, fieldKey, value) {
  const col = FIELD_COLUMNS[fieldKey];
  if (!col) return;
  if (col.type === "jsonb") {
    await client.query(`UPDATE brands SET ${col.column} = $1::jsonb WHERE brand_id = $2`, [
      JSON.stringify(value),
      brandId,
    ]);
  } else {
    await client.query(`UPDATE brands SET ${col.column} = $1 WHERE brand_id = $2`, [
      value,
      brandId,
    ]);
  }
}

/**
 * Write a new approved version inside the caller's transaction:
 * lock + supersede the current row, insert version_no + 1, flip other pending
 * revisions for the field to base_superseded (unless told not to — the
 * approval path handles its own revision), and materialize.
 */
async function writeVersion(client, {
  brandId,
  fieldKey,
  value,
  provenance,
  sourceKind,
  proposedBy,
  approvedBy,
  skipRevisionInvalidation = false,
}) {
  const cur = await client.query(
    `SELECT version_id, version_no FROM brand_knowledge_versions
      WHERE brand_id = $1 AND field_key = $2 AND status = 'current'
      FOR UPDATE`,
    [brandId, fieldKey],
  );
  let nextNo = 1;
  if (cur.rows.length > 0) {
    nextNo = cur.rows[0].version_no + 1;
    const flip = await client.query(
      `UPDATE brand_knowledge_versions
          SET status = 'superseded', superseded_at = NOW()
        WHERE version_id = $1 AND status = 'current'`,
      [cur.rows[0].version_id],
    );
    if (flip.rowCount !== 1) {
      throw httpError(409, "The current value changed mid-write; please retry", "concurrent_write");
    }
  }
  const inserted = await client.query(
    `INSERT INTO brand_knowledge_versions
       (brand_id, field_key, value, provenance, source_kind, proposed_by, approved_by, version_no)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8)
     RETURNING *`,
    [
      brandId,
      fieldKey,
      JSON.stringify(value),
      JSON.stringify(provenance || {}),
      sourceKind,
      proposedBy,
      approvedBy,
      nextNo,
    ],
  );
  if (!skipRevisionInvalidation) {
    await client.query(
      `UPDATE brand_knowledge_revisions
          SET status = 'base_superseded', reviewed_at = NOW()
        WHERE brand_id = $1 AND field_key = $2 AND status = 'pending'`,
      [brandId, fieldKey],
    );
  }
  await materialize(client, brandId, fieldKey, value);
  return inserted.rows[0];
}

async function withClient(existingClient, fn) {
  if (existingClient) return fn(existingClient, false);
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client, true);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * File a proposed change. Duplicate pending proposal for the same field is an
 * idempotent no-op: returns { duplicate: true, existing }.
 */
async function proposeRevision({
  brandId,
  fieldKey,
  kind = "field",
  proposedValue,
  provenance,
  sourceKind,
  proposedBy,
  refId = null,
  client: existingClient = null,
}) {
  assertFieldKey(fieldKey, { allowCompanyTruth: true });
  if (fieldKey === "company_truth_report" && kind !== "company_truth_report") {
    throw httpError(400, "company_truth_report proposals must use the company_truth_report kind", "bad_field_key");
  }
  if (kind === "field") assertValue(fieldKey, proposedValue);
  assertProvenance(provenance, sourceKind);

  return withClient(existingClient, async (client) => {
    // Freeze the base the proposal was computed against.
    const base = await client.query(
      `SELECT version_id FROM brand_knowledge_versions
        WHERE brand_id = $1 AND field_key = $2 AND status = 'current'`,
      [brandId, fieldKey],
    );
    // Savepoint so a duplicate-key rejection doesn't abort an enclosing
    // transaction (the one-pending unique index is the atomic dedup gate).
    await client.query("SAVEPOINT bk_propose");
    try {
      const r = await client.query(
        `INSERT INTO brand_knowledge_revisions
           (brand_id, field_key, kind, proposed_value, provenance, source_kind,
            proposed_by, ref_id, base_version_id)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9)
         RETURNING *`,
        [
          brandId,
          fieldKey,
          kind,
          JSON.stringify(proposedValue),
          JSON.stringify(provenance),
          sourceKind,
          proposedBy,
          refId,
          base.rows.length ? base.rows[0].version_id : null,
        ],
      );
      await client.query("RELEASE SAVEPOINT bk_propose");
      return { revision: r.rows[0] };
    } catch (err) {
      await client.query("ROLLBACK TO SAVEPOINT bk_propose").catch(() => {});
      if (err.code === "23505") {
        const existing = await client.query(
          `SELECT * FROM brand_knowledge_revisions
            WHERE brand_id = $1 AND field_key = $2 AND status = 'pending'`,
          [brandId, fieldKey],
        );
        if (existing.rows.length) return { duplicate: true, existing: existing.rows[0] };
      }
      throw err;
    }
  });
}

/** Mirror helper: flip the Company Truth report's derived status in-tx. */
async function approveCompanyTruthMirror(client, brandId, reportId) {
  // Supersede any previously approved Truth first (one approved per brand).
  await client.query(
    `UPDATE company_truth_reports SET status = 'superseded', updated_at = NOW()
      WHERE brand_id = $1 AND status = 'approved'`,
    [brandId],
  ).catch(async (e) => {
    // updated_at may not exist on this table; retry without it.
    if (e.code !== "42703") throw e;
    await client.query(
      `UPDATE company_truth_reports SET status = 'superseded'
        WHERE brand_id = $1 AND status = 'approved'`,
      [brandId],
    );
  });
  const flip = await client.query(
    `UPDATE company_truth_reports SET status = 'approved'
      WHERE report_id = $1 AND brand_id = $2 AND status = 'pending_approval'`,
    [reportId, brandId],
  );
  if (flip.rowCount !== 1) {
    throw httpError(
      409,
      "Company Truth mirror divergence detected: the revision is pending but its report is not. This is surfaced as a defect and must be investigated — it is never silently repaired.",
      "ct_mirror_divergence",
    );
  }
}

/**
 * Section D single-transaction approval: lock the revision, verify pending +
 * base freshness, write the version (field kind) or flip the report mirror
 * (company_truth_report kind), and mark the revision approved.
 */
async function approveRevision({ brandId, userId, revisionId }) {
  const client = await db.pool.connect();
  let staleFlip = false;
  try {
    await client.query("BEGIN");
    await assertBrandOwned(client, brandId, userId);
    const r = await client.query(
      `SELECT * FROM brand_knowledge_revisions
        WHERE revision_id = $1 AND brand_id = $2
        FOR UPDATE`,
      [revisionId, brandId],
    );
    if (r.rows.length === 0) throw httpError(404, "Proposal not found", "not_found");
    const revision = r.rows[0];
    if (revision.status !== "pending") {
      throw httpError(409, `This proposal was already ${revision.status.replace(/_/g, " ")}`, "not_pending");
    }

    if (revision.kind === "field") {
      // Stale base check: the proposal must still be against the current value.
      const cur = await client.query(
        `SELECT version_id FROM brand_knowledge_versions
          WHERE brand_id = $1 AND field_key = $2 AND status = 'current'`,
        [brandId, revision.field_key],
      );
      const currentId = cur.rows.length ? cur.rows[0].version_id : null;
      if (String(currentId) !== String(revision.base_version_id)) {
        staleFlip = true;
        throw httpError(
          409,
          "This proposal was made against an older value that has since changed. It has been marked outdated — review the field again.",
          "stale_base",
        );
      }
      const version = await writeVersion(client, {
        brandId,
        fieldKey: revision.field_key,
        value: revision.proposed_value,
        provenance: revision.provenance,
        sourceKind: revision.source_kind,
        proposedBy: revision.proposed_by,
        approvedBy: userId,
        skipRevisionInvalidation: true,
      });
      const done = await client.query(
        `UPDATE brand_knowledge_revisions
            SET status = 'approved', reviewed_by = $2, reviewed_at = NOW()
          WHERE revision_id = $1 AND status = 'pending'`,
        [revisionId, userId],
      );
      if (done.rowCount !== 1) throw httpError(409, "The proposal changed mid-approval", "concurrent_write");
      await client.query("COMMIT");
      return { version, revision: { ...revision, status: "approved" } };
    }

    // Company Truth: the revision row is authoritative; the report status is
    // a derived mirror flipped in the same transaction. No knowledge version
    // row is written — the report content stays solely in
    // company_truth_reports (one authoritative store).
    await approveCompanyTruthMirror(client, brandId, revision.ref_id);
    const done = await client.query(
      `UPDATE brand_knowledge_revisions
          SET status = 'approved', reviewed_by = $2, reviewed_at = NOW()
        WHERE revision_id = $1 AND status = 'pending'`,
      [revisionId, userId],
    );
    if (done.rowCount !== 1) throw httpError(409, "The proposal changed mid-approval", "concurrent_write");
    await client.query("COMMIT");
    return { revision: { ...revision, status: "approved" } };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (staleFlip) {
      // Post-rollback guarded flip: mark the revision outdated (kept, never
      // deleted). Guarded so a concurrent decision wins.
      await db
        .query(
          `UPDATE brand_knowledge_revisions
              SET status = 'base_superseded', reviewed_at = NOW()
            WHERE revision_id = $1 AND status = 'pending'`,
          [revisionId],
        )
        .catch(() => {});
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Reject a pending revision; CT kind mirrors the report to 'rejected'. */
async function rejectRevision({ brandId, userId, revisionId, note = null }) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await assertBrandOwned(client, brandId, userId);
    const r = await client.query(
      `SELECT * FROM brand_knowledge_revisions
        WHERE revision_id = $1 AND brand_id = $2 FOR UPDATE`,
      [revisionId, brandId],
    );
    if (r.rows.length === 0) throw httpError(404, "Proposal not found", "not_found");
    const revision = r.rows[0];
    if (revision.status !== "pending") {
      throw httpError(409, `This proposal was already ${revision.status.replace(/_/g, " ")}`, "not_pending");
    }
    const done = await client.query(
      `UPDATE brand_knowledge_revisions
          SET status = 'rejected', reviewed_by = $2, reviewed_at = NOW(), review_note = $3
        WHERE revision_id = $1 AND status = 'pending'`,
      [revisionId, userId, note],
    );
    if (done.rowCount !== 1) throw httpError(409, "The proposal changed mid-rejection", "concurrent_write");
    if (revision.kind === "company_truth_report") {
      const flip = await client.query(
        `UPDATE company_truth_reports SET status = 'rejected'
          WHERE report_id = $1 AND brand_id = $2 AND status = 'pending_approval'`,
        [revision.ref_id, brandId],
      );
      if (flip.rowCount !== 1) {
        throw httpError(
          409,
          "Company Truth mirror divergence detected: the revision is pending but its report is not. This is surfaced as a defect and must be investigated — it is never silently repaired.",
          "ct_mirror_divergence",
        );
      }
    }
    await client.query("COMMIT");
    return { revision: { ...revision, status: "rejected" } };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Owner multi-field edit — atomic (all-or-nothing), immediate effect.
 * fields: [{ fieldKey, value, sourceKind?, provenance? }, ...]
 * Defaults: source 'stated' with the owner as the sole source. Brand
 * discovery passes sourceKind 'inferred' + interview basis + session lineage
 * (B5) via the per-field overrides and proposedBy/refId.
 */
async function ownerEditFields({
  brandId,
  userId,
  fields,
  proposedBy = null,
  refId = null,
  client: existingClient = null,
}) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw httpError(400, "At least one field is required", "bad_value");
  }
  // Validate everything BEFORE any write.
  for (const f of fields) {
    assertFieldKey(f.fieldKey);
    assertValue(f.fieldKey, f.value);
    if (f.provenance) assertProvenance(f.provenance, f.sourceKind || "stated");
  }
  return withClient(existingClient, async (client) => {
    await assertBrandOwned(client, brandId, userId);
    const versions = [];
    for (const f of fields) {
      const sourceKind = f.sourceKind || "stated";
      const provenance =
        f.provenance || {
          sources: [{ source: "stated" }],
          confidence: "high",
          conflict: false,
          alternatives: [],
        };
      versions.push(
        await writeVersion(client, {
          brandId,
          fieldKey: f.fieldKey,
          value: f.value,
          provenance,
          sourceKind,
          proposedBy: proposedBy || `owner:${userId}`,
          approvedBy: userId,
        }),
      );
    }
    return versions;
  });
}

/** Current approved knowledge, keyed by field. */
async function getApprovedKnowledge(brandId) {
  const r = await db.query(
    `SELECT * FROM brand_knowledge_versions
      WHERE brand_id = $1 AND status = 'current'`,
    [brandId],
  );
  const out = {};
  for (const row of r.rows) {
    out[row.field_key] = {
      versionId: row.version_id,
      value: row.value,
      provenance: row.provenance,
      sourceKind: row.source_kind,
      proposedBy: row.proposed_by,
      approvedBy: row.approved_by,
      versionNo: row.version_no,
      approvedAt: row.approved_at,
    };
  }
  return out;
}

/** Full immutable history for one field, newest first. */
async function getFieldHistory(brandId, fieldKey) {
  assertFieldKey(fieldKey);
  const r = await db.query(
    `SELECT * FROM brand_knowledge_versions
      WHERE brand_id = $1 AND field_key = $2
      ORDER BY version_no DESC`,
    [brandId, fieldKey],
  );
  return r.rows.map((row) => ({
    versionId: row.version_id,
    versionNo: row.version_no,
    status: row.status,
    value: row.value,
    provenance: row.provenance,
    source_kind: row.source_kind,
    sourceKind: row.source_kind,
    proposed_by: row.proposed_by,
    proposedBy: row.proposed_by,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    supersededAt: row.superseded_at,
  }));
}

module.exports = {
  FIELD_KEYS,
  SOURCE_KINDS,
  FIELD_COLUMNS,
  proposeRevision,
  approveRevision,
  rejectRevision,
  ownerEditFields,
  getApprovedKnowledge,
  getFieldHistory,
  assertProvenance,
  _materialize: materialize,
};
