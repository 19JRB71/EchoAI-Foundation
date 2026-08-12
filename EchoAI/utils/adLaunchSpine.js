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
const { v5: uuidv5 } = require("uuid");
const db = require("../config/db");
const taskSpine = require("./taskSpine");
const { recordExternalProof } = require("./externalProofs");
const { verifyCampaignStatus } = require("./campaignVerification");

const TASK_TYPE = "ad_launch";
const SOURCE_TYPE = "campaign";
const SYSTEM_ACTOR = "system:ad-launch";

// ---------------------------------------------------------------------------
// Prompt 033 (I-32, owner rulings D-40 + D-41) — GOVERNING RE-EXECUTION RULE.
// This wording is binding and regression-locked by a verbatim source test
// (tests/adLaunchIdempotency.test.js); do not edit it without a new owner
// ruling. The same text lives in TASK_SPINE_GUIDE.md.
//
// For an Autopilot launch intent, automatic provider execution is permitted only when durable evidence proves zero provider side effects across every prior attempt AND no campaigns row exists for the derived intent ID. Evidence is CLEAN only when either (a) no prior execution attempt exists, or (b) every prior attempt terminated before any provider call and contains no partial provider IDs; in both cases, no campaigns row may exist for the intent. Any prior `in_progress`, `interrupted`, `succeeded`, provider-accepted/manual-review state, any recorded partial provider ID, or any campaigns row for the intent makes the launch EVIDENCE-DIRTY and MUST NOT trigger provider execution automatically.
//
// Companion invariant: for one approved launch intent, campaign create <= 1,
// ad-set create <= 1, creative create <= 1, ad create <= 1. A partial provider
// chain is never automatically resumed — it stays MANUAL_REVIEW for
// owner-mediated resolution (Prompt 031 owns any relaunch/reset workflow).
// Re-execution is EVIDENCE-GATED, never index-gated: the active-key unique
// index remains a concurrency backstop only, NOT the side-effect memory — a
// reconciled 'interrupted' row vacating that index does NOT reopen execution.
// ---------------------------------------------------------------------------

// D-41: fixed, load-bearing namespace for deriving an Autopilot launch-intent
// UUID from the immutable autopilot_batch_items.item_id via standards-based
// RFC 4122 UUID v5 (uuid@8 already in the dependency tree). NEVER change this
// constant: a silent change would retroactively mint new idempotency keys for
// existing items and reopen I-32. Test-pinned by frozen vectors in
// tests/adLaunchIdempotency.test.js.
const AUTOPILOT_LAUNCH_INTENT_NAMESPACE = "c95d9b57-9a42-4e1b-8f6a-033a1e32d41b";

/**
 * D-41 A1/A2 — deterministic launch-intent id for an Autopilot batch item.
 * SAME ITEM → SAME DERIVED ID → SAME ad_launch:<id> KEY across HTTP retry,
 * concurrent approval, process restart, task retry, already-approved
 * re-entry, bookkeeping repair, and reconciliation inspection. A NEW
 * owner-approved item (new item_id) derives a NEW id/key. The id is never
 * stored pre-execution (autopilot_batch_items.campaign_id keeps its FK and
 * its post-success semantics).
 */
function deriveAutopilotLaunchIntentId(itemId) {
  if (!itemId) throw new Error("deriveAutopilotLaunchIntentId requires an item id");
  return uuidv5(String(itemId), AUTOPILOT_LAUNCH_INTENT_NAMESPACE);
}

// Task states that imply possible provider execution (evidence-DIRTY when
// found for an intent): provider-accepted and beyond, plus review/retry
// states associated with possible provider side effects.
const EVIDENCE_DIRTY_TASK_STATES = [
  "PROVIDER_ACCEPTED",
  "EXTERNALLY_VERIFIED",
  "REPORTED",
  "COMPLETED",
  "MANUAL_REVIEW",
  "RETRY_SCHEDULED",
];

/** Any Facebook object id present in a meta bag? */
function metaHasPartialIds(meta) {
  if (!meta || typeof meta !== "object") return false;
  const bags = [meta.partialChain, meta.facebook];
  return bags.some(
    (b) => b && typeof b === "object" && Object.values(b).some((v) => v !== null && v !== undefined && v !== "")
  );
}

/**
 * D-41 evidence gate. Classifies the durable history of one derived launch
 * intent as CLEAN (automatic execution permitted, exactly once, same key) or
 * DIRTY (ZERO automatic provider calls). Consults, fail-CLOSED on any read
 * error:
 *   1. external_actions rows for ad_launch:<intentId> — ANY row of ANY
 *      status (in_progress, succeeded, failed, reconciled 'interrupted')
 *      is DIRTY. Only a total absence of ledger rows can be CLEAN, with one
 *      exception: rows that are provably pre-provider terminal failures do
 *      not exist by construction (the ledger row is inserted BEFORE the
 *      provider call), so any row means the provider MAY have been reached.
 *   2. campaigns row under the derived intent id — ANY row (including
 *      launch_failed) is DIRTY; launch_failed re-approval is Prompt 031's
 *      owner-mediated edge, never automatic.
 *   3. canonical task (ad_launch/campaign/<intentId>): dirty states,
 *      external_ref, or partial provider ids in task meta / event meta.
 * CLEAN therefore covers exactly: no history at all, or a task-only trail
 * that provably terminated before any provider call (no ledger row, no ids,
 * no campaigns row) — D-41 Clean Cases A and B.
 *
 * @returns {Promise<{clean:boolean, reasons:string[], task:object|null}>}
 */
