require("dotenv").config();

/**
 * Prompt 020 — executeExternal(): the ONE canonical execution gateway for
 * external side-effects (D-30 §11). Adopted flows (social publish, ad launch,
 * email send) never call their provider directly any more — every provider
 * mutation runs through here so idempotency, classified retry, the attempt
 * ledger, terminal-failure escalation, and owner alerting are implemented
 * exactly once instead of being reinvented per feature (audit docs 09/10).
 *
 * Recorder-not-controller (Owner Addendum §1): the helper records and GUARDS
 * execution. It never changes successful feature behavior — the feature keeps
 * full authority over claims, retry scheduling, batching, and its own row
 * writes. What the helper adds:
 *
 *   - DB-level idempotency (migration 134): a partial unique index allows at
 *     most ONE in_progress/succeeded row per idempotency_key. Firing the same
 *     key twice yields exactly one provider call — the second caller gets the
 *     prior action row back, guaranteed by Postgres, not by application luck.
 *   - Attempt ledger: one external_actions row per attempt, written BEFORE
 *     the provider call and finalized after it, from the provider response
 *     only (never assumed).
 *   - Classified retry (extracted, unchanged, from the publish path's proven
 *     policy): only explicitly transient errors (err.transient === true,
 *     HTTP 429, HTTP >= 500) may be retried, and only when the CALLER says
 *     an attempt remains. Everything else is terminal — retrying an
 *     unclassified error risks double-execution.
 *   - Terminal failures land in the existing MANUAL_REVIEW flow (and thereby
 *     the D-29 Approvals Inbox — the inbox IS the failure queue, §3) and the
 *     owner is alerted once per underlying failure (§5) via the canonical
 *     email spine (§4) plus web push when VAPID is configured (§6).
 *
 * Three-layer boundary (§2) — references only, never duplication:
 *   external_actions  = attempt ledger (this module's table)
 *   agent_task_events = lifecycle (taskSpine)
 *   external_proofs   = provider evidence (recorded by the flow's adopter)
 *
 * Key ownership (D-30 §13): the idempotency key belongs to the CALLER, is
 * created once, and persists for the entire attempt. This module never
 * generates or substitutes a key — a missing key is a programming error and
 * throws before any ledger write or provider call.
 *
 * Bookkeeping never re-executes (D-30 §12): once the provider accepted the
 * request, any local failure (ledger update, spine recording) is repaired by
 * reconciliation only. The succeeded ledger row itself blocks re-execution at
 * the database level.
 *
 * Reconciliation is bookkeeping-only (D-30 §14): reconcileStaleActions()
 * closes rows stranded by a crash; it has no execution capability and throws
 * loudly if anything executable is passed to it.
 */

const db = require("../config/db");
const taskSpine = require("./taskSpine");
const { sendEmail } = require("./email");
const emailSendSpine = require("./emailSendSpine");
const { alertOwnerOfFailedSend } = require("./failedSendAlerts");
const webpushConfig = require("../config/webpush");

const SYSTEM_ACTOR = "system:execute-external";

// How long an in_progress row may sit before the reconciliation sweep closes
// it as 'interrupted' (same 10-minute deadness rule as the publish rescue).
const STALE_ACTION_MINUTES = 10;

/**
 * The proven transient classifier, EXTRACTED verbatim from the social publish
 * path (socialController.isTransientPublishError — Prompt 013 policy, D-30
 * §8: extraction only, behavior unchanged): transient means the provider was
 * never reached (err.transient set by the transport on network-level
 * failures), or the provider itself said "try again" (429 / 5xx). Anything
 * without an explicit signal is NOT transient — it may have executed.
 */
function isTransientProviderError(err) {
  if (err && err.transient === true) return true;
  const status = err && err.statusCode;
  return status === 429 || (typeof status === "number" && status >= 500);
}

/** True when err is the 23505 from the active-key dedup index. */
function isActiveKeyConflict(err) {
  return (
    err &&
    err.code === "23505" &&
    /external_actions_active_key/.test(String(err.constraint || err.message || ""))
  );
}

