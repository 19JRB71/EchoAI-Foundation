require("dotenv").config();

/**
 * Prompt 019 — the ONE canonical task-spine adopter for outbound email sends
 * (Owner Addendum D-28 §9: every outbound email path — weekly reports, drip
 * steps, marketing blasts, scheduled campaign sends, and any future sender
 * using the shared transport — converges on THIS module; there is never a
 * second implementation of email task creation).
 *
 * Recorder, not controller (TASK_SPINE_GUIDE.md): every call here is wrapped
 * in taskSpine.safeSpine, so a spine failure can never block, delay, or
 * repeat a send. The senders keep full authority over claims, retries,
 * batching, and SMTP semantics. In particular (D-24 F / D-28 §13): an email
 * the SMTP provider accepted is NEVER re-sent because recording failed —
 * safeSpine files a reconciliation MANUAL_REVIEW task instead of throwing.
 *
 * Message-ID authority (D-28 §10): PROVIDER_ACCEPTED exists only after the
 * SMTP provider accepted the message and returned a Message-ID. The verbatim
 * Message-ID list lives in external_proofs (action 'send_accept'); the task
 * stores proof_id — a reference, never a copy. Recipient addresses are NOT
 * copied into proof evidence (D-23 redaction) — they already live in the
 * feature's own tables; evidence carries message-ids and counts only.
 *
 * Verification honesty (addendum §4): there is no delivery confirmation
 * infrastructure yet. EXTERNALLY_VERIFIED for email therefore means exactly
 * "the provider Message-ID was recorded", and the transition carries
 * meta.verification = 'message_id_recorded' plus
 * meta.deliveryConfirmation = 'unavailable' — the trail never implies a
 * delivery check that did not happen. Delivery webhooks are future work.
 *
 * Task granularity — one task per feature send unit:
 *   - one-time blast (manual or scheduled): one task per campaign send
 *     attempt (source_type 'email_marketing_campaign', source_id campaign_id)
 *   - drip step: one task per recipient step attempt
 *     (source_type 'email_marketing_recipient', source_id recipient_id)
 *   - CRM sequence step: source_type 'email_campaign',
 *     source_id '<campaign_id>:step-<n>'
 *   - weekly report: source_type 'weekly_report',
 *     source_id '<brandId>:<ISO week>'
 * The spine's (task_type, source_type, source_id, attempt) uniqueness gives
 * per-attempt idempotency (D-24 G) without any new tables.
 */

const db = require("../config/db");
const taskSpine = require("./taskSpine");
const { recordExternalProof } = require("./externalProofs");

const TASK_TYPE = "email_send";
const SYSTEM_ACTOR = "system:email-send";

function proofEnvironment() {
  return process.env.APP_ENV || process.env.NODE_ENV || "development";
}

/**
 * Maps a send failure to its lifecycle failure state. Mirrors the publish and
 * ad-launch adopters; SMTP-specific signals first.
 */
function classifySendFailure(err) {
  const code = err && (err.responseCode || err.statusCode);
  const msg = String((err && err.message) || "");
  if (code === 535 || code === 401 || /auth|credential|password|login/i.test(msg)) {
    return "AUTH_REQUIRED";
  }
  if (code === 550 && /not allowed|denied|policy/i.test(msg)) return "PERMISSION_DENIED";
  if (code === 421 || code === 450 || code === 429 || /rate|too many|throttl/i.test(msg)) {
    return "RATE_LIMITED";
  }
  if (/recipient .*required|invalid address|no recipients|malformed/i.test(msg)) {
    return "VALIDATION_FAILED";
  }
  return "EXTERNAL_FAILURE";
}

/**
 * Guide steps 1+2. Called by a sender AFTER its atomic claim succeeded (row
 * lock won / FOR UPDATE SKIP LOCKED / status-guarded UPDATE) — the
 * QUEUED -> EXECUTING edge IS the record of that claim (prompt: "atomic claim
 * before send recorded as the QUEUED->EXECUTING transition"). Never call it
 * for a claim that was lost.
 *
 * Returns taskId|null; null means recording failed and the send proceeds
 * unrecorded (recorder rule) — reconciliation rebuilds it.
 */
async function beginSend({ brandId, userId, actor, sourceType, sourceId, title, meta = {} }) {
  return taskSpine.safeSpine(async () => {
    const { task } = await taskSpine.createTask({
      brandId,
      userId,
      taskType: TASK_TYPE,
      sourceType,
      sourceId: String(sourceId),
      title: title || "Send email",
      status: "APPROVED",
      actor,
      meta,
    });
    // A feature-side retry resumes the SAME task from RETRY_SCHEDULED
    // (createTask returns the existing non-terminal row); a fresh task walks
    // APPROVED -> QUEUED. Both edges are legal sources for QUEUED.
    if (["APPROVED", "RETRY_SCHEDULED"].includes(task.status)) {
      await taskSpine.transition({ taskId: task.task_id, to: "QUEUED", actor, meta });
    }
    await taskSpine.transition({
      taskId: task.task_id,
      to: "EXECUTING",
      actor: SYSTEM_ACTOR,
      meta: { ...meta, claim: "atomic_claim_won" },
    });
    return task.task_id;
  });
}

