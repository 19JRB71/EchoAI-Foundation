/**
 * Prompt 024 — onboarding first-win armed-authorization engine.
 *
 * Owns the lifecycle of armed_publish_authorizations rows (migration 140):
 *
 *   armed -> claimed -> consumed | execution_failed | (unresolved under
 *                                   MANUAL_REVIEW/reconciliation)
 *   armed -> disarmed                       (owner withdrew consent)
 *   armed -> invalidated                    (content_changed / page_switched /
 *                                            expired)
 *
 * HARD RULES (Stage-2 authorization, D-37):
 *  - claimed -> armed is ILLEGAL. No code path here ever resets a claimed
 *    row; retry is owner reconfirmation -> a brand-new authorization row.
 *  - The claim (armed -> claimed) and the post handoff (prepared ->
 *    scheduled) commit in C1's database transaction (Section B1). C1 alone
 *    confirms an unbound destination before requesting the claim.
 *  - Expiry (7 calendar days from armed_at, Section A6) is enforced at claim
 *    time: an expired authorization can never publish.
 *  - execution_failed only with definitive no-side-effect evidence
 *    (Section C4); anything uncertain leaves the row claimed while the spine
 *    holds the truth at MANUAL_REVIEW.
 *
 * Publishing itself is NOT here: after the claim transaction commits, the
 * existing canonical publisher (socialController.publishDuePosts -> task
 * spine -> executeExternal -> Facebook -> read-back proof) owns execution.
 */

const crypto = require("crypto");
const db = require("../config/db");
const { decrypt } = require("./encryption");

// Shared across C1, C3, claim and disconnect: encrypted S2 has no unique Page index.
const lockFacebookBindings = (client) => client.query("SELECT pg_advisory_xact_lock(8042080)");
async function facebookContext(client, { userId, brandId, sessionId, authorizationId, returnStep }) {
  if (!brandId && !sessionId && !authorizationId && !returnStep) return null;
  const owned = await client.query("SELECT brand_id FROM brands WHERE brand_id = $1 AND user_id = $2", [brandId, userId]);
  if (!owned.rows.length) throw Object.assign(new Error("Brand not found"), { statusCode: 404 });
  if (sessionId) {
    const session = await client.query(
      "SELECT session_id FROM setup_sessions WHERE session_id = $1 AND user_id = $2 AND brand_id = $3 AND status = 'in_progress'",
      [sessionId, userId, brandId]);
    if (!session.rows.length) throw Object.assign(new Error("Setup session does not match this business"), { statusCode: 409 });
  }
  if (!authorizationId) return null;
  const auth = await client.query(
    `SELECT destination_page_id FROM armed_publish_authorizations
      WHERE authorization_id = $1 AND user_id = $2 AND brand_id = $3 AND status = 'armed'`,
    [authorizationId, userId, brandId]);
  if (!auth.rows.length) throw Object.assign(new Error("Authorization does not match this business"), { statusCode: 409 });
  return auth.rows[0];
}
function requireFacebookOwner(user) {
  if (!user?.userId || user.isTeamMember || (user.workspaceRole && user.workspaceRole !== "owner") ||
      (user.actualUserId && user.actualUserId !== user.userId)) {
    throw Object.assign(new Error("Only the business owner may confirm Facebook destinations"), { statusCode: 403 });
  }
}
async function facebookBindings(client = db) {
  const { rows } = await client.query(
    `SELECT b.brand_id, b.brand_name, b.user_id, b.facebook_page_id, s.account_id, s.credentials_encrypted
       FROM brands b LEFT JOIN social_accounts s ON s.brand_id = b.brand_id AND s.platform = 'facebook'`);
  return rows.map((r) => {
    const postingPageId = r.credentials_encrypted ? JSON.parse(decrypt(r.credentials_encrypted)).pageId : null;
    if (r.account_id && (typeof postingPageId !== "string" || !postingPageId)) {
      throw new Error("Facebook binding cannot be verified; manual review required");
    }
    return { ...r, postingPageId };
  });
}
async function validateFacebookDestination(client, userId, brandId, pageId) {
  const owned = await client.query(
    "SELECT brand_id FROM brands WHERE brand_id = $1 AND user_id = $2 FOR UPDATE", [brandId, userId]);
  if (!owned.rows.length) throw Object.assign(new Error("Brand not found"), { statusCode: 404 });
  const bindings = await facebookBindings(client);
  const brand = bindings.find((b) => b.brand_id === brandId && b.user_id === userId);
  if (!brand) throw Object.assign(new Error("Brand not found"), { statusCode: 404 });
  if (!pageId || bindings.some((b) => b.brand_id !== brandId &&
      [b.postingPageId, b.facebook_page_id].includes(pageId))) {
    throw Object.assign(new Error("Page is unavailable or bound to another business"), { statusCode: 409 });
  }
  const { rows } = await client.query(
    `SELECT facebook_pages, facebook_page_tokens FROM api_integrations
      WHERE user_id = $1 AND platform = 'facebook' AND connection_status = 'connected' FOR UPDATE`, [userId]);
  const grant = rows[0];
  const page = grant?.facebook_pages?.find((p) => p.id === pageId);
  const token = grant?.facebook_page_tokens && JSON.parse(decrypt(grant.facebook_page_tokens))[pageId];
  if (!page || !token) throw Object.assign(new Error("Page access unavailable; reconnect Facebook"), { statusCode: 409 });
  return { brand, page, token };
}

