/**
 * Prompt 024 — onboarding first-win endpoints.
 *
 *  - GET  /api/onboarding/status            PURE projection, ZERO writes.
 *  - POST /api/onboarding/first-win/prepare Store the honest PREPARED post.
 *  - POST /api/onboarding/first-win/arm     Capture artifact-bound consent.
 *  - POST /api/onboarding/first-win/disarm  Withdraw consent before claim.
 *  - POST /api/onboarding/celebration/claim Provider-agnostic insert-once
 *                                           celebration claim (Section D3).
 *
 * The claim/handoff itself lives in utils/onboardingFirstWin.js and is
 * invoked by the Facebook connection callback — never from these routes.
 */

const db = require("../config/db");
const firstWin = require("../utils/onboardingFirstWin");
const {
  probeFacebook,
  probeGoogle,
  probeEmail,
} = require("./guidedSetupController");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Progressive connection tiers (Section G). Static presentation data — no
// new provider implementations; optional-later entries link to existing
// settings surfaces.
const CONNECTION_TIERS = {
  requiredNow: [],
  recommendedNext: ["facebook", "google"],
  optionalLater: ["email", "twilio", "jobber", "ad_account"],
};

/** The owner's first-win post row (source slot), if any. */
async function loadFirstWinPost(userId, runner = db) {
  const { rows } = await runner.query(
    `SELECT p.post_id, p.brand_id, p.platform, p.post_content, p.image_url,
            p.video_url, p.status, p.scheduled_time, p.published_time,
            p.external_post_id, p.created_at
       FROM social_posts p
       JOIN brands b ON b.brand_id = p.brand_id
      WHERE b.user_id = $1 AND p.source = $2
      ORDER BY p.created_at DESC
      LIMIT 1`,
    [userId, firstWin.FIRST_WIN_SOURCE],
  );
  return rows[0] || null;
}