/**
 * Guide steps 3+4: at least one message was accepted by the SMTP provider
 * (valid Message-ID in hand — D-28 §10 gate). Records:
 *   PROVIDER_ACCEPTED (external_ref = first Message-ID)
 *   -> proof row ('send_accept': message-ids + counts, NO addresses/bodies)
 *   -> EXTERNALLY_VERIFIED (meta: message_id_recorded / delivery unavailable)
 *   -> REPORTED -> COMPLETED
 * Call AFTER the feature transaction committed (guide tx rule).
 *
 * messageIds: array of provider Message-IDs actually returned.
 * counts: { sent, failed } for the send unit (evidence only).
 */
async function recordSendAccepted({ taskId, brandId, userId, sourceType, sourceId, messageIds, counts = {}, meta = {} }) {
  if (!taskId) return null;
  return taskSpine.safeSpine(
    async () => {
      const ids = (messageIds || []).filter(Boolean);
      if (ids.length === 0) {
        // §10 gate: no Message-ID, no PROVIDER_ACCEPTED — a "success" the
        // provider never acknowledged is recorded as an external failure.
        return taskSpine.transition({
          taskId,
          to: "EXTERNAL_FAILURE",
          actor: SYSTEM_ACTOR,
          lastError: "Send reported success without any provider Message-ID",
          meta: { reason: "missing_message_id", ...meta },
        });
      }
      await taskSpine.transition({
        taskId,
        to: "PROVIDER_ACCEPTED",
        actor: SYSTEM_ACTOR,
        externalRef: ids[0],
        meta: { messageIdCount: ids.length, ...meta },
      });
      const { row } = await recordExternalProof({
        runKey: `task-${taskId}`,
        provider: "email",
        action: "send_accept",
        externalId: ids[0],
        brandId,
        userId,
        environment: proofEnvironment(),
        evidence: {
          messageIds: ids,
          sentCount: counts.sent ?? ids.length,
          failedCount: counts.failed ?? 0,
          deliveryConfirmation: "unavailable",
        },
      });
      await taskSpine.transition({
        taskId,
        to: "EXTERNALLY_VERIFIED",
        actor: SYSTEM_ACTOR,
        proofId: row ? row.proof_id : null,
        meta: {
          verification: "message_id_recorded",
          deliveryConfirmation: "unavailable",
        },
      });
      await taskSpine.transition({ taskId, to: "REPORTED", actor: SYSTEM_ACTOR, meta: {} });
      const done = await taskSpine.transition({ taskId, to: "COMPLETED", actor: SYSTEM_ACTOR, meta: {} });
      return done ? done.status : "COMPLETED";
    },
    { providerSucceeded: true, source: { sourceType, sourceId: String(sourceId), brandId, userId } }
  );
}

/**
 * Guide step 5: the send unit produced NO accepted message (SMTP rejected /
 * transport down / nothing sendable). Records the classified failure with the
 * provider error. The FEATURE decides any retry; the spine only records.
 */
async function recordSendFailure({ taskId, error, meta = {} }) {
  if (!taskId) return null;
  const state = classifySendFailure(error);
  return taskSpine.safeSpine(async () =>
    taskSpine.transition({
      taskId,
      to: state,
      actor: SYSTEM_ACTOR,
      lastError: String((error && error.message) || "Email send failed"),
      meta: { error: String((error && error.message) || ""), ...meta },
    })
  );
}

/**
 * The FEATURE decided to retry this send unit later (e.g. drip attempts below
 * the limit). Records RETRY_SCHEDULED; the next feature attempt resumes the
 * SAME task via beginSend (RETRY_SCHEDULED -> QUEUED -> EXECUTING).
 */
async function recordRetryScheduled({ taskId, error, meta = {} }) {
  if (!taskId) return null;
  return taskSpine.safeSpine(async () =>
    taskSpine.transition({
      taskId,
      to: "RETRY_SCHEDULED",
      actor: SYSTEM_ACTOR,
      lastError: String((error && error.message) || "Email send failed; retry scheduled"),
      meta: { error: String((error && error.message) || ""), ...meta },
    })
  );
}

/**
 * SMTP accepted at least one message but the feature could not persist its
 * own bookkeeping (COMMIT failed after accept). The provider action happened
 * — PROVIDER_ACCEPTED with the Message-IDs, then MANUAL_REVIEW. The email is
 * NEVER re-sent from here (D-24 F / D-28 §13).
 */
async function recordPersistFailure({ taskId, brandId, userId, sourceType, sourceId, messageIds, error }) {
  if (!taskId) return null;
  return taskSpine.safeSpine(
    async () => {
      const ids = (messageIds || []).filter(Boolean);
      await taskSpine.transition({
        taskId,
        to: "PROVIDER_ACCEPTED",
        actor: SYSTEM_ACTOR,
        externalRef: ids[0] || null,
        meta: { messageIdCount: ids.length },
      });
      return taskSpine.transition({
        taskId,
        to: "MANUAL_REVIEW",
        actor: SYSTEM_ACTOR,
        lastError: `Email accepted by the provider but saving the result locally failed: ${String((error && error.message) || "")}`,
        meta: { reason: "persist_failed", messageIds: ids },
      });
    },
    { providerSucceeded: true, source: { sourceType, sourceId: String(sourceId), brandId, userId } }
  );
}

module.exports = {
  TASK_TYPE,
  SYSTEM_ACTOR,
  classifySendFailure,
  beginSend,
  recordSendAccepted,
  recordSendFailure,
  recordRetryScheduled,
  recordPersistFailure,
};