// The one first-win source slot (second idempotency belt via the existing
// uq_social_posts_brand_platform_source partial unique index, migration 078).
const FIRST_WIN_SOURCE = "onboarding_first_win";

// Consent staleness window — OWNER RULING (Section A6): 7 calendar days from
// armed_at. Claim eligibility requires now < armed_at + 7 days.
const ARMED_WINDOW_DAYS = 7;

// Consent copy versions the client may capture. The two variants carry the
// two destination semantics (Section I / J36): the exact known Page, or "the
// Facebook Page you connect during onboarding".
const CONSENT_COPY_VERSIONS = [
  "p024-v1-destination-known",
  "p024-v1-destination-unbound",
];

/**
 * Canonical content hash binding consent to the exact prepared artifact
 * (Section A5): post text, media references, and the platform/destination
 * class. Any material change produces a different hash and invalidates the
 * prior consent.
 */
function contentHashForPost(post) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        postContent: post.post_content || "",
        imageUrl: post.image_url || null,
        videoUrl: post.video_url || null,
        platform: post.platform || "",
        destinationClass: "facebook_page",
      }),
    )
    .digest("hex");
}

/** True when an armed_at timestamp is still inside the 7-day window. */
function isWithinArmedWindow(armedAt, now = new Date()) {
  const expires = new Date(new Date(armedAt).getTime() + ARMED_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return now < expires;
}

/** Expiry timestamp for an armed_at value (projection display). */
function armedWindowExpiry(armedAt) {
  return new Date(new Date(armedAt).getTime() + ARMED_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Test seam for the acceptance-critical B3 fault-injection regression: called
 * between the authorization claim write and the post handoff write, INSIDE
 * the claim transaction. Production behavior: no-op.
 */
async function afterClaimWrite(/* client */) {}

/**
 * The atomic claim + handoff (Sections B1/B2). Called from the Facebook
 * connection callback after the api_integrations upsert succeeds.
 *
 * In ONE transaction, for the caller's armed authorization (if any):
 *   - re-checks every claim predicate under FOR UPDATE;
 *   - invalidates (expired / content_changed / page_switched) when consent no
 *     longer matches reality — post stays prepared, no publish;
 *   - otherwise: armed -> claimed for C1's confirmed destination, and hands
 *     the post prepared -> scheduled (scheduled_time NOW()) so the EXISTING
 *     publisher picks it up on its next tick.
 *
 * Returns { claimed, postId?, authorizationId?, reason? }. Never throws to
 * the caller for expected non-claims; genuine errors roll back and rethrow.
 */
async function claimArmedAuthorization({ userId, brandId, authorizationId, connectedPageId, transaction }) {
  if (!userId || !brandId || !authorizationId) return { claimed: false, reason: "context_required" };
  const client = transaction || await db.getClient();
  // C1 owns commit/rollback when continuing prepared-content consent atomically.
  try {
    if (!transaction) await client.query("BEGIN");
    await lockFacebookBindings(client);
    // Lock the authorization AND its post so a concurrent callback replay,
    // disarm, or content edit serializes behind this transaction.
    const { rows } = await client.query(
      `SELECT a.authorization_id, a.status, a.armed_at, a.content_hash,
              a.destination_page_id, a.post_id,
              p.status AS post_status, p.post_content, p.image_url, p.video_url,
              p.platform, p.brand_id
         FROM armed_publish_authorizations a
         JOIN social_posts p ON p.post_id = a.post_id
        WHERE a.user_id = $1 AND a.status = 'armed'
          AND p.source = $2 AND a.authorization_id = $3
          AND a.brand_id = $4 AND p.brand_id = $4
        FOR UPDATE OF a, p`,
      [userId, FIRST_WIN_SOURCE, authorizationId, brandId],
    );
    if (rows.length === 0) {
      if (!transaction) await client.query("ROLLBACK");
      return { claimed: false, reason: "no_armed_authorization" };
    }
    const auth = rows[0];

    // Predicate: the post must still be prepared (B2). If something already
    // moved it, the authorization must not fire.
    if (auth.post_status !== "prepared") {
      if (!transaction) await client.query("ROLLBACK");
      return { claimed: false, reason: "post_not_prepared" };
    }

    // Predicate: 7-day armed_at window (A6). Expired consent is invalidated
    // honestly — RECONFIRMATION REQUIRED, never publish-first-ask-later.
    if (!isWithinArmedWindow(auth.armed_at)) {
      await client.query(
        `UPDATE armed_publish_authorizations
            SET status = 'invalidated', invalidation_reason = 'expired'
          WHERE authorization_id = $1 AND status = 'armed'`,
        [auth.authorization_id],
      );
      if (!transaction) await client.query("COMMIT");
      return { claimed: false, reason: "expired" };
    }

    // Predicate: consent binds to the exact artifact (A5). A drifted hash
    // means the content changed after consent — invalidate, keep prepared.
    const currentHash = contentHashForPost(auth);
    if (currentHash !== auth.content_hash) {
      await client.query(
        `UPDATE armed_publish_authorizations
            SET status = 'invalidated', invalidation_reason = 'content_changed'
          WHERE authorization_id = $1 AND status = 'armed'`,
        [auth.authorization_id],
      );
      if (!transaction) await client.query("COMMIT");
      return { claimed: false, reason: "content_changed" };
    }

    // Predicate: destination (A7). C1 must already have confirmed the exact
    // Page; a destination-null authorization can never claim here.
    if (!connectedPageId || !auth.destination_page_id) {
      if (!transaction) await client.query("ROLLBACK");
      return { claimed: false, reason: "no_connected_page" };
    }
    if (auth.destination_page_id && auth.destination_page_id !== String(connectedPageId)) {
      await client.query(
        `UPDATE armed_publish_authorizations
            SET status = 'invalidated', invalidation_reason = 'page_switched'
          WHERE authorization_id = $1 AND status = 'armed'`,
        [auth.authorization_id],
      );
      if (!transaction) await client.query("COMMIT");
      return { claimed: false, reason: "page_switched" };
    }
    await validateFacebookDestination(client, userId, brandId, connectedPageId);

    // Claim only the exact binding already confirmed by C1; never create S2 here.
    const acct = await client.query(
      `SELECT account_id, credentials_encrypted
         FROM social_accounts
        WHERE brand_id = $1 AND platform = 'facebook'
        FOR UPDATE`,
      [auth.brand_id],
    );
    if (acct.rows.length > 0) {
      let executablePageId = null;
      try {
        executablePageId =
          JSON.parse(decrypt(acct.rows[0].credentials_encrypted)).pageId || null;
      } catch {
        executablePageId = null;
      }
      if (executablePageId !== String(connectedPageId)) {
        await client.query(
          `UPDATE armed_publish_authorizations
              SET status = 'invalidated', invalidation_reason = 'page_switched'
            WHERE authorization_id = $1 AND status = 'armed'`,
          [auth.authorization_id],
        );
        if (!transaction) await client.query("COMMIT");
        return { claimed: false, reason: "page_switched" };
      }
    } else {
      if (!transaction) await client.query("ROLLBACK");
      return { claimed: false, reason: "page_confirmation_required" };
    }

    // Claim: armed -> claimed, binding the destination in the SAME statement
    // (never destination-null after a successful claim). Guarded on status so
    // the row count is the truth.
    const claimed = await client.query(
      `UPDATE armed_publish_authorizations
          SET status = 'claimed', claimed_at = NOW(),
              destination_page_id = $2,
              destination_bound_at = COALESCE(destination_bound_at, NOW())
        WHERE authorization_id = $1 AND status = 'armed'
        RETURNING authorization_id`,
      [auth.authorization_id, String(connectedPageId)],
    );
    if (claimed.rows.length === 0) {
      if (!transaction) await client.query("ROLLBACK");
      return { claimed: false, reason: "lost_claim_race" };
    }

    // B3 fault-injection seam (tests stub this to throw; production no-op).
    await module.exports.afterClaimWrite(client);

    // Handoff: prepared -> scheduled NOW, inside the same transaction (B1).
    const handed = await client.query(
      `UPDATE social_posts
          SET status = 'scheduled', scheduled_time = NOW()
        WHERE post_id = $1 AND status = 'prepared'
        RETURNING post_id`,
      [auth.post_id],
    );
    if (handed.rows.length === 0) {
      // The post moved under us despite the lock — impossible in practice,
      // but never leave claimed+prepared observable: roll everything back.
      if (!transaction) await client.query("ROLLBACK");
      return { claimed: false, reason: "post_not_prepared" };
    }

    if (!transaction) await client.query("COMMIT");
    return {
      claimed: true,
      authorizationId: auth.authorization_id,
      postId: auth.post_id,
      brandId: auth.brand_id,
      platform: auth.platform,
      postContent: auth.post_content,
      scheduledTime: new Date(),
    };
  } catch (err) {
    try {
      if (!transaction) await client.query("ROLLBACK");
    } catch {
      /* connection-level failure — nothing more to do */
    }
    throw err;
  } finally {
    if (!transaction) client.release();
  }
}

/**
 * Resolves a CLAIMED authorization after the canonical publisher finished
 * with its post (Section C4/C5). Guarded on status = 'claimed' so it is a
 * no-op for every non-first-win post and for already-resolved rows.
 *
 *   outcome 'consumed'         — provider success (post row hit 'published')
 *   outcome 'execution_failed' — hard failure WITH definitive no-side-effect
 *                                evidence (the error was raised BEFORE the
 *                                execution gateway / provider invocation)
 *   outcome 'uncertain'        — deliberate NO-OP: the row stays claimed and
 *                                the spine's MANUAL_REVIEW holds the truth.
 *
 * Never throws — publishing bookkeeping must not break the publisher.
 */
async function resolveAuthorizationAfterPublish(postId, outcome) {
  try {
    if (outcome === "consumed") {
      await db.query(
        `UPDATE armed_publish_authorizations
            SET status = 'consumed', consumed_at = NOW()
          WHERE post_id = $1 AND status = 'claimed'`,
        [postId],
      );
    } else if (outcome === "execution_failed") {
      await db.query(
        `UPDATE armed_publish_authorizations
            SET status = 'execution_failed', execution_failed_at = NOW()
          WHERE post_id = $1 AND status = 'claimed'`,
        [postId],
      );
    }
    // 'uncertain' (and anything else): no state change — never guess.
  } catch (err) {
    console.error("onboardingFirstWin: authorization resolve failed:", err.message);
  }
}

module.exports = {
  facebookContext,
  lockFacebookBindings,
  requireFacebookOwner,
  facebookBindings,
  validateFacebookDestination,
  FIRST_WIN_SOURCE,
  ARMED_WINDOW_DAYS,
  CONSENT_COPY_VERSIONS,
  contentHashForPost,
  isWithinArmedWindow,
  armedWindowExpiry,
  afterClaimWrite,
  claimArmedAuthorization,
  resolveAuthorizationAfterPublish,
};
