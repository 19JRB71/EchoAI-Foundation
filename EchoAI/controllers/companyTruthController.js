/**
 * Company Truth controller — Phase 1-2 of the chain-of-command spec.
 *
 * Sage builds a versioned Company Intelligence Report from the brand's real
 * data. The owner must Approve, Edit, or Request additional research. Nothing
 * becomes the authoritative "Company Truth" (consumable by other departments
 * via getApprovedCompanyTruth) until the owner explicitly approves it.
 *
 * Honesty invariants:
 * - Generation is grounded in real gathered data; AI/provider failures -> 502.
 * - A failed generation deletes its claim row — no half-built report lingers.
 * - Approval is an atomic status flip (row-count branch); double-clicks and
 *   races can't approve twice or approve a stale draft.
 * - Only ONE approved Truth per brand; older versions become superseded in
 *   the same transaction.
 */

const db = require("../config/db");
const { toJsonbParam } = require("../utils/jsonb");
const { gatherCompanyData, SECTION_KEYS } = require("../utils/companyTruth");
const { generateCompanyReport } = require("../prompts/companyTruthPrompt");

async function getOwnedBrand(userId, brandId) {
  const result = await db.query(
    `SELECT b.*, u.industry
       FROM brands b JOIN users u ON u.user_id = b.user_id
      WHERE b.brand_id = $1 AND b.user_id = $2`,
    [brandId, userId],
  );
  return result.rows[0] || null;
}

function sendError(res, err, fallbackMsg) {
  if (err && (err.aiInvalid || (typeof err.status === "number" && err.status >= 400))) {
    return res.status(502).json({
      error: "Sage could not complete the company research right now. Please try again shortly.",
    });
  }
  console.error("Company Truth error:", err.message);
  return res.status(500).json({ error: fallbackMsg });
}

/**
 * A 'generating' claim older than this is dead: generation runs in-request
 * with a hard AI timeout well under this, so a fresh claim can't be this old.
 * It means the process was killed mid-run (deploy/crash) and the catch-block
 * cleanup never executed — without a rescue the 409 lock is permanent.
 */
const STALE_CLAIM_MINUTES = 10;

function isFreshClaim(row) {
  return (
    row.status === "generating" &&
    Date.now() - new Date(row.created_at).getTime() < STALE_CLAIM_MINUTES * 60 * 1000
  );
}

function reportView(row) {
  if (!row) return null;
  return {
    reportId: row.report_id,
    version: row.version,
    status: row.status,
    plainSummary: row.plain_summary,
    report: row.report || null,
    sources: row.sources || null,
    researchRequest: row.research_request || null,
    editLog: row.edit_log || [],
    generatedAt: row.generated_at,
    approvedAt: row.approved_at,
  };
}

/** GET /api/company-truth?brandId= — approved + pending + history. */
async function getState(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const { rows } = await db.query(
      `SELECT * FROM company_truth_reports
        WHERE brand_id = $1 ORDER BY version DESC LIMIT 20`,
      [brand.brand_id],
    );
    return res.json({
      approved: reportView(rows.find((r) => r.status === "approved") || null),
      pending: reportView(rows.find((r) => r.status === "pending_approval") || null),
      generating: rows.some(isFreshClaim),
      lastError: rows.find((r) => r.status === "failed")?.error_message || null,
      history: rows
        .filter((r) => r.status === "superseded")
        .map((r) => ({ version: r.version, approvedAt: r.approved_at })),
    });
  } catch (err) {
    return sendError(res, err, "Failed to load the Company Truth.");
  }
}

/**
 * Background worker: gathers real data, runs Sage, and atomically promotes the
 * claim to pending_approval (retiring any prior pending draft). On ANY failure
 * the claim flips to status='failed' with an owner-readable error_message —
 * status-guarded so an out-of-band delete/supersede can't be resurrected.
 * Runs OUTSIDE the request so proxy timeouts and page navigation can't kill it.
 */
async function runGeneration(brand, claimId, researchNote) {
  try {
    // Outstanding research request from the current pending draft (if any).
    const pendingQ = await db.query(
      `SELECT report_id, research_request FROM company_truth_reports
        WHERE brand_id = $1 AND status = 'pending_approval'`,
      [brand.brand_id],
    );
    const researchRequest = pendingQ.rows[0]?.research_request || researchNote || null;

    const gathered = await gatherCompanyData(brand);
    const report = await generateCompanyReport(brand, gathered, researchRequest);

    // Atomically retire the old pending draft and promote the fresh one.
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      if (pendingQ.rows[0]) {
        await client.query("DELETE FROM company_truth_reports WHERE report_id = $1", [
          pendingQ.rows[0].report_id,
        ]);
      }
      const updated = await client.query(
        `UPDATE company_truth_reports
            SET status = 'pending_approval', report = $1::jsonb, plain_summary = $2,
                sources = $3::jsonb, research_request = NULL, generated_at = NOW()
          WHERE report_id = $4 AND status = 'generating'
          RETURNING report_id`,
        [
          toJsonbParam(report.sections),
          report.plainSummary,
          toJsonbParam(
            gathered.sources.map((s) => ({
              name: s.name,
              available: s.available,
              ...(s.available ? {} : { error: s.error }),
            })),
          ),
          claimId,
        ],
      );
      await client.query("COMMIT");
      if (!updated.rows.length) {
        // Claim vanished out-of-band (superseded/deleted) — nothing to present.
        console.warn(`Company Truth: run for claim ${claimId} was superseded out-of-band; result discarded.`);
      }
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    const friendly =
      err && (err.aiInvalid || (typeof err.status === "number" && err.status >= 400))
        ? "Sage could not complete the company research right now. Please try again shortly."
        : "Something went wrong while building the report. Please try again.";
    console.error("Company Truth generation failed:", err.message);
    // Status-guarded flip: never resurrect a claim removed out-of-band.
    await db
      .query(
        `UPDATE company_truth_reports SET status = 'failed', error_message = $1
          WHERE report_id = $2 AND status = 'generating'`,
        [friendly, claimId],
      )
      .catch(() => {});
  }
}