/**
 * Executes one external side-effect under the ledger + idempotency guard.
 *
 * @param {object} opts
 * @param {string}   opts.idempotencyKey CALLER-owned stable key for the action
 *                   (e.g. 'social_publish:<postId>'). Required; never generated
 *                   here (D-30 §13).
 * @param {string}   opts.provider  'facebook' | 'smtp' | 'twitter' | ...
 * @param {string}   opts.action    'social_publish' | 'ad_launch' | 'email_send'
 * @param {function} opts.execute   async () => providerResult. The ONLY thing
 *                   inside must be the provider call chain — feature
 *                   bookkeeping stays outside so a bookkeeping failure can
 *                   never masquerade as a provider failure (D-30 §12).
 * @param {string}   [opts.taskId]  canonical spine task for this action
 * @param {string}   [opts.brandId] / [opts.userId] tenant references
 * @param {object}   [opts.meta]    ledger metadata (never secrets/addresses)
 * @param {boolean}  [opts.allowTransientRetry=false] the CALLER's statement
 *                   that an attempt remains; with a transient error this marks
 *                   the row failed/transient and the feature's own retry
 *                   machinery (unchanged) schedules the next attempt.
 * @param {string}   [opts.onTerminal='manual_review']  'manual_review' parks
 *                   the task for the owner + alerts once; 'record_only' writes
 *                   the ledger row and leaves failure handling entirely to the
 *                   feature (used where per-item failures are routine, e.g.
 *                   one bad recipient inside a blast).
 * @param {function} [opts.isTransient] classifier override (defaults to the
 *                   extracted publish policy).
 * @param {function} [opts.externalRefOf] providerResult => external reference
 *                   string persisted on the succeeded row.
 *
 * @returns {Promise<{deduplicated:boolean, actionId:string|null, result:any, priorAction:object|null}>}
 *   deduplicated=true means NO provider call was made — priorAction is the
 *   row that already covered this key.
 * @throws the provider error, after recording it (feature handling unchanged).
 */
async function executeExternal({
  idempotencyKey,
  provider,
  action,
  execute,
  taskId = null,
  brandId = null,
  userId = null,
  meta = {},
  allowTransientRetry = false,
  onTerminal = "manual_review",
  isTransient = isTransientProviderError,
  externalRefOf = (r) => (r && (r.externalId || r.messageId || r.id)) || null,
}) {
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
    // §13: the key is the caller's. Never invent one — that would silently
    // disable dedup for exactly the calls that most need it.
    throw new Error("executeExternal: a caller-owned idempotencyKey is required");
  }
  if (typeof execute !== "function") {
    throw new Error("executeExternal: execute() is required");
  }
  if (!provider || !action) {
    throw new Error("executeExternal: provider and action are required");
  }

  // ---- Ledger row BEFORE execution (attempt = prior attempts + 1). --------
  // The insert is the idempotency gate: the active-key unique index admits at
  // most one in_progress/succeeded row per key, so of N concurrent callers
  // exactly one insert wins and executes; the rest observe 23505 and return
  // the prior action WITHOUT a provider call.
  let row = null;
  for (let tries = 0; tries < 3 && !row; tries += 1) {
    try {
      const inserted = await db.query(
        `INSERT INTO external_actions
           (idempotency_key, attempt, provider, action, task_id, brand_id, user_id, meta)
         VALUES (
           $1,
           (SELECT COALESCE(MAX(attempt), 0) + 1 FROM external_actions WHERE idempotency_key = $1),
           $2, $3, $4, $5, $6, $7::jsonb
         )
         RETURNING *`,
        [idempotencyKey, provider, action, taskId, brandId, userId, JSON.stringify(meta)]
      );
      row = inserted.rows[0];
    } catch (err) {
      if (isActiveKeyConflict(err)) {
        // Duplicate fire: someone already executed (or is executing) this key.
        const prior = await db.query(
          `UPDATE external_actions
              SET dedup_count = dedup_count + 1
            WHERE idempotency_key = $1 AND status IN ('in_progress', 'succeeded')
            RETURNING *`,
          [idempotencyKey]
        );
        return {
          deduplicated: true,
          actionId: prior.rows[0] ? prior.rows[0].action_id : null,
          result: null,
          priorAction: prior.rows[0] || null,
        };
      }
      // (key, attempt) collision from a concurrent failed-attempt race —
      // recompute attempt and try again; any other error is fatal.
      if (!(err.code === "23505" && tries < 2)) throw err;
    }
  }
  if (!row) throw new Error("executeExternal: could not create a ledger row");

  // ---- The provider call — exactly once per attempt. ----------------------
  let result;
  try {
    result = await execute();
  } catch (err) {
    const transient = Boolean(isTransient(err)) && allowTransientRetry;
    const classification = transient ? "transient" : "terminal";
    try {
      await db.query(
        `UPDATE external_actions
            SET status = 'failed', classification = $2, error = $3, finished_at = NOW()
          WHERE action_id = $1`,
        [row.action_id, classification, String(err.message || err).slice(0, 2000)]
      );
    } catch (ledgerErr) {
      console.error("executeExternal: failed-attempt ledger write failed:", ledgerErr.message);
    }
    err.externalActionId = row.action_id;
    err.classifiedTransient = transient;
    if (!transient && onTerminal === "manual_review") {
      await escalateTerminalFailure({ row, taskId, brandId, userId, error: err });
    }
    throw err; // the feature's own failure handling proceeds unchanged
  }

  // ---- Outcome recorded only from the provider response (D-30 §12): a ----
  // bookkeeping failure here never re-executes and never masks the success.
  try {
    await db.query(
      `UPDATE external_actions
          SET status = 'succeeded', external_ref = $2, finished_at = NOW()
        WHERE action_id = $1`,
      [row.action_id, externalRefOf(result)]
    );
  } catch (ledgerErr) {
    console.error(
      `executeExternal: success ledger write failed for ${row.action_id} ` +
        "(provider action DID happen; reconciliation will repair the row):",
      ledgerErr.message
    );
    // Owner-visible repair path, zero provider calls (recorder rule).
    await taskSpine.safeSpine(
      async () => {
        throw ledgerErr;
      },
      {
        providerSucceeded: true,
        source: { sourceType: "external_action", sourceId: row.action_id, brandId, userId },
      }
    );
  }
  return { deduplicated: false, actionId: row.action_id, result, priorAction: null };
}

