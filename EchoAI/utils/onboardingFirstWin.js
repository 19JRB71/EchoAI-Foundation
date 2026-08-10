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
 *    scheduled) commit in ONE database transaction (Section B1). An unbound
 *    destination is bound inside that same transaction (Section A7).
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
const { encrypt, decrypt } = require("./encryption");

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
 *   - otherwise: armed -> claimed, binds an unbound destination, and hands
 *     the post prepared -> scheduled (scheduled_time NOW()) so the EXISTING
 *     publisher picks it up on its next tick.
 *
 * Returns { claimed, postId?, authorizationId?, reason? }. Never throws to
 * the caller for expected non-claims; genuine errors roll back and rethrow.
 */
async function claimArmedAuthorization({ userId, connectedPageId, connectedPageName }) {
  if (!userId) return { claimed: false, reason: "no_user" };
  const client = await db.getClient();
  try {
    await client.query("BEGIN");
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
          AND p.source = $2
        ORDER BY a.armed_at DESC
        LIMIT 1
        FOR UPDATE OF a, p`,
      [userId, FIRST_WIN_SOURCE],
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return { claimed: false, reason: "no_armed_authorization" };
    }
    const auth = rows[0];

    // Predicate: the post must still be prepared (B2). If something already
    // moved it, the authorization must not fire.
    if (auth.post_status !== "prepared") {
      await client.query("ROLLBACK");
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
      await client.query("COMMIT");
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
      await client.query("COMMIT");
      return { claimed: false, reason: "content_changed" };
    }

    // Predicate: destination (A7). A bound destination must match the
    // connected Page exactly; an unbound one requires a real connected Page
    // to bind — a callback with no Page cannot claim.
    if (!connectedPageId) {
      await client.query("ROLLBACK");
      return { claimed: false, reason: "no_connected_page" };
    }
    if (auth.destination_page_id && auth.destination_page_id !== String(connectedPageId)) {
      await client.query(
        `UPDATE armed_publish_authorizations
            SET status = 'invalidated', invalidation_reason = 'page_switched'
          WHERE authorization_id = $1 AND status = 'armed'`,
        [auth.authorization_id],
      );
      await client.query("COMMIT");
      return { claimed: false, reason: "page_switched" };
    }

    // Predicate + binding: the EXECUTABLE destination (A7 hardening). The
    // canonical publisher posts to the brand's social_accounts facebook row
    // (pageId, token resolved live from api_integrations). The consented
    // destination and the executable destination must be the SAME Page:
    //   - no brand row yet (the normal brand-new onboarding case): create it
    //     here, inside the claim transaction, bound to the connected Page;
    //   - existing row already bound to this Page: fine;
    //   - existing row bound to a DIFFERENT Page (or one whose destination
    //     cannot be verified): invalidate as page_switched — never publish to
    //     a destination the owner did not consent to.
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
        await client.query("COMMIT");
        return { claimed: false, reason: "page_switched" };
      }
    } else {
      await client.query(
        `INSERT INTO social_accounts
           (brand_id, platform, platform_username, credentials_encrypted, connection_status)
         VALUES ($1, 'facebook', $2, $3, 'connected')
         ON CONFLICT (brand_id, platform)
         DO NOTHING`,
        [
          auth.brand_id,
          connectedPageName || String(connectedPageId),
          encrypt(JSON.stringify({ pageId: String(connectedPageId) })),
        ],
      );
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
      await client.query("ROLLBACK");
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
      await client.query("ROLLBACK");
      return { claimed: false, reason: "post_not_prepared" };
    }

    await client.query("COMMIT");
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
      await client.query("ROLLBACK");
    } catch {
      /* connection-level failure — nothing more to do */
    }
    throw err;
  } finally {
    client.release();
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