async function classifyLaunchEvidence({ intentId }) {
  const reasons = [];
  let task = null;
  try {
    const ledger = await db.query(
      "SELECT status, classification FROM external_actions WHERE idempotency_key = $1",
      [`ad_launch:${intentId}`]
    );
    for (const r of ledger.rows) {
      reasons.push(`ledger_row_${r.status}${r.classification ? `_${r.classification}` : ""}`);
    }

    const camp = await db.query("SELECT status FROM campaigns WHERE campaign_id = $1", [intentId]);
    if (camp.rows[0]) reasons.push(`campaigns_row_${camp.rows[0].status}`);

    task = await taskSpine.findTaskBySource({
      taskType: TASK_TYPE,
      sourceType: SOURCE_TYPE,
      sourceId: String(intentId),
    });
    if (task) {
      if (EVIDENCE_DIRTY_TASK_STATES.includes(task.status)) reasons.push(`task_state_${task.status}`);
      if (task.external_ref) reasons.push("task_external_ref");
      if (metaHasPartialIds(task.meta)) reasons.push("task_meta_partial_ids");
      const events = await db.query(
        "SELECT meta FROM agent_task_events WHERE task_id = $1",
        [task.task_id]
      );
      if (events.rows.some((e) => metaHasPartialIds(e.meta))) reasons.push("event_meta_partial_ids");
    }
  } catch (err) {
    // Fail CLOSED: if the durable evidence cannot be read, execution is not
    // provably safe — treat as DIRTY and say so honestly.
    reasons.push(`evidence_read_failed:${String(err.message || err)}`);
    return { clean: false, reasons, task };
  }
  return { clean: reasons.length === 0, reasons, task };
}

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
async function beginLaunch({ brandId, userId, actor, origin = "manual", title, campaignId: preassigned = null }) {
  // Prompt 033 (D-41): callers with a DURABLE launch intent (Autopilot's
  // derived intent id) pass it here so every re-entry records under the SAME
  // source identity and the SAME ad_launch:<id> idempotency key (D-30.13).
  // Callers without one keep per-request minting — each manual createCampaign
  // request IS a new intent.
  const campaignId = preassigned || crypto.randomUUID();
  const taskId = await taskSpine.safeSpine(async () => {
    if (preassigned) {
      // D-41 Section G / D-24 G: stable source id, INCREMENTED attempt for a
      // legitimate evidence-clean re-attempt. createTask only mints a new
      // attempt when the latest prior task is terminal; a prior FAILURE_STATE
      // task (pre-provider terminal failure — Clean Case B) is therefore
      // CANCELLED first (legal from FAILURE_STATES) so the re-attempt gets
      // attempt+1 under the same source — never a new source identity, never
      // a collision with attempt 1. A prior APPROVED/QUEUED/EXECUTING task
      // (crash-before-ledger — Clean Case A) is RESUMED as the same attempt.
      const prior = await taskSpine.findTaskBySource({
        taskType: TASK_TYPE,
        sourceType: SOURCE_TYPE,
        sourceId: String(campaignId),
      });
      if (prior && taskSpine.FAILURE_STATES.includes(prior.status)) {
        await taskSpine.transition({
          taskId: prior.task_id,
          to: "CANCELLED",
          actor: SYSTEM_ACTOR,
          meta: { reason: "superseded_by_evidence_clean_reattempt", origin },
        });
      } else if (prior && !taskSpine.TERMINAL_STATES.includes(prior.status)) {
        // Resume the in-flight attempt through its remaining legal states.
        if (prior.status === "APPROVED") {
          await taskSpine.transition({ taskId: prior.task_id, to: "QUEUED", actor, meta: { origin } });
        }
        if (prior.status === "APPROVED" || prior.status === "QUEUED") {
          await taskSpine.transition({ taskId: prior.task_id, to: "EXECUTING", actor: SYSTEM_ACTOR, meta: { origin } });
        }
        return prior.task_id;
      }
    }
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
  AUTOPILOT_LAUNCH_INTENT_NAMESPACE,
  deriveAutopilotLaunchIntentId,
  EVIDENCE_DIRTY_TASK_STATES,
  classifyLaunchEvidence,
  statesAgree,
  enforceStateAgreement,
  beginLaunch,
  recordLaunchFailure,
  recordPersistFailure,
  recordLaunchSuccess,
  attachLifecycleEvidence,
};