/**
 * Terminal failure → the existing MANUAL_REVIEW flow (D-29 inbox = the
 * failure queue) + ONE owner alert. Best-effort throughout: escalation can
 * never alter the feature's error path.
 */
async function escalateTerminalFailure({ row, taskId, brandId, userId, error }) {
  // Park the canonical task for the owner. Legal from EXECUTING /
  // PROVIDER_ACCEPTED; a task already in a terminal/failure state is left
  // untouched (guarded transition returns null).
  if (taskId) {
    await taskSpine.safeSpine(async () =>
      taskSpine.transition({
        taskId,
        to: "MANUAL_REVIEW",
        actor: SYSTEM_ACTOR,
        lastError: String(error.message || error).slice(0, 2000),
        meta: {
          reason: "external_execution_failed",
          external_action_id: row.action_id,
          provider: row.provider,
          action: row.action,
          // Callers may attach evidence (e.g. the ad chain's partial ids) to
          // the thrown error so the D-27 honesty trail survives escalation.
          ...(error && error.partialChain ? { partialChain: error.partialChain } : {}),
        },
      })
    );
  }
  await alertOwnerOnce({ actionId: row.action_id, taskId, brandId, userId, error, row });
}

/**
 * One alert per underlying failure (§5): an atomic CAS on alerted_at decides
 * a single winner; every other path (repeat sweeps, races) loses the CAS and
 * stays silent. Alert failures are logged and NEVER themselves alert (§5).
 * Channels: email through the canonical email spine (§4) + web push only when
 * VAPID is configured (§6 — otherwise honestly skipped, never faked).
 * Alerts are navigation, not a second audit trail (§15): they carry the
 * task_id / external_action_id / proof_id references and a one-line reason.
 */
async function alertOwnerOnce({ actionId, taskId, brandId, userId, error, row }) {
  try {
    const won = await db.query(
      `UPDATE external_actions SET alerted_at = NOW()
        WHERE action_id = $1 AND alerted_at IS NULL
        RETURNING action_id, task_id, proof_id, provider, action`,
      [actionId]
    );
    if (won.rows.length === 0) return false; // someone already alerted

    const act = won.rows[0];
    const reason = String((error && error.message) || "External action failed").slice(0, 200);

    // ---- Email via the canonical spine (recording), transport sendEmail ----
    try {
      const ownerRes = userId
        ? await db.query("SELECT email FROM users WHERE user_id = $1", [userId])
        : { rows: [] };
      const ownerEmail = ownerRes.rows[0] && ownerRes.rows[0].email;
      if (ownerEmail) {
        const alertTaskId = await emailSendSpine.beginSend({
          brandId,
          userId,
          actor: SYSTEM_ACTOR,
          sourceType: "external_action_alert",
          sourceId: actionId,
          title: `Alert owner: ${act.action} failed`,
          meta: { path: "external_action_alert" },
        });
        try {
          const info = await sendEmail({
            to: ownerEmail,
            subject: `Action needed: a ${act.action.replace(/_/g, " ")} failed`,
            html:
              `<p>One of your automated actions could not be completed and needs your attention.</p>` +
              `<p><strong>What happened:</strong> ${reason}</p>` +
              `<p>Open your dashboard&rsquo;s Approvals Inbox to review and resolve it.</p>` +
              `<p style="color:#888;font-size:12px">References — task: ${taskId || "n/a"} · ` +
              `action: ${actionId}${act.proof_id ? ` · proof: ${act.proof_id}` : ""}</p>`,
          });
          await emailSendSpine.recordSendAccepted({
            taskId: alertTaskId,
            brandId,
            userId,
            sourceType: "external_action_alert",
            sourceId: actionId,
            messageIds: info && info.messageId ? [info.messageId] : [],
            counts: { sent: 1, failed: 0 },
            meta: { path: "external_action_alert" },
          });
        } catch (mailErr) {
          // §5: an alert failure is recorded, never re-alerted.
          await emailSendSpine.recordSendFailure({
            taskId: alertTaskId,
            error: mailErr,
            meta: { path: "external_action_alert" },
          });
          console.error("executeExternal: owner alert email failed:", mailErr.message);
        }
      }
    } catch (emailPathErr) {
      console.error("executeExternal: owner alert email path failed:", emailPathErr.message);
    }

    // ---- Web push only if VAPID is configured (§6) --------------------------
    if (webpushConfig.isConfigured && brandId) {
      await alertOwnerOfFailedSend({
        brandId,
        title: "⚠️ An automated action failed",
        buildBody: (brand) => `${brand.brand_name}: ${reason} Tap to review in your Approvals Inbox.`,
        url: "/dashboard?section=approvals",
        tag: `external-action-${actionId}`,
        mobileData: { type: "external_action_failed", actionId: String(actionId) },
        logLabel: "External-action",
      });
    }
    return true;
  } catch (alertErr) {
    // §5: alert failures never generate alerts — log only.
    console.error("executeExternal: owner alert failed (not re-alerting):", alertErr.message);
    return false;
  }
}

