// honestStatus — the single narration discipline for OUTCOME claims (Prompt 025).
//
// GOVERNING INVARIANTS (owner-ruled, verbatim):
//   "The Prompt 025 registry documents and tests the operating model; it does
//   not itself grant runtime authority."
//   "Echo's evidence precedence selects what may be claimed; it does not
//   rewrite underlying records."
//   "Absence of proof is never proof of failure."
//
// This module decides what Echo (and any other owner-facing narration) may
// CLAIM about external outcomes. It reads authoritative records only:
//   - agent_tasks (the task spine — lifecycle truth for adopted flows)
//   - external_proofs (immutable, externally verified evidence)
//   - armed_publish_authorizations + onboarding_first_win_celebrations
//     (Prompt-024 first-win chain)
// Feature tables (social_posts, campaigns, …) may supply identity, names,
// labels, or quantities — they can never manufacture an externally verified
// outcome.
//
// It performs NO provider calls (freshness comes from recorded evidence only)
// and never rewrites any record: precedence controls narration only.

const db = require("../config/db");

// ---------------------------------------------------------------------------
// Closed outcome vocabulary. Narration code may not invent other outcomes.
// ---------------------------------------------------------------------------
const OUTCOMES = Object.freeze({
  VERIFIED_SUCCESS: "verified_success",
  IN_PROGRESS_OR_PREPARED: "in_progress_or_prepared",
  KNOWN_FAILURE: "known_failure",
  MANUAL_REVIEW_UNCERTAIN: "manual_review_uncertain",
  TEMPORARILY_UNVERIFIABLE: "temporarily_unverifiable",
});

const OUTCOME_VALUES = Object.freeze(Object.values(OUTCOMES));

// Spine status → outcome class. UNKNOWN IS NOT NEGATIVE: statuses that only
// mean "we cannot currently prove success" never map to known_failure.
const SPINE_OUTCOME = Object.freeze({
  DRAFTED: OUTCOMES.IN_PROGRESS_OR_PREPARED,
  REVIEWED: OUTCOMES.IN_PROGRESS_OR_PREPARED,
  APPROVED: OUTCOMES.IN_PROGRESS_OR_PREPARED,
  QUEUED: OUTCOMES.IN_PROGRESS_OR_PREPARED,
  EXECUTING: OUTCOMES.IN_PROGRESS_OR_PREPARED,
  RETRY_SCHEDULED: OUTCOMES.IN_PROGRESS_OR_PREPARED,
  // Provider accepted is NOT verified success — no read-back yet.
  PROVIDER_ACCEPTED: OUTCOMES.IN_PROGRESS_OR_PREPARED,
  EXTERNALLY_VERIFIED: OUTCOMES.VERIFIED_SUCCESS,
  REPORTED: OUTCOMES.VERIFIED_SUCCESS,
  COMPLETED: OUTCOMES.VERIFIED_SUCCESS,
  AUTH_REQUIRED: OUTCOMES.KNOWN_FAILURE,
  PERMISSION_DENIED: OUTCOMES.KNOWN_FAILURE,
  RATE_LIMITED: OUTCOMES.KNOWN_FAILURE,
  VALIDATION_FAILED: OUTCOMES.KNOWN_FAILURE,
  EXTERNAL_FAILURE: OUTCOMES.KNOWN_FAILURE,
  MANUAL_REVIEW: OUTCOMES.MANUAL_REVIEW_UNCERTAIN,
  CANCELLED: OUTCOMES.KNOWN_FAILURE,
});

// COMPLETED/EXTERNALLY_VERIFIED/REPORTED claim verified success ONLY when the
// lineage actually carries a proof (proof_id / verified external_ref backed by
// an external_proofs row). Without it the claim is capped (see resolve()).
const SPINE_SUCCESS_STATES = Object.freeze(["EXTERNALLY_VERIFIED", "REPORTED", "COMPLETED"]);

