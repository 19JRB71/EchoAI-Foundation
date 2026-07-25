/**
 * Sage V2 Phase 5 — Opportunity queue + decisions + directives + Change
 * Diagnostics + "What Sage knows" page.
 *
 * All endpoints flag-gated (default OFF → { enabled:false }, byte-identical
 * dark). Owner-only (requireOwner in sageRoutes): opportunities carry
 * financial reasoning and constraint facts. Ownership via getOwnedBrand.
 *
 * Executive lifecycle (CEO refinement): the internal status column is the
 * single source of truth; the owner-facing labels (New → Reviewed → Approved
 * → Rejected → Assigned → In Progress → Completed → Archived) are a pure
 * client mapping. reviewed_at is stamped on first detail open.
 */

const db = require("../config/db");
const { getSwitch } = require("../config/aiControls");
const { issueForOpportunity } = require("../utils/directiveBus");
const { getDiagnostics } = require("../utils/changeDiagnostics");
const { coverageForBrand } = require("../utils/leadOutcome");

const OPEN_STATUSES = ["proposed", "approved", "directed", "in_progress", "executed", "measuring"];

async function getOwnedBrand(userId, brandId) {
  const { rows } = await db.query(
    "SELECT * FROM brands WHERE brand_id = $1 AND user_id = $2",
    [brandId, userId],
  );
  return rows[0] || null;
}

async function requireEnabledBrand(req, res, flag) {
  if (!(await getSwitch(flag))) {
    res.json({ enabled: false });
    return null;
  }
  const brandId = req.query.brandId || req.body.brandId;
  if (!brandId) {
    res.status(400).json({ error: "brandId is required." });
    return null;
  }
  const brand = await getOwnedBrand(req.user.userId, brandId);
  if (!brand) {
    res.status(404).json({ error: "Brand not found." });
    return null;
  }
  return brand;
}

// --- Opportunity queue ---------------------------------------------------------

exports.listOpportunities = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_OPPORTUNITIES");
    if (!brand) return;
    const includeArchived = req.query.includeArchived === "true";
    const { rows } = await db.query(
      `SELECT o.*,
              COALESCE(json_agg(json_build_object(
                'item_id', e.item_id, 'claim', e.claim,
                'source', i.source, 'confidence', i.confidence,
                'summary', i.summary, 'created_at', i.created_at
              )) FILTER (WHERE e.item_id IS NOT NULL), '[]') AS evidence
         FROM sage_opportunities o
         LEFT JOIN sage_opportunity_evidence e ON e.opportunity_id = o.opportunity_id
         LEFT JOIN sage_intel_items i ON i.item_id = e.item_id
        WHERE o.brand_id = $1 ${includeArchived ? "" : "AND o.status <> 'archived'"}
        GROUP BY o.opportunity_id
        ORDER BY (o.status = ANY($2)) DESC, o.created_at DESC
        LIMIT 100`,
      [brand.brand_id, OPEN_STATUSES],
    );
    res.json({ enabled: true, opportunities: rows });
  } catch (err) {
    next(err);
  }
};

exports.getOpportunity = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_OPPORTUNITIES");
    if (!brand) return;
    // First detail open = lifecycle "Reviewed" (only from 'proposed', once).
    await db.query(
      `UPDATE sage_opportunities SET reviewed_at = NOW()
        WHERE opportunity_id = $1 AND brand_id = $2 AND reviewed_at IS NULL`,
      [req.params.id, brand.brand_id],
    );
    const { rows } = await db.query(
      `SELECT o.*,
              COALESCE(json_agg(json_build_object(
                'item_id', e.item_id, 'claim', e.claim,
                'source', i.source, 'confidence', i.confidence,
                'summary', i.summary, 'why_it_matters', i.why_it_matters,
                'url', i.url, 'created_at', i.created_at
              )) FILTER (WHERE e.item_id IS NOT NULL), '[]') AS evidence
         FROM sage_opportunities o
         LEFT JOIN sage_opportunity_evidence e ON e.opportunity_id = o.opportunity_id
         LEFT JOIN sage_intel_items i ON i.item_id = e.item_id
        WHERE o.opportunity_id = $1 AND o.brand_id = $2
        GROUP BY o.opportunity_id`,
      [req.params.id, brand.brand_id],
    );
    if (!rows.length) return res.status(404).json({ error: "Opportunity not found." });
    const dRes = await db.query(
      `SELECT directive_id, department, instruction, clamp_applied, status, result, error,
              issued_at, acknowledged_at, completed_at
         FROM sage_directives WHERE opportunity_id = $1 ORDER BY issued_at DESC`,
      [req.params.id],
    );
    res.json({ enabled: true, opportunity: rows[0], directives: dRes.rows });
  } catch (err) {
    next(err);
  }
};

