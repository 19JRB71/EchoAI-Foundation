/**
 * Sage job queue (Sage V2 Phase 2, W7: horizontal headroom).
 *
 * Behind SAGE_V2_JOB_QUEUE (default OFF => scheduler keeps its direct in-loop
 * execution). When ON, scheduler ticks ENQUEUE per-brand work rows and a
 * drain step CLAIMS them one at a time with FOR UPDATE SKIP LOCKED, so
 * overlapping ticks (or, later, multiple processes) can never double-run a
 * job. Rows are unique per (job_type, brand, run_key) — re-enqueueing the
 * same bucket is a no-op.
 *
 * Stale-claim rescue (house pattern): a 'running' row untouched for longer
 * than the rescue window is marked failed with an owner-traceable error —
 * NEVER silently retried (double-AI-spend / double-alert risk).
 */

const db = require("../config/db");
const { getSwitch } = require("../config/aiControls");

const STALE_RUNNING_MINUTES = 30;

async function enabled() {
  return getSwitch("SAGE_V2_JOB_QUEUE");
}

/** Idempotent enqueue. Returns true when this call created the row. */
async function enqueue(jobType, brandId, runKey) {
  const r = await db.query(
    `INSERT INTO sage_job_queue (job_type, brand_id, run_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (job_type, COALESCE(brand_id::text, 'global'), run_key) DO NOTHING
     RETURNING job_id`,
    [jobType, brandId || null, runKey],
  );
  return Boolean(r.rows[0]);
}

/**
 * Claim the oldest queued job (optionally filtered by type) atomically.
 * Returns the claimed row or null. FOR UPDATE SKIP LOCKED + transaction so
 * concurrent drainers never claim the same row.
 */
async function claimNext(jobType) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const filter = jobType ? "AND job_type = $1" : "";
    const params = jobType ? [jobType] : [];
    const r = await client.query(
      `SELECT job_id, job_type, brand_id, run_key
         FROM sage_job_queue
        WHERE status = 'queued' ${filter}
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      params,
    );
    const row = r.rows[0];
    if (!row) {
      await client.query("COMMIT");
      return null;
    }
    await client.query(
      `UPDATE sage_job_queue SET status = 'running', claimed_at = NOW()
        WHERE job_id = $1`,
      [row.job_id],
    );
    await client.query("COMMIT");
    return row;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Finish a claimed job. status: done | failed | skipped_unchanged. */
async function finish(jobId, status, { error = null, inputHash = null } = {}) {
  await db.query(
    `UPDATE sage_job_queue
        SET status = $2, finished_at = NOW(), error = $3,
            input_hash = COALESCE($4, input_hash)
      WHERE job_id = $1 AND status = 'running'`,
    [jobId, status, error, inputHash],
  );
}

/**
 * Rescue sweep: 'running' rows stuck past the window are marked failed with a
 * traceable message. Never re-queued (the work may have partially happened).
 */
async function rescueStaleClaims() {
  const r = await db.query(
    `UPDATE sage_job_queue
        SET status = 'failed', finished_at = NOW(),
            error = 'Interrupted: claim went stale (worker restart or crash) — not retried automatically'
      WHERE status = 'running'
        AND claimed_at < NOW() - INTERVAL '${STALE_RUNNING_MINUTES} minutes'
      RETURNING job_id, job_type, brand_id`,
  );
  return r.rows;
}

/**
 * Drain up to `limit` queued jobs of a type through `handler(job)`.
 * Handler errors mark THAT row failed and the drain continues (sweep-guard
 * seam: one bad brand can never starve the rest).
 */
async function drain(jobType, handler, limit = 50) {
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    const job = await claimNext(jobType);
    if (!job) break;
    try {
      const result = await handler(job);
      await finish(
        job.job_id,
        result && result.skipped ? "skipped_unchanged" : "done",
        { inputHash: result && result.inputHash ? result.inputHash : null },
      );
    } catch (err) {
      await finish(job.job_id, "failed", { error: String(err.message || err).slice(0, 500) }).catch(
        () => {},
      );
    }
    processed++;
  }
  return processed;
}

module.exports = {
  enabled,
  enqueue,
  claimNext,
  finish,
  drain,
  rescueStaleClaims,
  STALE_RUNNING_MINUTES,
};
