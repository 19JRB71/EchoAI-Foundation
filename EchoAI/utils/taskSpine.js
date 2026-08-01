require("dotenv").config();

/**
 * Task spine (Prompt 009) — the canonical agent_tasks / agent_task_events
 * writer. The spine RECORDS truth about work the features already do; it
 * never changes their behavior (Stage-1 commitment C).
 *
 * Binding rules (Stage-2 authorization):
 *  1. TRANSACTIONAL PAIRING — every state transition and its trail event are
 *     written in ONE database transaction: no task advance without its event,
 *     no event without its task state. transition()/createTask()/
 *     attachEvidence() accept an optional caller transaction client; when the
 *     caller passes one, the statements join the caller's transaction (the
 *     caller owns BEGIN/COMMIT/ROLLBACK); otherwise the spine opens its own.
 *  2. RECONCILIATION — the deterministic repair path is discoverable by the
 *     periodic scan (scanForMissingTasks): feature rows carrying provider IDs
 *     with no matching canonical task are rebuilt via reconstructTrail().
 *     Write-time reconciliation (a MANUAL_REVIEW reconciliation task created
 *     the moment a spine write fails after provider success) is the fast
 *     path only — correctness never depends on it.
 *  3. A successful provider action is NEVER retried because a spine write
 *     failed (Addendum F). reconstructTrail never touches the provider.
 *
 * Every adopter call goes through safeSpine(): spine failures are logged and
 * swallowed so recording can never break publishing.
 */

const db = require("../config/db");
const { redactEvidence } = require("./externalProofs");

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const STATES = [
  "DRAFTED",
  "REVIEWED",
  "APPROVED",
  "QUEUED",
  "EXECUTING",
  "PROVIDER_ACCEPTED",
  "EXTERNALLY_VERIFIED",
  "REPORTED",
  "COMPLETED",
  "RETRY_SCHEDULED",
  "AUTH_REQUIRED",
  "PERMISSION_DENIED",
  "RATE_LIMITED",
  "VALIDATION_FAILED",
  "EXTERNAL_FAILURE",
  "MANUAL_REVIEW",
  "CANCELLED",
];

const FAILURE_STATES = [
  "AUTH_REQUIRED",
  "PERMISSION_DENIED",
  "RATE_LIMITED",
  "VALIDATION_FAILED",
  "EXTERNAL_FAILURE",
];

const TERMINAL_STATES = ["COMPLETED", "CANCELLED"];

/**
 * Legal-transition table, keyed by TARGET state -> legal SOURCE states.
 * Anything not listed throws in transition(). Explicit per the Stage-2
 * authorization (addition 3):
 *   - CANCELLED is reachable from every pre-execution state (DRAFTED,
 *     REVIEWED, APPROVED, QUEUED — owner deletes/reschedules before the
 *     sweep) and from RETRY_SCHEDULED, the failure states, and
 *     MANUAL_REVIEW.
 *   - MANUAL_REVIEW's legal sources are exactly: EXECUTING (stale-publishing
 *     rescue), PROVIDER_ACCEPTED (Addendum-F reconciliation / failed
 *     verification of an accepted publish), RETRY_SCHEDULED (rescue of a
 *     stranded retry).
 *   - PROVIDER_ACCEPTED -> REPORTED is legal ONLY with
 *     meta.verification === 'unavailable' (enforced in code below): the
 *     trail never claims verification that did not happen.
 * The table may gain edges in Prompts 018/019; it is not frozen.
 */