/** Latest authorization row for a post (any status), if any. */
async function loadLatestAuthorization(postId) {
  const { rows } = await db.query(
    `SELECT authorization_id, status, invalidation_reason, content_hash,
            destination_page_id, destination_bound_at, consent_copy_version,
            consent_captured_at, armed_at, claimed_at, consumed_at,
            disarmed_at, execution_failed_at
       FROM armed_publish_authorizations
      WHERE post_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [postId],
  );
  return rows[0] || null;
}

/**
 * Derives the qualifying, uncelebrated first-win proof for a user
 * (Section D1/D3): the earliest of
 *   - the Facebook publish read-back proof referenced by the canonical
 *     social_publish task for the first-win post, once the task reached
 *     EXTERNALLY_VERIFIED (or beyond); and
 *   - the Google GA4 first-win proof (run_key onboarding-ga4-{userId}).
 * PROVIDER_ACCEPTED alone never appears here; OAuth alone writes no proof.
 */
async function findQualifyingProof(userId) {
  const { rows } = await db.query(
    `(
       SELECT ep.proof_id, ep.provider, ep.brand_id, ep.created_at
         FROM agent_tasks t
         JOIN social_posts p ON p.post_id::text = t.source_id
         JOIN external_proofs ep ON ep.proof_id = t.proof_id
        WHERE t.user_id = $1
          AND t.task_type = 'social_publish'
          AND t.status IN ('EXTERNALLY_VERIFIED', 'REPORTED', 'COMPLETED')
          AND t.proof_id IS NOT NULL
          AND p.source = $2
     )
     UNION ALL
     (
       SELECT ep.proof_id, ep.provider, ep.brand_id, ep.created_at
         FROM external_proofs ep
        WHERE ep.run_key = $3
          AND ep.provider = 'google'
          AND ep.action = 'ga4_first_win_readback'
     )
     ORDER BY created_at ASC
     LIMIT 1`,
    [userId, firstWin.FIRST_WIN_SOURCE, `onboarding-ga4-${userId}`],
  );
  return rows[0] || null;
}

/**
 * GET /api/onboarding/status — the ONE onboarding progress projection the
 * Wizard and Echo both read (Section F). Pure per-request projection: every
 * value is derived from authoritative records/probes at request time; this
 * handler performs ZERO writes (expiry is only PROJECTED here — the stored
 * invalidation happens at claim time, Section A6).
 */
async function getStatus(req, res) {
  try {
    const userId = req.user.userId;

    const userRow = await db.query(
      `SELECT onboarding_completed, onboarding_step FROM users WHERE user_id = $1`,
      [userId],
    );
    if (userRow.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const progressRow = await db.query(
      `SELECT current_step, connections, updated_at
         FROM guided_setup_progress WHERE user_id = $1`,
      [userId],
    );
    const progress = progressRow.rows[0] || null;
    const parked = Boolean(
      progress?.connections &&
        typeof progress.connections === "object" &&
        progress.connections.parked?.parked === true,
    );

    let setupSession = null;
    try {
      const s = await db.query(
        `SELECT status, interview_complete FROM setup_sessions
          WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId],
      );
      if (s.rows[0]) {
        setupSession = {
          status: s.rows[0].status,
          interviewComplete: Boolean(s.rows[0].interview_complete),
        };
      }
    } catch {
      setupSession = { status: "unknown" };
    }

    const post = await loadFirstWinPost(userId);
    let authorization = null;
    let task = null;
    if (post) {
      const auth = await loadLatestAuthorization(post.post_id);
      if (auth) {
        const expired =
          auth.status === "armed" && !firstWin.isWithinArmedWindow(auth.armed_at);
        authorization = {
          authorizationId: auth.authorization_id,
          status: auth.status,
          invalidationReason: auth.invalidation_reason,
          // Projection-only expiry state (the durable flip happens at claim):
          reconfirmationRequired:
            expired ||
            auth.status === "invalidated" ||
            auth.status === "execution_failed",
          expired,
          armedAt: auth.armed_at,
          expiresAt: firstWin.armedWindowExpiry(auth.armed_at),
          consentCopyVersion: auth.consent_copy_version,
          consentCapturedAt: auth.consent_captured_at,
          destinationPageId: auth.destination_page_id,
          destinationBoundAt: auth.destination_bound_at,
          destinationSemantics: auth.destination_page_id
            ? "exact_page"
            : "page_connected_during_onboarding",
          claimedAt: auth.claimed_at,
        };
      }
      const t = await db.query(
        `SELECT status, external_ref, proof_id, last_error FROM agent_tasks
          WHERE task_type = 'social_publish' AND source_type = 'social_post'
            AND source_id = $1
          ORDER BY attempt DESC LIMIT 1`,
        [String(post.post_id)],
      );
      if (t.rows[0]) {
        task = {
          status: t.rows[0].status,
          externalRef: t.rows[0].external_ref,
          proofId: t.rows[0].proof_id,
          lastError: t.rows[0].last_error,
        };
      }
    }

    const proof = await findQualifyingProof(userId);
    const celebration = await db.query(
      `SELECT proof_id, provider, claimed_at
         FROM onboarding_first_win_celebrations
        WHERE user_id = $1 ORDER BY claimed_at ASC LIMIT 1`,
      [userId],
    );

    const [facebook, google, email] = await Promise.all([
      probeFacebook(userId),
      probeGoogle(userId),
      probeEmail(userId),
    ]);

    return res.json({
      onboardingCompleted: userRow.rows[0].onboarding_completed,
      onboardingStep: userRow.rows[0].onboarding_step,
      parked,
      wizard: progress
        ? { currentStep: progress.current_step, updatedAt: progress.updated_at }
        : null,
      setupSession,
      firstWin: post
        ? {
            postId: post.post_id,
            brandId: post.brand_id,
            platform: post.platform,
            postContent: post.post_content,
            imageUrl: post.image_url,
            status: post.status,
            scheduledTime: post.scheduled_time,
            publishedTime: post.published_time,
            externalPostId: post.external_post_id,
          }
        : null,
      authorization,
      task,
      won: Boolean(proof),
      wonProvider: proof ? proof.provider : null,
      celebrated: celebration.rows.length > 0,
      celebratedProvider: celebration.rows[0]?.provider || null,
      connections: { facebook, google, email },
      connectionTiers: CONNECTION_TIERS,
      armedWindowDays: firstWin.ARMED_WINDOW_DAYS,
    });
  } catch (err) {
    console.error("onboarding status error:", err);
    return res.status(500).json({ error: "Failed to load onboarding status" });
  }
}

/**
 * POST /api/onboarding/first-win/prepare
 * Stores (or honestly updates) the first-win post in the PREPARED state —
 * never scheduled, never "on the calendar" (Section A3). Editing the content
 * of an already-armed post invalidates the prior consent (content_changed)
 * inside the same transaction; the post stays prepared.
 */