// ---------------------------------------------------------------------------
// Standard honest phrasings. Copy MAY be reworded by callers, but the meaning
// class must be preserved; tests bind narration to these meaning classes.
// ---------------------------------------------------------------------------
const PHRASES = Object.freeze({
  [OUTCOMES.VERIFIED_SUCCESS]: (what, when) =>
    when ? `${what} — verified as of ${when}` : `${what} — externally verified`,
  [OUTCOMES.IN_PROGRESS_OR_PREPARED]: (what) =>
    `${what} is in progress — not externally verified yet`,
  [OUTCOMES.KNOWN_FAILURE]: (what, why) =>
    why ? `${what} failed: ${why}` : `${what} failed`,
  [OUTCOMES.MANUAL_REVIEW_UNCERTAIN]: (what) =>
    `${what} needs manual review — the outcome is uncertain and I won't guess`,
  [OUTCOMES.TEMPORARILY_UNVERIFIABLE]: (what) =>
    `I can't verify ${what} right now`,
  RECORDED_ONLY: (what) => `${what} — per our records; not externally verified`,
});

// ---------------------------------------------------------------------------
// Evidence precedence (deterministic — Stage-1 table, owner-accepted).
// Controls NARRATION ONLY. Cases (see tests, one regression per case):
//  1. feature=active,   spine=MANUAL_REVIEW      → manual_review_uncertain
//  2. provider accepted, no verified read-back    → in_progress_or_prepared
//  3. feature=published, proof absent             → recorded-only (never verified_success)
//  4. P024 auth claimed + post scheduled, no proof→ in_progress_or_prepared
//  5. proof exists, stale feature row says pending→ verified_success (proof wins)
//  6. multiple attempts on one logical operation  → per-attempt isolation; narrate latest attempt, verified older attempts stay historical facts
//  7. older attempt verified, newer pending/failed→ report both truthfully: historical verified event + current attempt state
// ---------------------------------------------------------------------------

/**
 * Resolve a single logical operation's claimable outcome from its lineage.
 * @param {object} args
 * @param {object|null} args.task      agent_tasks row (or null when unadopted)
 * @param {object|null} args.proof     external_proofs row correlated via
 *                                     task.proof_id (deterministic lineage
 *                                     only — never brand-level "any proof").
 * @param {object|null} args.feature   feature-table row (identity/labels only)
 * @param {boolean}     args.readFailed true when an authoritative source read
 *                                     threw — yields temporarily_unverifiable.
 */
function resolve({ task = null, proof = null, feature = null, readFailed = false } = {}) {
  if (readFailed) {
    // Source read failure invents neither success nor failure.
    return { outcome: OUTCOMES.TEMPORARILY_UNVERIFIABLE, basis: "read_failure", verifiedAt: null };
  }
  // Case 5: verified proof beats any stale feature state.
  if (proof && proof.verified_at) {
    return {
      outcome: OUTCOMES.VERIFIED_SUCCESS,
      basis: "external_proof",
      proofId: proof.proof_id,
      externalId: proof.external_id,
      verifiedAt: proof.verified_at,
    };
  }
  if (task) {
    const mapped = SPINE_OUTCOME[task.status];
    if (!mapped) {
      // Unclassifiable authoritative status — refuse to guess.
      return { outcome: OUTCOMES.MANUAL_REVIEW_UNCERTAIN, basis: "unknown_spine_status", verifiedAt: null };
    }
    if (mapped === OUTCOMES.VERIFIED_SUCCESS && !proof && !task.proof_id) {
      // Success-shaped status without proof lineage: cap the claim (case 3).
      return { outcome: OUTCOMES.IN_PROGRESS_OR_PREPARED, basis: "spine_success_without_proof", verifiedAt: null };
    }
    return {
      outcome: mapped,
      basis: "task_spine",
      taskId: task.task_id,
      verifiedAt: null,
      lastError: mapped === OUTCOMES.KNOWN_FAILURE ? task.last_error || null : null,
    };
  }
  if (feature) {
    // Feature row alone can never claim verified success (cases 1–3).
    return { outcome: OUTCOMES.IN_PROGRESS_OR_PREPARED, basis: "feature_recorded_only", recordedOnly: true, verifiedAt: null };
  }
  return { outcome: OUTCOMES.TEMPORARILY_UNVERIFIABLE, basis: "no_evidence", verifiedAt: null };
}