const LEGAL_SOURCES = {
  REVIEWED: ["DRAFTED"],
  APPROVED: ["REVIEWED"],
  QUEUED: ["APPROVED", "RETRY_SCHEDULED", ...FAILURE_STATES, "MANUAL_REVIEW"],
  EXECUTING: ["QUEUED"],
  PROVIDER_ACCEPTED: ["EXECUTING"],
  EXTERNALLY_VERIFIED: ["PROVIDER_ACCEPTED"],
  REPORTED: ["EXTERNALLY_VERIFIED", "PROVIDER_ACCEPTED"],
  COMPLETED: ["REPORTED"],
  RETRY_SCHEDULED: ["EXECUTING"],
  AUTH_REQUIRED: ["EXECUTING"],
  PERMISSION_DENIED: ["EXECUTING"],
  RATE_LIMITED: ["EXECUTING"],
  VALIDATION_FAILED: ["EXECUTING"],
  EXTERNAL_FAILURE: ["EXECUTING"],
  MANUAL_REVIEW: ["EXECUTING", "PROVIDER_ACCEPTED", "RETRY_SCHEDULED"],
  CANCELLED: [
    "DRAFTED",
    "REVIEWED",
    "APPROVED",
    "QUEUED",
    "RETRY_SCHEDULED",
    ...FAILURE_STATES,
    "MANUAL_REVIEW",
  ],
};

function legalSourcesFor(to, meta) {
  const sources = LEGAL_SOURCES[to];
  if (!sources) {
    throw new Error(`taskSpine: '${to}' is not a legal transition target`);
  }
  if (to === "REPORTED" && !(meta && meta.verification === "unavailable")) {
    // Without an explicit verification-unavailable marker, REPORTED is only
    // reachable through EXTERNALLY_VERIFIED (honesty rule).
    return ["EXTERNALLY_VERIFIED"];
  }
  return sources;
}

// ---------------------------------------------------------------------------
// Transaction plumbing
// ---------------------------------------------------------------------------

/**
 * Runs fn(client) inside a transaction. If the caller supplied a client, the
 * statements join the CALLER's transaction — the caller owns commit/rollback
 * (a thrown error propagates so the caller rolls everything back together).
 * Otherwise the spine opens its own client and BEGIN/COMMIT/ROLLBACK here.
 */
async function withTx(callerClient, fn) {
  if (callerClient) return fn(callerClient);
  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      /* connection-level failure; nothing more to do */
    }
    throw err;
  } finally {
    client.release();
  }
}