async function prepareFirstWinPost(req, res) {
  const userId = req.user.userId;
  const { brandId, postContent } = req.body || {};
  if (!brandId || !UUID_RE.test(String(brandId))) {
    return res.status(400).json({ error: "brandId is required" });
  }
  const content = typeof postContent === "string" ? postContent.trim() : "";
  if (!content) {
    return res.status(400).json({ error: "postContent is required" });
  }

  const client = await db.getClient();
  try {
    const owned = await client.query(
      `SELECT brand_id FROM brands WHERE brand_id = $1 AND user_id = $2`,
      [brandId, userId],
    );
    if (owned.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: "Brand not found" });
    }

    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT post_id, status FROM social_posts
        WHERE brand_id = $1 AND platform = 'facebook' AND source = $2
        FOR UPDATE`,
      [brandId, firstWin.FIRST_WIN_SOURCE],
    );

    let post;
    if (existing.rows.length > 0) {
      if (existing.rows[0].status !== "prepared") {
        await client.query("ROLLBACK");
        client.release();
        return res.status(409).json({
          error:
            "Your first-win post has already been handed to the publishing system and can no longer be edited here.",
        });
      }
      const updated = await client.query(
        `UPDATE social_posts SET post_content = $1
          WHERE post_id = $2 AND status = 'prepared'
          RETURNING post_id, brand_id, platform, post_content, image_url, video_url, status`,
        [content, existing.rows[0].post_id],
      );
      post = updated.rows[0];
      // Content changed after consent -> prior authorization is invalidated
      // (Section A5). Guarded on 'armed'; a claimed row is untouchable.
      const newHash = firstWin.contentHashForPost(post);
      await client.query(
        `UPDATE armed_publish_authorizations
            SET status = 'invalidated', invalidation_reason = 'content_changed'
          WHERE post_id = $1 AND status = 'armed' AND content_hash <> $2`,
        [post.post_id, newHash],
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO social_posts (brand_id, platform, post_content, status, source)
         VALUES ($1, 'facebook', $2, 'prepared', $3)
         ON CONFLICT (brand_id, platform, source) WHERE source IS NOT NULL
         DO NOTHING
         RETURNING post_id, brand_id, platform, post_content, image_url, video_url, status`,
        [brandId, content, firstWin.FIRST_WIN_SOURCE],
      );
      if (inserted.rows.length === 0) {
        // Concurrent prepare won the slot — honest conflict, no silent merge.
        await client.query("ROLLBACK");
        client.release();
        return res.status(409).json({
          error: "A first-win post already exists for this business — reload and try again.",
        });
      }
      post = inserted.rows[0];
    }
    await client.query("COMMIT");
    client.release();
    return res.status(201).json({
      post: {
        postId: post.post_id,
        brandId: post.brand_id,
        platform: post.platform,
        postContent: post.post_content,
        status: post.status,
      },
      contentHash: firstWin.contentHashForPost(post),
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    client.release();
    console.error("prepare first-win post error:", err);
    return res.status(500).json({ error: "Failed to prepare your first post" });
  }
}

/**
 * POST /api/onboarding/first-win/arm
 * Captures artifact-bound consent: hashes the CURRENT prepared post
 * server-side and creates a fresh authorization row in 'armed'. Reconfirming
 * after expiry/invalidation/execution failure is this same endpoint — always
 * a NEW row with fresh consent_captured_at/armed_at; nothing is recycled.
 */
