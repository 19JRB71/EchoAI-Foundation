require("dotenv").config();

/**
 * Prompt 018 — the ONE canonical task-spine adopter for Facebook ad launches
 * (Owner Addendum D-27 §10: every launch entry point — manual, Autopilot,
 * Ad Creative Studio, Echo, Setup Wizard, any future caller — converges on
 * THIS module; there is never a second implementation of ad-launch task
 * creation).
 *
 * Recorder, not controller (TASK_SPINE_GUIDE.md): every call here is wrapped
 * in taskSpine.safeSpine, so a spine failure can never block or alter a
 * launch. The launchers keep full authority over guards, Facebook calls,
 * retries, and row writes.
 *
 * Source identity: the adopter PRE-GENERATES the campaigns.campaign_id
 * (UUID) before any Facebook call, and both launchers insert their campaigns
 * row (success 'created_paused' OR failure 'launch_failed') under that same
 * id. The canonical task is therefore keyed
 * (task_type 'ad_launch', source_type 'campaign', source_id <campaign_id>)
 * from the moment of approval, and reconciliation can always join tasks to
 * campaigns rows without guessing.
 *
 * Evidence binding (D-27 §9): the launch read-back is written to
 * external_proofs (sole evidence authority) and the task stores proof_id —
 * a reference, never a copy.
 */

const crypto = require("crypto");
const db = require("../config/db");
const taskSpine = require("./taskSpine");
const { recordExternalProof } = require("./externalProofs");
const { verifyCampaignStatus } = require("./campaignVerification");

const TASK_TYPE = "ad_launch";
const SOURCE_TYPE = "campaign";
const SYSTEM_ACTOR = "system:ad-launch";

/** Environment tag for proof rows (same rule as the publish adopter). */
function proofEnvironment() {
  return process.env.APP_ENV || process.env.NODE_ENV || "development";
}

/** All four Facebook objects present? (D-27 §11 — completeness gate.) */
function chainComplete(ids) {
  return Boolean(ids && ids.campaignId && ids.adSetId && ids.creativeId && ids.adId);
}

function anyObjectCreated(ids) {
  return Boolean(ids && (ids.campaignId || ids.adSetId || ids.creativeId || ids.adId));
}

/**
 * Maps a launch error to its lifecycle failure state. A PARTIAL chain (any
 * Facebook object already created) is always EXTERNAL_FAILURE with the
 * partial ids in evidence (Prompt 003 / D-27 §11); pre-chain errors classify
 * by cause, mirroring the publish adopter.
 */
function classifyLaunchFailure(err, ids) {
  if (anyObjectCreated(ids)) return "EXTERNAL_FAILURE";
  const status = err && err.statusCode;
  const msg = String((err && err.message) || "");
  if (status === 401 || /token|credential|expired|revoked|reconnect|not connected|log ?in again|oauth/i.test(msg)) {
    return "AUTH_REQUIRED";
  }
  if (status === 403 || /permission|not allowed|forbidden/i.test(msg)) {
    return "PERMISSION_DENIED";
  }
  if (status === 429 || /rate limit/i.test(msg)) return "RATE_LIMITED";
  if (status === 400 || status === 422 || status === 503 || /invalid|rejected|must be|required|unsupported|missing|no facebook page|destination/i.test(msg)) {
    return "VALIDATION_FAILED";
  }
  return "EXTERNAL_FAILURE";
}

// ---------------------------------------------------------------------------
// State agreement (Prompt 018 addendum §3): campaigns.status (domain machine,
// Prompt 005) and the task lifecycle state must agree per this mapping.
// Disagreement THROWS in tests and raises MANUAL_REVIEW in production —
// never silently reconciled.
// ---------------------------------------------------------------------------

const AGREEMENT = {
  draft: ["DRAFTED", "REVIEWED", "APPROVED", "QUEUED"],
  approved: ["APPROVED", "QUEUED", "EXECUTING"],
  launch_failed: [...taskSpine.FAILURE_STATES, "MANUAL_REVIEW", "CANCELLED"],
  created_paused: [
    "EXECUTING", // transient: row inserted, success recording in flight
    "PROVIDER_ACCEPTED",
    "EXTERNALLY_VERIFIED",
    "REPORTED",
    "COMPLETED",
    "MANUAL_REVIEW", // verification_failed / persist anomalies — owner attention
  ],
  live: ["COMPLETED", "MANUAL_REVIEW"],
  completed: ["COMPLETED", "MANUAL_REVIEW"],
  failed: ["COMPLETED", "MANUAL_REVIEW"],
};

/** Pure predicate — true when the pair agrees per the mapping. */
function statesAgree(campaignStatus, taskStatus) {
  const legal = AGREEMENT[campaignStatus];
  return Boolean(legal && legal.includes(taskStatus));
}