// Last background run — awaited by tests; never blocks requests.
let lastRunPromise = Promise.resolve();

/**
 * POST /api/company-truth/generate { brandId }
 * Claims the one-generating slot and responds 202 immediately; the actual
 * research runs in the background (see runGeneration). The client polls
 * GET /api/company-truth until generating flips false.
 */
async function generate(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.body.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    // Sweep prior failed runs (their error was already shown) and rescue any
    // claim left behind by a killed process (deploy/crash) — without this the
    // brand's research would be blocked forever with a 409.
    const rescued = await db.query(
      `DELETE FROM company_truth_reports
        WHERE brand_id = $1
          AND (status = 'failed'
               OR (status = 'generating'
                   AND created_at < NOW() - INTERVAL '${STALE_CLAIM_MINUTES} minutes'))`,
      [brand.brand_id],
    );
    if (rescued.rowCount > 0) {
      console.warn(
        `Company Truth: swept ${rescued.rowCount} failed/stale claim row(s) for brand ${brand.brand_id}.`,
      );
    }

    // Claim the single in-flight generation slot (partial unique index).
    let claim;
    try {
      claim = await db.query(
        `INSERT INTO company_truth_reports (brand_id, version, status)
         VALUES ($1, (SELECT COALESCE(MAX(version), 0) + 1 FROM company_truth_reports WHERE brand_id = $1), 'generating')
         RETURNING report_id, version`,
        [brand.brand_id],
      );
    } catch (e) {
      if (e.code === "23505") {
        return res.status(409).json({ error: "Sage is already researching this company. Give it a moment." });
      }
      throw e;
    }

    lastRunPromise = runGeneration(brand, claim.rows[0].report_id, req.body.researchNote || null);
    return res.status(202).json({ generating: true });
  } catch (err) {
    return sendError(res, err, "Failed to start the company research.");
  }
}

/** POST /api/company-truth/approve { brandId } — atomic approve + supersede. */
async function approve(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.body.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      // Supersede the old Truth first (one_approved unique index).
      await client.query(
        `UPDATE company_truth_reports SET status = 'superseded'
          WHERE brand_id = $1 AND status = 'approved'`,
        [brand.brand_id],
      );
      const flipped = await client.query(
        `UPDATE company_truth_reports
            SET status = 'approved', approved_at = NOW()
          WHERE brand_id = $1 AND status = 'pending_approval'
          RETURNING *`,
        [brand.brand_id],
      );
      if (!flipped.rows.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "There is no report awaiting approval." });
      }
      await client.query("COMMIT");
      return res.json({ approved: reportView(flipped.rows[0]) });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    return sendError(res, err, "Failed to approve the report.");
  }
}

/** PATCH /api/company-truth/report { brandId, section, content } — owner edit of the pending draft. */
async function editSection(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.body.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const { section } = req.body;
    let { content } = req.body;
    if (!SECTION_KEYS.includes(section)) {
      return res.status(400).json({ error: "Unknown report section." });
    }
    if (Array.isArray(content)) {
      content = content.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
    } else if (typeof content === "string") {
      content = content.trim();
    } else {
      content = "";
    }
    if (!content.length && section !== "missingInformation") {
      return res.status(400).json({ error: "The section content cannot be empty." });
    }
    const { rows } = await db.query(
      `UPDATE company_truth_reports
          SET report = jsonb_set(report, ARRAY[$1], $2::jsonb),
              edit_log = edit_log || $3::jsonb
        WHERE brand_id = $4 AND status = 'pending_approval'
        RETURNING *`,
      [
        section,
        toJsonbParam(content),
        toJsonbParam([{ section, at: new Date().toISOString() }]),
        brand.brand_id,
      ],
    );
    if (!rows.length) return res.status(409).json({ error: "There is no report awaiting approval." });
    return res.json({ pending: reportView(rows[0]) });
  } catch (err) {
    return sendError(res, err, "Failed to save your edit.");
  }
}

/** POST /api/company-truth/research { brandId, note } — request additional research. */
async function requestResearch(req, res) {
  try {
    const brand = await getOwnedBrand(req.user.userId, req.body.brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const note = typeof req.body.note === "string" ? req.body.note.trim() : "";
    if (!note) return res.status(400).json({ error: "Tell Sage what to research." });
    const { rows } = await db.query(
      `UPDATE company_truth_reports SET research_request = $1
        WHERE brand_id = $2 AND status = 'pending_approval'
        RETURNING report_id`,
      [note.slice(0, 2000), brand.brand_id],
    );
    if (!rows.length) return res.status(409).json({ error: "There is no report awaiting approval." });
    return res.json({ ok: true });
  } catch (err) {
    return sendError(res, err, "Failed to record the research request.");
  }
}

/**
 * The authoritative Company Truth for a brand, or null when none is approved.
 * Layer 2 injects this into every department's AI context — callers must treat
 * null as "no approved Truth yet", never substitute unapproved drafts.
 */
async function getApprovedCompanyTruth(brandId) {
  const { rows } = await db.query(
    `SELECT * FROM company_truth_reports
      WHERE brand_id = $1 AND status = 'approved'`,
    [brandId],
  );
  return reportView(rows[0] || null);
}

/** Test hook: await the most recent background generation run. */
function waitForLastRun() {
  return lastRunPromise;
}

module.exports = {
  getState,
  generate,
  waitForLastRun,
  approve,
  editSection,
  requestResearch,
  getApprovedCompanyTruth,
};
