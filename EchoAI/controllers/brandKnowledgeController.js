/**
 * Brand Knowledge endpoints (Prompt 011) — the owner's review surface over
 * the versioned knowledge system. All writes go through utils/brandKnowledge
 * (the canonical boundary). Actors always come from req.user — any
 * client-supplied actor fields are ignored.
 */
const db = require("../config/db");
const knowledge = require("../utils/brandKnowledge");

const ORDERING_NOTE =
  "Proposal ordering is deterministic candidate selection for an UNAPPROVED draft; it is not an authority or truth ranking.";

function fail(res, err, fallback) {
  if (err.statusCode) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code2 || undefined });
  }
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
}

async function ownedBrand(brandId, userId) {
  const r = await db.query("SELECT * FROM brands WHERE brand_id = $1 AND user_id = $2", [
    brandId,
    userId,
  ]);
  return r.rows[0] || null;
}

/**
 * GET /api/brands/:brandId/knowledge
 * Approved values + legacy unversioned view (B4: shown honestly as never
 * reviewed, no fabricated provenance) + pending revisions.
 */
async function getKnowledge(req, res) {
  try {
    const brand = await ownedBrand(req.params.brandId, req.user.userId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const approved = await knowledge.getApprovedKnowledge(brand.brand_id);

    // Legacy pre-versioning values (B4): a brands column value with no
    // current version row is "Current (unversioned — never reviewed)".
    const legacy = {};
    for (const [fieldKey, col] of Object.entries(knowledge.FIELD_COLUMNS)) {
      if (approved[fieldKey]) continue;
      const raw = brand[col.column];
      if (raw === null || raw === undefined || raw === "") continue;
      legacy[fieldKey] = {
        value: raw,
        label: "Current (unversioned — never reviewed)",
      };
    }

    const pending = await db.query(
      `SELECT * FROM brand_knowledge_revisions
        WHERE brand_id = $1 AND status = 'pending'
        ORDER BY created_at ASC`,
      [brand.brand_id],
    );

    return res.json({
      fieldKeys: knowledge.FIELD_KEYS,
      approved,
      legacy,
      pending: pending.rows.map((r) => ({
        revisionId: r.revision_id,
        fieldKey: r.field_key,
        kind: r.kind,
        proposedValue: r.proposed_value,
        provenance: r.provenance,
        sourceKind: r.source_kind,
        proposedBy: r.proposed_by,
        createdAt: r.created_at,
      })),
      orderingNote: ORDERING_NOTE,
    });
  } catch (err) {
    return fail(res, err, "Failed to load brand knowledge");
  }
}

/** GET /api/brands/:brandId/knowledge/history/:fieldKey */
async function getHistory(req, res) {
  try {
    const brand = await ownedBrand(req.params.brandId, req.user.userId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const versions = await knowledge.getFieldHistory(brand.brand_id, req.params.fieldKey);
    return res.json({ fieldKey: req.params.fieldKey, versions });
  } catch (err) {
    return fail(res, err, "Failed to load field history");
  }
}

/**
 * POST /api/brands/:brandId/knowledge/adopt  { fieldKey }
 * Files a pending revision from the latest complete/partial Sage research
 * draft. The value AND provenance are re-read server-side from the draft —
 * the client's copy is never trusted.
 */
async function adoptFromDraft(req, res) {
  try {
    const brand = await ownedBrand(req.params.brandId, req.user.userId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const { fieldKey } = req.body || {};
    if (!fieldKey) return res.status(400).json({ error: "fieldKey is required" });

    const draft = await db.query(
      `SELECT * FROM sage_research_drafts
        WHERE brand_id = $1 AND status IN ('complete', 'partial')
        ORDER BY created_at DESC LIMIT 1`,
      [brand.brand_id],
    );
    if (draft.rows.length === 0) {
      return res.status(404).json({ error: "No completed research draft to adopt from" });
    }
    const field = (draft.rows[0].fields || {})[fieldKey];
    if (!field || field.value === undefined || field.value === null) {
      return res.status(404).json({ error: `The research draft has no value for ${fieldKey}` });
    }

    const out = await knowledge.proposeRevision({
      brandId: brand.brand_id,
      fieldKey,
      proposedValue: field.value,
      provenance: {
        sources: field.sources || [],
        confidence: field.confidence || null,
        conflict: field.conflict === true,
        alternatives: field.alternatives || [],
      },
      sourceKind: "website",
      proposedBy: "sage_research",
      refId: draft.rows[0].draft_id,
    });
    if (out.duplicate) {
      return res.status(409).json({
        error: "A proposal for this field is already waiting for your decision",
        existing: { revisionId: out.existing.revision_id },
      });
    }
    return res.status(201).json({ revisionId: out.revision.revision_id });
  } catch (err) {
    return fail(res, err, "Failed to adopt the research value");
  }
}

/** POST /api/brands/:brandId/knowledge/revisions/:revisionId/approve */
async function approve(req, res) {
  try {
    const out = await knowledge.approveRevision({
      brandId: req.params.brandId,
      userId: req.user.userId,
      revisionId: req.params.revisionId,
    });
    return res.json({
      approved: true,
      version: out.version
        ? { versionId: out.version.version_id, versionNo: out.version.version_no }
        : null,
    });
  } catch (err) {
    return fail(res, err, "Failed to approve the proposal");
  }
}

/** POST /api/brands/:brandId/knowledge/revisions/:revisionId/reject */
async function reject(req, res) {
  try {
    await knowledge.rejectRevision({
      brandId: req.params.brandId,
      userId: req.user.userId,
      revisionId: req.params.revisionId,
      note: (req.body && req.body.note) || null,
    });
    return res.json({ rejected: true });
  } catch (err) {
    return fail(res, err, "Failed to reject the proposal");
  }
}

/**
 * PUT /api/brands/:brandId/knowledge/fields   { fields: { fieldKey: value } }
 * Owner multi-field edit — atomic, immediate effect, source 'stated'.
 */
async function ownerEdit(req, res) {
  try {
    const fieldsObj = (req.body && req.body.fields) || {};
    const fields = Object.entries(fieldsObj).map(([fieldKey, value]) => ({ fieldKey, value }));
    const versions = await knowledge.ownerEditFields({
      brandId: req.params.brandId,
      userId: req.user.userId,
      fields,
    });
    return res.json({
      saved: true,
      versions: versions.map((v) => ({
        versionId: v.version_id,
        fieldKey: v.field_key,
        versionNo: v.version_no,
        proposedBy: v.proposed_by,
        approvedBy: v.approved_by,
      })),
    });
  } catch (err) {
    return fail(res, err, "Failed to save your edits");
  }
}

module.exports = { getKnowledge, getHistory, adoptFromDraft, approve, reject, ownerEdit };