/**
 * Enforces the agreement for one campaign/task pair. In tests a disagreement
 * throws (so drift is caught immediately); in production it raises a
 * high-severity MANUAL_REVIEW reconciliation task and logs — it never
 * rewrites either state.
 */
async function enforceStateAgreement({ campaignId, brandId, userId, campaignStatus, taskStatus }) {
  if (statesAgree(campaignStatus, taskStatus)) return true;
  const message =
    `Ad-launch state disagreement for campaign ${campaignId}: ` +
    `campaigns.status='${campaignStatus}' vs task status='${taskStatus}'`;
  // Test runs are identified by the dbGuard marker (the suite doesn't set
  // NODE_ENV); either signal means "throw so drift is caught immediately".
  if (process.env.NODE_ENV === "test" || process.env.__ECHOAI_TEST_DB_URL) {
    throw new Error(message);
  }
  console.error(message);
  try {
    await taskSpine.createTask({
      brandId,
      userId,
      taskType: "reconciliation",
      sourceType: SOURCE_TYPE,
      sourceId: String(campaignId),
      title: `Reconcile: campaign/task state disagreement (campaign ${campaignId})`,
      status: "MANUAL_REVIEW",
      actor: "system:repair",
      meta: { severity: "high", reason: "state_disagreement", campaignStatus, taskStatus },
    });
  } catch (err) {
    console.error("adLaunchSpine: could not raise state-disagreement review task:", err.message);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Adopter API — called by BOTH launch implementations. Guide checklist steps
// are noted inline (TASK_SPINE_GUIDE.md, "How a new feature adopts the
// spine").
// ---------------------------------------------------------------------------

/**
 * Step 1+2: called at the moment of owner approval (the launch request),
 * BEFORE any Facebook call. Pre-generates the campaigns.campaign_id, creates
 * the canonical task at APPROVED (actor = the approving owner / calling
 * system) and records APPROVED -> QUEUED -> EXECUTING.
 *
 * ALWAYS returns a usable campaignId even if recording fails (recorder rule):
 * { campaignId, taskId|null }.
 */
async function beginLaunch({ brandId, userId, actor, origin = "manual", title }) {
  const campaignId = crypto.randomUUID();
  const taskId = await taskSpine.safeSpine(async () => {
    const { task } = await taskSpine.createTask({
      brandId,
      userId,
      taskType: TASK_TYPE,
      sourceType: SOURCE_TYPE,
      sourceId: campaignId,
      title: title || "Launch Facebook ad campaign",
      status: "APPROVED",
      actor,
      meta: { origin },
    });
    await taskSpine.transition({ taskId: task.task_id, to: "QUEUED", actor, meta: { origin } });
    await taskSpine.transition({ taskId: task.task_id, to: "EXECUTING", actor: SYSTEM_ACTOR, meta: { origin } });
    return task.task_id;
  });
  return { campaignId, taskId };
}

/**
 * Step 5: launch failed (pre-chain or mid-chain). Records the classified
 * failure state with the partial Facebook ids in evidence. Never touches the
 * feature's own recovery (recordFailedLaunch row, thrown error).
 */
async function recordLaunchFailure({ taskId, campaignId, brandId, userId, ids, error }) {
  if (!taskId) return null;
  const state = classifyLaunchFailure(error, ids);
  return taskSpine.safeSpine(
    async () =>
      taskSpine.transition({
        taskId,
        to: state,
        actor: SYSTEM_ACTOR,
        lastError: String((error && error.message) || "Launch failed"),
        meta: { partialChain: { ...(ids || {}) }, error: String((error && error.message) || "") },
      }),
    anyObjectCreated(ids)
      ? { providerSucceeded: true, source: { sourceType: SOURCE_TYPE, sourceId: campaignId, brandId, userId } }
      : {}
  );
}

/**
 * The Facebook chain is complete but the local campaigns INSERT failed:
 * the provider action happened (PROVIDER_ACCEPTED, ids attached) but the
 * feature could not persist it — owner attention, and absolutely no
 * relaunch (Addendum F).
 */
async function recordPersistFailure({ taskId, campaignId, brandId, userId, ids, error }) {
  if (!taskId) return null;
  return taskSpine.safeSpine(
    async () => {
      await taskSpine.transition({
        taskId,
        to: "PROVIDER_ACCEPTED",
        actor: SYSTEM_ACTOR,
        externalRef: ids.campaignId || null,
        meta: { facebook: { ...ids } },
      });
      return taskSpine.transition({
        taskId,
        to: "MANUAL_REVIEW",
        actor: SYSTEM_ACTOR,
        lastError: `Facebook chain created but saving it locally failed: ${String((error && error.message) || "")}`,
        meta: { reason: "persist_failed", facebook: { ...ids } },
      });
    },
    { providerSucceeded: true, source: { sourceType: SOURCE_TYPE, sourceId: campaignId, brandId, userId } }
  );
}

/**
 * Steps 3+4: the launch succeeded end-to-end (all four objects + campaigns
 * row inserted as 'created_paused'). Records:
 *   PROVIDER_ACCEPTED (only with ALL FOUR ids — D-27 §11)
 *   -> Prompt 005 read-back (verifyCampaignStatus — the single verification
 *      authority) -> proof row (launch_readback) -> EXTERNALLY_VERIFIED
 *   -> REPORTED -> COMPLETED
 * Failed read-back after a successful launch => MANUAL_REVIEW
 * (verification_failed) and the launch is NEVER retried.
 */
async function recordLaunchSuccess({ taskId, campaignId, brandId, userId, ids }) {
  if (!taskId) return null;
  return taskSpine.safeSpine(
    async () => {
      if (!chainComplete(ids)) {
        // Completeness gate: a "success" without all four ids may never
        // reach PROVIDER_ACCEPTED (D-27 §11).
        return taskSpine.transition({
          taskId,
          to: "EXTERNAL_FAILURE",
          actor: SYSTEM_ACTOR,
          lastError: "Launch reported success without a complete Facebook object chain",
          meta: { reason: "incomplete_chain", partialChain: { ...(ids || {}) } },
        });
      }
      await taskSpine.transition({
        taskId,
        to: "PROVIDER_ACCEPTED",
        actor: SYSTEM_ACTOR,
        externalRef: ids.campaignId,
        meta: { facebook: { ...ids } },
      });

      // Prompt 005 read-back — existence + statuses of the PAUSED objects.
      let verification;
      try {
        verification = await verifyCampaignStatus(campaignId);
      } catch (err) {
        verification = { verified: false, error: err.message };
      }
      let finalStatus;
      if (verification.verified) {
        const { row } = await recordExternalProof({
          runKey: `task-${taskId}`,
          provider: "facebook",
          action: "launch_readback",
          externalId: ids.campaignId,
          brandId,
          userId,
          environment: proofEnvironment(),
          evidence: { readBack: verification.readBack || null, facebook: { ...ids }, verifiedState: verification.state },
        });
        await taskSpine.transition({
          taskId,
          to: "EXTERNALLY_VERIFIED",
          actor: SYSTEM_ACTOR,
          proofId: row ? row.proof_id : null,
          meta: { verification: "graph_readback", verifiedState: verification.state },
        });
        await taskSpine.transition({ taskId, to: "REPORTED", actor: SYSTEM_ACTOR, meta: {} });
        const done = await taskSpine.transition({ taskId, to: "COMPLETED", actor: SYSTEM_ACTOR, meta: {} });
        finalStatus = done ? done.status : "COMPLETED";
      } else {
        // Launch succeeded, verification did not — owner attention, no
        // false EXTERNALLY_VERIFIED, and absolutely no relaunch.
        const parked = await taskSpine.transition({
          taskId,
          to: "MANUAL_REVIEW",
          actor: SYSTEM_ACTOR,
          lastError: `Verification read-back failed: ${verification.error}`,
          meta: { reason: "verification_failed", error: verification.error },
        });
        finalStatus = parked ? parked.status : "MANUAL_REVIEW";
      }

      // Addendum §3: assert domain/lifecycle agreement at the end of every
      // recorded launch.
      const { rows } = await db.query("SELECT status FROM campaigns WHERE campaign_id = $1", [campaignId]);
      if (rows[0]) {
        await enforceStateAgreement({
          campaignId,
          brandId,
          userId,
          campaignStatus: rows[0].status,
          taskStatus: finalStatus,
        });
      }
      return finalStatus;
    },
    { providerSucceeded: true, source: { sourceType: SOURCE_TYPE, sourceId: campaignId, brandId, userId } }
  );
}

/**
 * Prompt 018 §4 — unpause/pause WIRING ONLY. Prompt 015's controls transition
 * the SAME canonical launch task's trail via evidence events (no new task per
 * unpause, no state change — the launch task is already terminal). The event
 * references the ad_spend_audit row so 015's audit and the task trail point
 * at each other.
 */
async function attachLifecycleEvidence({ campaignId, actor, meta = {} }) {
  return taskSpine.safeSpine(async () => {
    const task = await taskSpine.findTaskBySource({
      taskType: TASK_TYPE,
      sourceType: SOURCE_TYPE,
      sourceId: String(campaignId),
    });
    if (!task) return null;
    return taskSpine.attachEvidence({ taskId: task.task_id, actor, meta });
  });
}

module.exports = {
  TASK_TYPE,
  SOURCE_TYPE,
  SYSTEM_ACTOR,
  AGREEMENT,
  classifyLaunchFailure,
  chainComplete,
  statesAgree,
  enforceStateAgreement,
  beginLaunch,
  recordLaunchFailure,
  recordPersistFailure,
  recordLaunchSuccess,
  attachLifecycleEvidence,
};