async function armFirstWinPost(req, res) {
  const userId = req.user.userId;
  const { postId, consentCopyVersion, destinationPageId } = req.body || {};
  if (!postId || !UUID_RE.test(String(postId))) {
    return res.status(400).json({ error: "postId is required" });
  }
  if (!firstWin.CONSENT_COPY_VERSIONS.includes(consentCopyVersion)) {
    return res.status(400).json({ error: "Unknown consent copy version" });
  }
  // The consent copy variant must match the destination semantics it
  // described (Section A5/J36): the "known Page" copy requires the Page id,
  // the "Page you connect during onboarding" copy requires it to be absent.
  const boundPage =
    typeof destinationPageId === "string" && destinationPageId.trim()
      ? destinationPageId.trim()
      : null;
  if (consentCopyVersion === "p024-v1-destination-known" && !boundPage) {
    return res
      .status(400)
      .json({ error: "This consent copy names an exact Page — destinationPageId is required" });
  }
  if (consentCopyVersion === "p024-v1-destination-unbound" && boundPage) {
    return res.status(400).json({
      error: "This consent copy defers the destination — destinationPageId must be empty",
    });
  }

  const client = await db.getClient();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT p.post_id, p.brand_id, p.platform, p.post_content, p.image_url,
              p.video_url, p.status
         FROM social_posts p
         JOIN brands b ON b.brand_id = p.brand_id
        WHERE p.post_id = $1 AND b.user_id = $2 AND p.source = $3
        FOR UPDATE OF p`,
      [postId, userId, firstWin.FIRST_WIN_SOURCE],
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(404).json({ error: "Prepared post not found" });
    }
    const post = rows[0];
    if (post.status !== "prepared") {
      await client.query("ROLLBACK");
      client.release();
      return res.status(409).json({
        error: "This post has already been handed to the publishing system.",
      });
    }

    const contentHash = firstWin.contentHashForPost(post);
    let inserted;
    try {
      inserted = await client.query(
        `INSERT INTO armed_publish_authorizations
           (user_id, brand_id, post_id, content_hash, destination_page_id,
            destination_bound_at, consent_copy_version, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'armed')
         RETURNING authorization_id, armed_at, consent_captured_at`,
        [
          userId,
          post.brand_id,
          post.post_id,
          contentHash,
          boundPage,
          boundPage ? new Date() : null,
          consentCopyVersion,
        ],
      );
    } catch (err) {
      await client.query("ROLLBACK");
      client.release();
      if (err.code === "23505") {
        // One active armed/claimed authorization per post (partial unique).
        return res.status(409).json({
          error: "This post already has an active authorization.",
        });
      }
      throw err;
    }
    await client.query("COMMIT");
    client.release();
    const row = inserted.rows[0];
    return res.status(201).json({
      authorization: {
        authorizationId: row.authorization_id,
        status: "armed",
        armedAt: row.armed_at,
        expiresAt: firstWin.armedWindowExpiry(row.armed_at),
        consentCapturedAt: row.consent_captured_at,
        contentHash,
        destinationPageId: boundPage,
        destinationSemantics: boundPage
          ? "exact_page"
          : "page_connected_during_onboarding",
      },
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    client.release();
    console.error("arm first-win post error:", err);
    return res.status(500).json({ error: "Failed to arm your first post" });
  }
}

/**
 * POST /api/onboarding/first-win/disarm
 * Guarded armed -> disarmed (Section C1). If the claim already committed,
 * this answers honestly that cancellation is no longer possible (C2) — it
 * never pretends, and it never touches a claimed row.
 */
async function disarmFirstWinPost(req, res) {
  const userId = req.user.userId;
  const { authorizationId } = req.body || {};
  if (!authorizationId || !UUID_RE.test(String(authorizationId))) {
    return res.status(400).json({ error: "authorizationId is required" });
  }
  try {
    const flipped = await db.query(
      `UPDATE armed_publish_authorizations
          SET status = 'disarmed', disarmed_at = NOW()
        WHERE authorization_id = $1 AND user_id = $2 AND status = 'armed'
        RETURNING authorization_id`,
      [authorizationId, userId],
    );
    if (flipped.rows.length > 0) {
      return res.json({ disarmed: true });
    }
    const current = await db.query(
      `SELECT status FROM armed_publish_authorizations
        WHERE authorization_id = $1 AND user_id = $2`,
      [authorizationId, userId],
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ error: "Authorization not found" });
    }
    const status = current.rows[0].status;
    if (status === "claimed" || status === "consumed") {
      return res.status(409).json({
        disarmed: false,
        status,
        error:
          "This post has already been claimed by the execution system and may already be publishing or live.",
      });
    }
    return res.status(409).json({
      disarmed: false,
      status,
      error: `This authorization is already ${status}.`,
    });
  } catch (err) {
    console.error("disarm first-win error:", err);
    return res.status(500).json({ error: "Failed to disarm" });
  }
}

/**
 * POST /api/onboarding/celebration/claim (Section D3).
 * Derives the qualifying uncelebrated proof and attempts the insert-once
 * claim. INSERT wins -> celebrate:true. Unique conflict -> celebrate:false,
 * won:true. No qualifying proof -> celebrate:false, won:false.
 */
async function claimCelebration(req, res) {
  const userId = req.user.userId;
  try {
    const proof = await findQualifyingProof(userId);
    if (!proof) {
      return res.json({ celebrate: false, won: false });
    }
    const inserted = await db.query(
      `INSERT INTO onboarding_first_win_celebrations
         (proof_id, user_id, brand_id, provider)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (proof_id) DO NOTHING
       RETURNING celebration_claim_id`,
      [proof.proof_id, userId, proof.brand_id, proof.provider],
    );
    if (inserted.rows.length > 0) {
      return res.json({ celebrate: true, won: true, provider: proof.provider });
    }
    return res.json({ celebrate: false, won: true, provider: proof.provider });
  } catch (err) {
    console.error("celebration claim error:", err);
    return res.status(500).json({ error: "Failed to record the celebration" });
  }
}

module.exports = {
  getStatus,
  prepareFirstWinPost,
  armFirstWinPost,
  disarmFirstWinPost,
  claimCelebration,
  // exported for tests
  findQualifyingProof,
  loadFirstWinPost,
  CONNECTION_TIERS,
};