// ---------------------------------------------------------------------------
// Social publish — deterministic correlation post → task attempt(s) → proof.
// ---------------------------------------------------------------------------
async function forSocialPublish({ brandId, postId }) {
  try {
    const posts = await db.query(
      `SELECT post_id, status, external_post_id, published_time, platform
         FROM social_posts WHERE post_id = $1 AND brand_id = $2`,
      [postId, brandId]
    );
    const feature = posts.rows[0] || null;
    const tasks = await db.query(
      `SELECT t.task_id, t.status, t.attempt, t.external_ref, t.proof_id, t.last_error, t.updated_at
         FROM agent_tasks t
        WHERE t.task_type = 'social_publish' AND t.source_type = 'social_post'
          AND t.source_id = $1 AND t.brand_id = $2
        ORDER BY t.attempt DESC`,
      [String(postId), brandId]
    );
    const latest = tasks.rows[0] || null;
    let proof = null;
    if (latest && latest.proof_id) {
      const proofs = await db.query(
        `SELECT proof_id, external_id, verified_at FROM external_proofs WHERE proof_id = $1`,
        [latest.proof_id]
      );
      proof = proofs.rows[0] || null;
    }
    // Case 6/7: attempts are isolated; an older attempt's verification is a
    // historical fact, never transplanted onto the latest attempt.
    const olderVerified = tasks.rows
      .slice(1)
      .filter((t) => SPINE_SUCCESS_STATES.includes(t.status) && t.proof_id)
      .map((t) => ({ taskId: t.task_id, attempt: t.attempt }));
    return {
      ...resolve({ task: latest, proof, feature }),
      attempts: tasks.rows.length,
      olderVerifiedAttempts: olderVerified,
      feature: feature ? { status: feature.status, externalPostId: feature.external_post_id } : null,
    };
  } catch (err) {
    console.error("honestStatus.forSocialPublish read failed:", err.message);
    return resolve({ readFailed: true });
  }
}

// ---------------------------------------------------------------------------
// Prompt-024 first win — authorization → proof → celebration, one identity.
// The onboarding status endpoint remains a projection, not an authority.
// ---------------------------------------------------------------------------
async function forFirstWin({ userId, brandId = null }) {
  try {
    const params = brandId ? [userId, brandId] : [userId];
    const auths = await db.query(
      `SELECT authorization_id, status, post_id, brand_id, consumed_at
         FROM armed_publish_authorizations
        WHERE user_id = $1 ${brandId ? "AND brand_id = $2" : ""}
        ORDER BY created_at DESC`,
      params
    ).catch(() => ({ rows: [] }));
    const consumed = auths.rows.find((a) => a.status === "consumed") || null;
    const armed = auths.rows.find((a) => a.status === "armed") || null;

    // Deterministic proof correlation: through the consumed authorization's
    // post → its social_publish task → proof_id. Never "any proof for brand".
    let proof = null;
    if (consumed) {
      const proofs = await db.query(
        `SELECT p.proof_id, p.external_id, p.verified_at
           FROM agent_tasks t JOIN external_proofs p ON p.proof_id = t.proof_id
          WHERE t.task_type = 'social_publish' AND t.source_type = 'social_post'
            AND t.source_id = $1::text AND t.brand_id = $2
          ORDER BY t.attempt DESC LIMIT 1`,
        [String(consumed.post_id), consumed.brand_id]
      );
      proof = proofs.rows[0] || null;
    }
    let celebration = null;
    if (proof) {
      const celebs = await db.query(
        `SELECT celebration_claim_id, provider, claimed_at
           FROM onboarding_first_win_celebrations
          WHERE user_id = $1 AND proof_id = $2`,
        [userId, proof.proof_id]
      );
      celebration = celebs.rows[0] || null;
    }

    // Narration ladder: prepared is never published; armed is never won;
    // claimed/unverified is in-progress; provider-accepted without read-back
    // is not a first win. Verified proof establishes the event.
    if (proof && proof.verified_at) {
      return {
        outcome: OUTCOMES.VERIFIED_SUCCESS,
        basis: "external_proof",
        proofId: proof.proof_id,
        externalId: proof.external_id,
        verifiedAt: proof.verified_at,
        celebrated: Boolean(celebration),
        celebrationId: celebration ? celebration.celebration_claim_id : null,
      };
    }
    if (consumed) {
      // Authorization consumed but no verified proof yet (case 4).
      return { outcome: OUTCOMES.IN_PROGRESS_OR_PREPARED, basis: "authorization_consumed_unverified", verifiedAt: null, celebrated: false };
    }
    if (armed) {
      return { outcome: OUTCOMES.IN_PROGRESS_OR_PREPARED, basis: "authorization_armed", verifiedAt: null, celebrated: false };
    }
    return { outcome: OUTCOMES.IN_PROGRESS_OR_PREPARED, basis: "no_authorization", recordedOnly: true, verifiedAt: null, celebrated: false };
  } catch (err) {
    console.error("honestStatus.forFirstWin read failed:", err.message);
    return { ...resolve({ readFailed: true }), celebrated: false };
  }
}