function cleanMeta(meta) {
  return redactEvidence(meta && typeof meta === "object" ? meta : {});
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Get-or-create the canonical task for a source (Addendum G).
 *
 * Semantics: if the latest task row for (taskType, sourceType, sourceId) is
 * NOT terminal, it is returned as-is (retries of the same attempt reuse the
 * row). If it is terminal (CANCELLED predecessor — e.g. calendar
 * re-activation) a NEW row with attempt = max(attempt)+1 is created. The
 * INSERT and its creation event share one transaction; a 23505 race loses to
 * the concurrent creator and returns the winner's row.
 *
 * Returns { task, created }.
 */
async function createTask({
  client = null,
  brandId,
  userId,
  taskType = "social_publish",
  sourceType = "social_post",
  sourceId,
  title,
  status = "APPROVED",
  actor,
  meta = {},
}) {
  if (!brandId || !userId || !sourceId || !title || !actor) {
    throw new Error("taskSpine.createTask: brandId, userId, sourceId, title, actor are required");
  }
  if (!STATES.includes(status)) {
    throw new Error(`taskSpine.createTask: unknown status '${status}'`);
  }
  const source = String(sourceId);

  return withTx(client, async (c) => {
    const existing = await c.query(
      `SELECT * FROM agent_tasks
        WHERE task_type = $1 AND source_type = $2 AND source_id = $3
        ORDER BY attempt DESC LIMIT 1`,
      [taskType, sourceType, source]
    );
    if (existing.rows.length > 0 && !TERMINAL_STATES.includes(existing.rows[0].status)) {
      return { task: existing.rows[0], created: false };
    }
    const attempt = existing.rows.length > 0 ? existing.rows[0].attempt + 1 : 1;
    const inserted = await c.query(
      `INSERT INTO agent_tasks
         (brand_id, user_id, task_type, source_type, source_id, attempt, status, title, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT ON CONSTRAINT agent_tasks_source_attempt_unique DO NOTHING
       RETURNING *`,
      [brandId, userId, taskType, sourceType, source, attempt, status, title, JSON.stringify(cleanMeta(meta))]
    );
    if (inserted.rows.length === 0) {
      // Lost a concurrent-create race: return the winner's row.
      const winner = await c.query(
        `SELECT * FROM agent_tasks
          WHERE task_type = $1 AND source_type = $2 AND source_id = $3 AND attempt = $4`,
        [taskType, sourceType, source, attempt]
      );
      return { task: winner.rows[0], created: false };
    }
    const task = inserted.rows[0];
    // Creation event — same transaction as the row (pairing rule).
    await c.query(
      `INSERT INTO agent_task_events (task_id, actor, from_status, to_status, meta)
       VALUES ($1, $2, NULL, $3, $4)`,
      [task.task_id, actor, status, JSON.stringify(cleanMeta(meta))]
    );
    return { task, created: true };
  });
}

/**
 * Resolves the latest task row for a source, or null.
 */
async function findTaskBySource({ taskType = "social_publish", sourceType = "social_post", sourceId }, client = null) {
  const runner = client || db;
  const { rows } = await runner.query(
    `SELECT * FROM agent_tasks
      WHERE task_type = $1 AND source_type = $2 AND source_id = $3
      ORDER BY attempt DESC LIMIT 1`,
    [taskType, sourceType, String(sourceId)]
  );
  return rows[0] || null;
}

/**
 * State transition. ONE transaction: status-guarded UPDATE (WHERE status is a
 * legal source of `to`) + the trail event. Semantics:
 *   - Unknown/illegal TARGET state throws immediately.
 *   - Guarded UPDATE hit -> the event is appended with the real from_status
 *     and the updated task row is returned.
 *   - Guarded UPDATE miss (the row already moved / is not in a legal source
 *     state) -> returns null. Recorder semantics: the spine never fights the
 *     feature's own atomic claims.
 *
 * Accepts either { taskId } or { bySource: { taskType?, sourceType?, sourceId } }.
 * Optional extras written on the task row: externalRef, proofId, lastError.
 */
async function transition({
  client = null,
  taskId = null,
  bySource = null,
  to,
  actor,
  meta = {},
  externalRef = null,
  proofId = null,
  lastError = null,
}) {
  if (!actor) throw new Error("taskSpine.transition: actor is required");
  const sources = legalSourcesFor(to, meta); // throws on illegal target

  return withTx(client, async (c) => {
    let id = taskId;
    if (!id) {
      if (!bySource || !bySource.sourceId) {
        throw new Error("taskSpine.transition: taskId or bySource.sourceId is required");
      }
      const task = await findTaskBySource(bySource, c);
      if (!task) return null;
      id = task.task_id;
    }
    const updated = await c.query(
      `UPDATE agent_tasks t
          SET status = $2,
              updated_at = NOW(),
              external_ref = COALESCE($3, t.external_ref),
              proof_id = COALESCE($4, t.proof_id),
              last_error = COALESCE($5, t.last_error)
         FROM (SELECT task_id, status AS old_status FROM agent_tasks WHERE task_id = $1 FOR UPDATE) o
        WHERE t.task_id = o.task_id AND o.old_status = ANY($6)
        RETURNING t.*, o.old_status`,
      [id, to, externalRef, proofId ? String(proofId) : null, lastError ? String(lastError).slice(0, 500) : null, sources]
    );
    if (updated.rows.length === 0) return null;
    const row = updated.rows[0];
    await c.query(
      `INSERT INTO agent_task_events (task_id, actor, from_status, to_status, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, actor, row.old_status, to, JSON.stringify(cleanMeta(meta))]
    );
    delete row.old_status;
    return row;
  });
}

/**
 * Attaches evidence references (external_ref / proof_id) WITHOUT a state
 * change, recording an evidence event (from = to = current status) in the
 * same transaction. References only, never copies (Stage-1 B5).
 */
async function attachEvidence({ client = null, taskId, externalRef = null, proofId = null, actor, meta = {} }) {
  if (!taskId || !actor) throw new Error("taskSpine.attachEvidence: taskId and actor are required");
  return withTx(client, async (c) => {
    const updated = await c.query(
      `UPDATE agent_tasks
          SET external_ref = COALESCE($2, external_ref),
              proof_id = COALESCE($3, proof_id),
              updated_at = NOW()
        WHERE task_id = $1
        RETURNING *`,
      [taskId, externalRef, proofId ? String(proofId) : null]
    );
    if (updated.rows.length === 0) return null;
    const row = updated.rows[0];
    await c.query(
      `INSERT INTO agent_task_events (task_id, actor, from_status, to_status, meta)
       VALUES ($1, $2, $3, $3, $4)`,
      [taskId, actor, row.status, JSON.stringify(cleanMeta({ event: "evidence", externalRef, proofId, ...meta }))]
    );
    return row;
  });
}

// ---------------------------------------------------------------------------
// safeSpine — recording can never break the feature
// ---------------------------------------------------------------------------

/**
 * Wraps an adopter's spine calls. Any spine failure is logged and swallowed.
 * If opts.providerSucceeded is set (a real provider action already happened),
 * the fast-path write-time reconciliation kicks in: a high-severity
 * MANUAL_REVIEW reconciliation task is created (best-effort — the periodic
 * scan is the guaranteed discovery path, Stage-2 addition 2).
 * NEVER retries the provider action (Addendum F).
 */
async function safeSpine(fn, opts = {}) {
  try {
    return await fn();
  } catch (err) {
    console.error("taskSpine recording failed (feature unaffected):", err.message);
    if (opts.providerSucceeded && opts.source && opts.source.sourceId) {
      try {
        await createTask({
          brandId: opts.source.brandId,
          userId: opts.source.userId,
          taskType: "reconciliation",
          sourceType: opts.source.sourceType || "social_post",
          sourceId: opts.source.sourceId,
          title: `Reconcile: trail write failed after provider success (${opts.source.sourceType || "social_post"} ${opts.source.sourceId})`,
          status: "MANUAL_REVIEW",
          actor: "system:repair",
          meta: { severity: "high", reason: "spine_write_failed_after_provider_success", error: err.message },
        });
      } catch (reconErr) {
        // The periodic scan remains the guaranteed discovery path.
        console.error("taskSpine write-time reconciliation also failed (scan will catch it):", reconErr.message);
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Deterministic repair path (Addendum F) + periodic discovery scan (Stage-2
// addition 2)
// ---------------------------------------------------------------------------

/**
 * Rebuilds the missing canonical task + trail for a social post from what the
 * database already knows (social_posts row + any external_proofs rows).
 * Never touches the provider, never republishes. Actor: system:repair.
 * Returns the task row or null (e.g. draft posts are out of scope).
 */
async function reconstructTrail({ sourceType = "social_post", sourceId }) {
  if (sourceType !== "social_post") {
    throw new Error(`taskSpine.reconstructTrail: unsupported sourceType '${sourceType}'`);
  }
  const { rows } = await db.query(
    `SELECT sp.*, b.user_id AS owner_user_id
       FROM social_posts sp
       JOIN brands b ON b.brand_id = sp.brand_id
      WHERE sp.post_id = $1`,
    [sourceId]
  );
  const post = rows[0];
  if (!post || post.status === "draft") return null;

  const actor = "system:repair";
  const title = `Publish to ${post.platform}: ${String(post.post_content || "").slice(0, 80)}`;
  const meta = { reconstructed: true, post_status: post.status };

  const { task } = await createTask({
    brandId: post.brand_id,
    userId: post.owner_user_id,
    sourceId: String(post.post_id),
    title,
    status: "APPROVED",
    actor,
    meta,
  });
  // If the existing task is already beyond APPROVED (partial trail), the
  // guarded transitions below simply no-op where already recorded.
  const step = (to, extra = {}) =>
    transition({ taskId: task.task_id, to, actor, meta: { ...meta, ...extra.meta }, ...extra });

  await step("QUEUED");
  if (post.status === "scheduled") return task;
  await step("EXECUTING");
  if (post.status === "publishing") return task;

  if (post.status === "published") {
    await step("PROVIDER_ACCEPTED", { externalRef: post.external_post_id || null });
    // Any existing proof row for this post is referenced, never copied.
    const proofs = await db.query(
      `SELECT proof_id FROM external_proofs
        WHERE external_id = $1 AND provider = $2
        ORDER BY created_at ASC LIMIT 1`,
      [String(post.external_post_id || ""), post.platform]
    );
    if (proofs.rows.length > 0) {
      await step("EXTERNALLY_VERIFIED", { proofId: proofs.rows[0].proof_id });
      await step("REPORTED");
    } else {
      // Honesty rule: reconstruction cannot claim a verification that never
      // happened; REPORTED carries the explicit unavailable marker.
      await step("REPORTED", { meta: { verification: "unavailable", reason: "reconstructed" } });
    }
    await step("COMPLETED");
    return task;
  }

  if (post.status === "failed") {
    const storedError =
      (post.engagement_metrics && post.engagement_metrics.error) || "Publish failed (reconstructed)";
    await step("EXTERNAL_FAILURE", { lastError: storedError, meta: { error: storedError } });
    return task;
  }
  return task;
}

/**
 * Periodic discovery scan (Stage-2 addition 2): finds recent social_posts
 * that carry a provider id (or a terminal publish outcome) but have NO
 * matching canonical task row, and repairs each via reconstructTrail. The
 * repair path never depends on the write-time reconciliation row having been
 * written. Lookback-windowed (default 48h) — no historical backfill (Stage-1:
 * rows start from Prompt 009 onward). Demo brands are excluded.
 */
async function scanForMissingTasks({ lookbackHours = 48, limit = 100 } = {}) {
  const { rows } = await db.query(
    `SELECT sp.post_id
       FROM social_posts sp
       JOIN brands b ON b.brand_id = sp.brand_id AND b.is_demo = false
      WHERE sp.updated_at >= NOW() - make_interval(hours => $1)
        AND (sp.external_post_id IS NOT NULL OR sp.status IN ('published', 'failed'))
        AND NOT EXISTS (
          SELECT 1 FROM agent_tasks t
           WHERE t.task_type = 'social_publish'
             AND t.source_type = 'social_post'
             AND t.source_id = sp.post_id::text
        )
      ORDER BY sp.updated_at ASC
      LIMIT $2`,
    [lookbackHours, limit]
  );
  let repaired = 0;
  for (const row of rows) {
    // Per-iteration guard: one bad row never aborts the sweep.
    try {
      await module.exports.repairOne(row.post_id);
      repaired += 1;
    } catch (err) {
      console.error(`taskSpine scan: repair failed for post ${row.post_id}:`, err.message);
    }
  }
  if (rows.length > 0) {
    console.log(`taskSpine scan: repaired ${repaired}/${rows.length} missing trail(s).`);
  }
  return { found: rows.length, repaired };
}

/** Seam for tests + the per-row guard. */
async function repairOne(postId) {
  return reconstructTrail({ sourceType: "social_post", sourceId: postId });
}

module.exports = {
  STATES,
  FAILURE_STATES,
  TERMINAL_STATES,
  LEGAL_SOURCES,
  createTask,
  findTaskBySource,
  transition,
  attachEvidence,
  safeSpine,
  reconstructTrail,
  scanForMissingTasks,
  repairOne,
};