/**
 * Owner decision: approve | decline. Atomic status guard (only 'proposed'
 * can be decided). Every decision writes a sage_decisions row. Approving an
 * opportunity with a non-owner department also issues the directive when
 * SAGE_V2_DIRECTIVES is on (best-effort; approval stands either way).
 */
exports.decideOpportunity = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_OPPORTUNITIES");
    if (!brand) return;
    const decision = String(req.body.decision || "").trim();
    if (!["approved", "declined"].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'approved' or 'declined'." });
    }
    const why = req.body.why == null ? null : String(req.body.why).trim().slice(0, 2000) || null;
    const via = ["briefing", "opportunities_tab", "voice"].includes(req.body.via)
      ? req.body.via
      : "opportunities_tab";

    // One transaction: the status flip and its decision-ledger row commit (or
    // roll back) together, so a decided opportunity always has its record.
    const client = await db.pool.connect();
    let opp;
    try {
      await client.query("BEGIN");
      const upd = await client.query(
        `UPDATE sage_opportunities
            SET status = $3, decided_at = NOW(), owner_decision_note = $4,
                reviewed_at = COALESCE(reviewed_at, NOW())
          WHERE opportunity_id = $1 AND brand_id = $2 AND status = 'proposed'
          RETURNING *`,
        [req.params.id, brand.brand_id, decision, why],
      );
      if (!upd.rows.length) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({ error: "This opportunity has already been decided or is no longer open." });
      }
      opp = upd.rows[0];
      await client.query(
        `INSERT INTO sage_decisions (brand_id, subject_type, subject_id, decided, decision_via, why)
         VALUES ($1, 'opportunity', $2, $3, $4, $5)`,
        [brand.brand_id, opp.opportunity_id, decision, via, why],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    let directive = null;
    let directiveError = null;
    if (decision === "approved" && opp.recommended_department !== "owner") {
      try {
        const r = await issueForOpportunity(opp.opportunity_id, req.user.userId);
        if (r.ok) directive = r.directive;
        else if (r.enabled === false) directiveError = null; // directives dark — approval only
        else directiveError = r.error;
      } catch (err) {
        console.error(`Directive issue failed for opportunity ${opp.opportunity_id}:`, err.message);
        directiveError = "Directive could not be issued — you can assign it again from the detail view.";
      }
    }
    res.json({ enabled: true, opportunity: opp, directive, directiveError });
  } catch (err) {
    next(err);
  }
};

/** Owner archives a terminal opportunity (lifecycle "Archived"). */
exports.archiveOpportunity = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_OPPORTUNITIES");
    if (!brand) return;
    const upd = await db.query(
      `UPDATE sage_opportunities SET status = 'archived'
        WHERE opportunity_id = $1 AND brand_id = $2
          AND status IN ('declined', 'expired', 'succeeded', 'failed', 'inconclusive')
        RETURNING opportunity_id, status`,
      [req.params.id, brand.brand_id],
    );
    if (!upd.rows.length) {
      return res.status(409).json({ error: "Only completed, declined, or expired opportunities can be archived." });
    }
    res.json({ enabled: true, opportunity: upd.rows[0] });
  } catch (err) {
    next(err);
  }
};

/** Manual re-assign (approved → directed) from the detail view. */
exports.assignOpportunity = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_OPPORTUNITIES");
    if (!brand) return;
    const r = await issueForOpportunity(req.params.id, req.user.userId);
    if (r.enabled === false) return res.json({ enabled: false });
    if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
    res.json({ enabled: true, directive: r.directive });
  } catch (err) {
    next(err);
  }
};

// --- Decisions review ------------------------------------------------------------

exports.listDecisions = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_OPPORTUNITIES");
    if (!brand) return;
    const { rows } = await db.query(
      `SELECT d.*, o.title, o.status AS opportunity_status, o.lesson AS opportunity_lesson
         FROM sage_decisions d
         LEFT JOIN sage_opportunities o
           ON d.subject_type = 'opportunity' AND o.opportunity_id = d.subject_id
        WHERE d.brand_id = $1
        ORDER BY d.created_at DESC
        LIMIT 100`,
      [brand.brand_id],
    );
    res.json({ enabled: true, decisions: rows });
  } catch (err) {
    next(err);
  }
};

// --- Change Diagnostics ------------------------------------------------------------