// ---------------------------------------------------------------------------
// Campaign narration (D-39 created_paused ruling + freshness honesty).
// NO provider calls; freshness comes from recorded verification only.
// NO arbitrary TTL — historical verification narrates as "as of <timestamp>".
// ---------------------------------------------------------------------------

/** True only for statuses that may ever be described as running/spending. */
function campaignCountsAsRunning(status) {
  return status === "live";
}

/**
 * One campaign's honest state sentence fragment.
 * @param {object} c campaigns row: { status, status_verified_at? }
 */
function describeCampaignState(c) {
  const status = c && c.status;
  if (status === "created_paused") {
    // Established truthful semantics — never "running", never "spending".
    return { text: "created, paused — not spending", running: false };
  }
  if (status === "live") {
    const ts = c.status_verified_at || c.verified_at || null;
    if (ts) {
      return { text: `verified live as of ${new Date(ts).toISOString()}`, running: true, verifiedAt: ts };
    }
    // No recorded verification strong enough for a bare "currently running".
    return { text: "live per our records — not re-verified", running: true, recordedOnly: true };
  }
  if (status === "paused") return { text: "paused — not spending", running: false };
  if (status === "completed") return { text: "completed", running: false };
  return { text: `${status || "unknown"} — per our records`, running: false, recordedOnly: true };
}

/**
 * Split campaign rows into honest buckets for count narration.
 * created_paused can NEVER appear in the running bucket.
 */
function campaignBuckets(rows) {
  const buckets = { running: [], createdPaused: [], other: [] };
  for (const c of rows || []) {
    if (c.status === "created_paused") buckets.createdPaused.push(c);
    else if (campaignCountsAsRunning(c.status)) buckets.running.push(c);
    else buckets.other.push(c);
  }
  return buckets;
}

/** Honest replacement for "N campaigns are running" sentences. */
function campaignCountSentence(rows) {
  const { running, createdPaused } = campaignBuckets(rows);
  const parts = [];
  if (running.length) {
    parts.push(`${running.length} campaign${running.length === 1 ? " is" : "s are"} live`);
  }
  if (createdPaused.length) {
    parts.push(
      `${createdPaused.length} campaign${createdPaused.length === 1 ? " is" : "s are"} created, paused — not spending`
    );
  }
  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Attribution honesty: an outcome is attributed to a named agent only when
// the authoritative lineage proves BOTH the outcome and the actor. No new
// lineage columns exist in Prompt 025, so attribution comes only from what
// agent_task_events / meta actually recorded.
// ---------------------------------------------------------------------------
function attributionFor(task) {
  if (!task || !task.meta) return null;
  const actor = task.meta.actor || null;
  // Scheduler/system actors are not agent identities — never dress them up.
  if (!actor || typeof actor !== "string") return null;
  const AGENT_IDS = ["echo", "scout", "atlas", "nova", "pulse", "voice", "forge", "sentinel", "sage", "vision"];
  return AGENT_IDS.includes(actor.toLowerCase()) ? actor.toLowerCase() : null;
}

module.exports = {
  OUTCOMES,
  OUTCOME_VALUES,
  SPINE_OUTCOME,
  PHRASES,
  resolve,
  forSocialPublish,
  forFirstWin,
  campaignCountsAsRunning,
  describeCampaignState,
  campaignBuckets,
  campaignCountSentence,
  attributionFor,
};