/**
 * Reconciliation sweep (D-30 §14): closes in_progress rows stranded by a
 * crash between the ledger insert and the finalize. BOOKKEEPING ONLY — the
 * provider call may or may not have happened, so it is NEVER re-executed
 * from here; the row is closed as failed/'interrupted', the task (if any) is
 * parked at MANUAL_REVIEW, and the owner is alerted once. Passing anything
 * executable fails loudly.
 */
async function reconcileStaleActions(opts = {}) {
  if (typeof opts.execute === "function" || typeof opts.retry === "function") {
    throw new Error(
      "reconcileStaleActions: reconciliation reconstructs bookkeeping only — it must NEVER execute provider actions (D-30 §14)"
    );
  }
  const olderThanMinutes = Number(opts.olderThanMinutes || STALE_ACTION_MINUTES);
  const stale = await db.query(
    `UPDATE external_actions
        SET status = 'failed', classification = 'interrupted',
            error = 'Execution was interrupted (server restart) — the provider call may or may not have happened. Never re-executed automatically.',
            finished_at = NOW(), reconciled_at = NOW()
      WHERE status = 'in_progress' AND started_at < NOW() - make_interval(mins => $1)
      RETURNING *`,
    [olderThanMinutes]
  );
  for (const row of stale.rows) {
    if (row.task_id) {
      await taskSpine.safeSpine(async () =>
        taskSpine.transition({
          taskId: row.task_id,
          to: "MANUAL_REVIEW",
          actor: "system:action-reconciliation",
          lastError: row.error,
          meta: { reason: "interrupted_external_action", external_action_id: row.action_id },
        })
      );
    }
    await alertOwnerOnce({
      actionId: row.action_id,
      taskId: row.task_id,
      brandId: row.brand_id,
      userId: row.user_id,
      error: new Error(row.error),
      row,
    });
  }
  if (stale.rows.length > 0) {
    console.warn(`executeExternal: reconciled ${stale.rows.length} interrupted action(s).`);
  }
  return { reconciled: stale.rows.length };
}

/**
 * Execution metrics, derived from the ledger ONLY (D-30 §16). Observational —
 * nothing reads these back as state.
 */
async function getExecutionMetrics() {
  const { rows } = await db.query(
    `SELECT
       COUNT(*)::int                                                   AS total_attempts,
       COUNT(*) FILTER (WHERE attempt > 1)::int                        AS retries,
       COALESCE(SUM(dedup_count), 0)::int                              AS deduplicated_executions,
       COUNT(*) FILTER (WHERE status = 'failed'
                          AND classification = 'terminal')::int        AS terminal_failures,
       COUNT(*) FILTER (WHERE reconciled_at IS NOT NULL)::int          AS reconciliations,
       COUNT(*) FILTER (WHERE alerted_at IS NOT NULL)::int             AS alerts_sent
     FROM external_actions`
  );
  return rows[0];
}

module.exports = {
  executeExternal,
  isTransientProviderError,
  reconcileStaleActions,
  getExecutionMetrics,
  STALE_ACTION_MINUTES,
  SYSTEM_ACTOR,
};