exports.getChangeDiagnostics = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_CHANGE_DIAGNOSTICS");
    if (!brand) return;
    const row = await getDiagnostics(brand.brand_id, req.query.weekStart || null);
    res.json({ enabled: true, diagnostics: row });
  } catch (err) {
    next(err);
  }
};

// --- "What Sage knows" -----------------------------------------------------------

async function knowledgeSnapshot(brandId) {
  const [truth, intel, offers, constraints, memory, coverage, diagnostics, opps] = await Promise.all([
    db.query(
      `SELECT version, approved_at FROM company_truth_reports
        WHERE brand_id = $1 AND status = 'approved'
        ORDER BY version DESC LIMIT 1`,
      [brandId],
    ),
    db.query(
      `SELECT confidence, COUNT(*)::int AS n, MAX(created_at) AS newest
         FROM sage_intel_items
        WHERE brand_id = $1 AND dismissed_at IS NULL
        GROUP BY confidence`,
      [brandId],
    ),
    db.query(
      `SELECT COUNT(*)::int AS n FROM sage_offers WHERE brand_id = $1 AND status = 'active'`,
      [brandId],
    ),
    db.query("SELECT * FROM brand_constraints WHERE brand_id = $1", [brandId]),
    db.query(
      `SELECT kind, COUNT(*)::int AS n FROM sage_memory
        WHERE brand_id = $1 AND status = 'active' GROUP BY kind`,
      [brandId],
    ),
    coverageForBrand(brandId),
    getDiagnostics(brandId, null),
    db.query(
      `SELECT status, COUNT(*)::int AS n FROM sage_opportunities
        WHERE brand_id = $1 GROUP BY status`,
      [brandId],
    ),
  ]);
  const c = constraints.rows[0] || null;
  return {
    companyTruth: truth.rows[0]
      ? { approved: true, version: truth.rows[0].version, approvedAt: truth.rows[0].approved_at }
      : { approved: false },
    intelByConfidence: intel.rows,
    activeOffers: offers.rows[0].n,
    constraints: c
      ? {
          monthlyBudgetCents: c.monthly_budget_cents,
          weeklyCapacity: c.weekly_capacity,
          blackoutDates: c.blackout_dates,
          hasLegalNotes: Boolean(c.legal_notes),
          hasCashFlowNote: Boolean(c.cash_flow_note),
        }
      : null,
    memoryByKind: memory.rows,
    outcomeCoverage: coverage,
    latestDiagnostics: diagnostics,
    opportunitiesByStatus: opps.rows,
  };
}

exports.getKnowledge = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_KNOWLEDGE_PAGE");
    if (!brand) return;
    const snapshot = await knowledgeSnapshot(brand.brand_id);
    res.json({ enabled: true, knowledge: snapshot });
  } catch (err) {
    next(err);
  }
};

/** Plain-JSON export the owner can download ("my data, readable"). */
exports.exportKnowledge = async (req, res, next) => {
  try {
    const brand = await requireEnabledBrand(req, res, "SAGE_V2_KNOWLEDGE_PAGE");
    if (!brand) return;
    const snapshot = await knowledgeSnapshot(brand.brand_id);
    const [items, opps, decisions] = await Promise.all([
      db.query(
        `SELECT source, source_type, confidence, summary, why_it_matters, url, created_at
           FROM sage_intel_items
          WHERE brand_id = $1 AND dismissed_at IS NULL
          ORDER BY created_at DESC LIMIT 500`,
        [brand.brand_id],
      ),
      db.query(
        `SELECT title, thesis, category, confidence, status, expected_impact_cents, impact_basis,
                effort, risk, recommended_department, constraint_flags, rationale, measured_result,
                lesson, created_at, decided_at
           FROM sage_opportunities WHERE brand_id = $1 ORDER BY created_at DESC LIMIT 200`,
        [brand.brand_id],
      ),
      db.query(
        `SELECT decided, decision_via, why, executed, measured_result, outcome, lesson, created_at
           FROM sage_decisions WHERE brand_id = $1 ORDER BY created_at DESC LIMIT 200`,
        [brand.brand_id],
      ),
    ]);
    res.setHeader("Content-Disposition", `attachment; filename="sage-knowledge-${brand.brand_id}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      brand: { name: brand.brand_name },
      snapshot,
      intelItems: items.rows,
      opportunities: opps.rows,
      decisions: decisions.rows,
    });
  } catch (err) {
    next(err);
  }
};

exports._testables = { knowledgeSnapshot, requireEnabledBrand, OPEN_STATUSES };
