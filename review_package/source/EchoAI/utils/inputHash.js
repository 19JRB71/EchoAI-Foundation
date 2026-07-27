/**
 * Input-hash skip gates (Sage V2 Phase 2, W4: unchanged inputs => zero AI calls).
 *
 * A recurring AI job computes a stable SHA-256 over its material inputs and
 * compares it to the last recorded hash for (job_type, brand). Unchanged =>
 * the job records 'skipped_unchanged' and makes no AI calls. Any failure to
 * compute/read/store hashes FAILS OPEN: the job runs. Cost is the only thing
 * at risk from a broken gate — staleness never is.
 *
 * Behind SAGE_V2_SKIP_GATES (default OFF => shouldRun always says run).
 */

const crypto = require("crypto");
const db = require("../config/db");
const { getSwitch } = require("../config/aiControls");

/** Deterministic JSON: object keys sorted recursively so hashing is stable. */
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function computeInputHash(inputs) {
  return crypto.createHash("sha256").update(stableStringify(inputs)).digest("hex");
}

/**
 * Decide whether a recurring AI job needs to run.
 * Returns { run, hash, reason }:
 *   run=true  — proceed (gate off, inputs changed, no prior hash, or gate error)
 *   run=false — inputs identical to the last successful run; caller must
 *               record the skip (recordRun with status 'skipped_unchanged').
 */
async function shouldRun(jobType, brandId, inputs) {
  let hash = null;
  try {
    if (!(await getSwitch("SAGE_V2_SKIP_GATES"))) {
      return { run: true, hash: null, reason: "gate_off" };
    }
    hash = computeInputHash(inputs);
    const r = await db.query(
      `SELECT last_hash FROM sage_job_hashes
        WHERE job_type = $1 AND COALESCE(brand_id::text, 'global') = COALESCE($2::text, 'global')
          AND last_status IN ('done', 'skipped_unchanged')`,
      [jobType, brandId || null],
    );
    const prior = r.rows[0];
    if (prior && prior.last_hash === hash) {
      return { run: false, hash, reason: "unchanged" };
    }
    return { run: true, hash, reason: prior ? "changed" : "first_run" };
  } catch (err) {
    // Fail open: a broken gate must never stop real work.
    console.error(`inputHash.shouldRun(${jobType}) failed open:`, err.message);
    return { run: true, hash, reason: "gate_error" };
  }
}

/** Record the outcome of a gated run (best-effort; failures never throw). */
async function recordRun(jobType, brandId, hash, status) {
  if (!hash) return;
  try {
    await db.query(
      `INSERT INTO sage_job_hashes (job_type, brand_id, last_hash, last_run_at, last_status)
       VALUES ($1, $2, $3, NOW(), $4)
       ON CONFLICT (job_type, COALESCE(brand_id::text, 'global'))
       DO UPDATE SET last_hash = $3, last_run_at = NOW(), last_status = $4`,
      [jobType, brandId || null, hash, status || "done"],
    );
  } catch (err) {
    console.error(`inputHash.recordRun(${jobType}) failed:`, err.message);
  }
}

module.exports = { computeInputHash, stableStringify, shouldRun, recordRun };
