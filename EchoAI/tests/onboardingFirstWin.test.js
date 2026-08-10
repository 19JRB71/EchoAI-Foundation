// Prompt 024 — onboarding first-win engine tests (Section J).
//
// DB-backed against the isolated test database (dbGuard/resolveTestDb), using
// the app's real modules so every guarded UPDATE, partial unique index, and
// transaction boundary is the exact SQL production runs.
//
// Covers: prepared-not-scheduled honesty, artifact-bound consent capture and
// the consent/destination copy contract, every invalidation path (expired /
// content_changed / page_switched), the ATOMIC claim + handoff (including the
// acceptance-critical B3 fault-injection rollback and parallel-claim race),
// disarm interleavings (claim-first honesty, claimed→armed illegality),
// post-execution resolution (consumed / definitive execution_failed /
// uncertain-stays-claimed), the pure status projection (zero writes, expiry
// projected not written), the insert-once celebration claim (FB + Google,
// parallel race), GA4 first-win negatives, and parked ≠ completed.

const test = require("node:test");
const assert = require("node:assert/strict");

require("./dbGuard");
const db = require("../config/db");
const firstWin = require("../utils/onboardingFirstWin");
const onboarding = require("../controllers/onboardingController");
const guidedSetup = require("../controllers/guidedSetupController");
const social = require("../controllers/socialController");
const google = require("../controllers/googleController");
const { recordExternalProof } = require("../utils/externalProofs");

// ---------------------------------------------------------------------------
// Helpers

let seq = 0;
function uniq(prefix) {
  seq += 1;
  return `${prefix}-${Date.now()}-${process.pid}-${seq}`;
}

async function createUser() {
  const { rows } = await db.query(
    "INSERT INTO users (email, password_hash, onboarding_completed) VALUES ($1, $2, FALSE) RETURNING user_id",
    [`${uniq("p024")}@example.test`, "test-not-a-real-hash"],
  );
  return rows[0].user_id;
}

async function createBrand(userId) {
  const { rows } = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, $2) RETURNING brand_id",
    [userId, uniq("P024 Brand")],
  );
  return rows[0].brand_id;
}

async function deleteUser(userId) {
  await db.query("DELETE FROM brands WHERE user_id = $1", [userId]);
  await db.query("DELETE FROM users WHERE user_id = $1", [userId]);
}

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

function req(userId, body = {}) {
  return { user: { userId }, body };
}

async function preparePost(userId, brandId, content = "Our first post!") {
  const res = mockRes();
  await onboarding.prepareFirstWinPost(req(userId, { brandId, postContent: content }), res);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  return res.body.post;
}

async function armPost(userId, postId, opts = {}) {
  const res = mockRes();
  await onboarding.armFirstWinPost(
    req(userId, {
      postId,
      consentCopyVersion: opts.consentCopyVersion || "p024-v1-destination-unbound",
      destinationPageId: opts.destinationPageId,
    }),
    res,
  );
  return res;
}

async function authRow(authorizationId) {
  const { rows } = await db.query(
    "SELECT * FROM armed_publish_authorizations WHERE authorization_id = $1",
    [authorizationId],
  );
  return rows[0];
}

async function postRow(postId) {
  const { rows } = await db.query("SELECT * FROM social_posts WHERE post_id = $1", [postId]);
  return rows[0];
}

async function backdateArmedAt(authorizationId, days) {
  await db.query(
    `UPDATE armed_publish_authorizations
        SET armed_at = NOW() - make_interval(days => $2)
      WHERE authorization_id = $1`,
    [authorizationId, days],
  );
}

// ---------------------------------------------------------------------------
// A. Prepare — honest PREPARED state, never scheduled

test("J: prepare stores the post as 'prepared' with the first-win source and NO scheduled_time", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    const row = await postRow(post.postId);
    assert.equal(row.status, "prepared");
    assert.equal(row.source, "onboarding_first_win");
    assert.equal(row.scheduled_time, null); // never "on the calendar"
    assert.equal(row.published_time, null);
  } finally {
    await deleteUser(userId);
  }
});

test("J: prepare rejects a brand the caller does not own", async () => {
  const userId = await createUser();
  const other = await createUser();
  try {
    const otherBrand = await createBrand(other);
    const res = mockRes();
    await onboarding.prepareFirstWinPost(
      req(userId, { brandId: otherBrand, postContent: "x" }),
      res,
    );
    assert.equal(res.statusCode, 404);
  } finally {
    await deleteUser(userId);
    await deleteUser(other);
  }
});

test("J: editing a prepared post invalidates a prior armed authorization as content_changed", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId, "version one");
    const armRes = await armPost(userId, post.postId);
    assert.equal(armRes.statusCode, 201);
    const authId = armRes.body.authorization.authorizationId;

    const res = mockRes();
    await onboarding.prepareFirstWinPost(
      req(userId, { brandId, postContent: "version two" }),
      res,
    );
    assert.equal(res.statusCode, 201);
    const auth = await authRow(authId);
    assert.equal(auth.status, "invalidated");
    assert.equal(auth.invalidation_reason, "content_changed");
    // The post itself stays prepared — nothing was published or lost.
    assert.equal((await postRow(post.postId)).status, "prepared");
  } finally {
    await deleteUser(userId);
  }
});

test("J: re-preparing with IDENTICAL content leaves an armed authorization armed", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId, "same words");
    const armRes = await armPost(userId, post.postId);
    const res = mockRes();
    await onboarding.prepareFirstWinPost(
      req(userId, { brandId, postContent: "same words" }),
      res,
    );
    assert.equal(res.statusCode, 201);
    assert.equal(
      (await authRow(armRes.body.authorization.authorizationId)).status,
      "armed",
    );
  } finally {
    await deleteUser(userId);
  }
});

test("J: a post already handed to the publisher can no longer be edited via prepare", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    await db.query("UPDATE social_posts SET status = 'scheduled', scheduled_time = NOW() WHERE post_id = $1", [post.postId]);
    const res = mockRes();
    await onboarding.prepareFirstWinPost(req(userId, { brandId, postContent: "too late" }), res);
    assert.equal(res.statusCode, 409);
  } finally {
    await deleteUser(userId);
  }
});

// ---------------------------------------------------------------------------
// B. Arm — artifact-bound consent capture

test("J: arm captures consent bound to the exact content hash with a 7-day window", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId, "hash me");
    const res = await armPost(userId, post.postId);
    assert.equal(res.statusCode, 201);
    const auth = await authRow(res.body.authorization.authorizationId);
    assert.equal(auth.status, "armed");
    assert.equal(auth.consent_copy_version, "p024-v1-destination-unbound");
    assert.equal(auth.destination_page_id, null);
    assert.equal(auth.destination_bound_at, null);
    assert.ok(auth.consent_captured_at);
    const row = await postRow(post.postId);
    assert.equal(auth.content_hash, firstWin.contentHashForPost(row));
    assert.equal(firstWin.ARMED_WINDOW_DAYS, 7);
    // Arming NEVER schedules: the post is still prepared.
    assert.equal(row.status, "prepared");
  } finally {
    await deleteUser(userId);
  }
});

test("J: arm rejects unknown consent copy versions", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    const res = await armPost(userId, post.postId, { consentCopyVersion: "made-up" });
    assert.equal(res.statusCode, 400);
  } finally {
    await deleteUser(userId);
  }
});

test("J: consent copy variant must match destination semantics (known needs a Page, unbound forbids one)", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    const known = await armPost(userId, post.postId, {
      consentCopyVersion: "p024-v1-destination-known",
    });
    assert.equal(known.statusCode, 400); // names a Page but none given
    const unbound = await armPost(userId, post.postId, {
      consentCopyVersion: "p024-v1-destination-unbound",
      destinationPageId: "123456",
    });
    assert.equal(unbound.statusCode, 400); // defers the Page but one given
  } finally {
    await deleteUser(userId);
  }
});

test("J: arming with the known-destination copy binds the Page at consent time", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    const res = await armPost(userId, post.postId, {
      consentCopyVersion: "p024-v1-destination-known",
      destinationPageId: "page-777",
    });
    assert.equal(res.statusCode, 201);
    const auth = await authRow(res.body.authorization.authorizationId);
    assert.equal(auth.destination_page_id, "page-777");
    assert.ok(auth.destination_bound_at);
  } finally {
    await deleteUser(userId);
  }
});

test("J: only one ACTIVE authorization per post — a second arm is refused (409)", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    assert.equal((await armPost(userId, post.postId)).statusCode, 201);
    assert.equal((await armPost(userId, post.postId)).statusCode, 409);
  } finally {
    await deleteUser(userId);
  }
});

test("J: arm refuses a post that is no longer prepared", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    await db.query("UPDATE social_posts SET status = 'scheduled', scheduled_time = NOW() WHERE post_id = $1", [post.postId]);
    assert.equal((await armPost(userId, post.postId)).statusCode, 409);
  } finally {
    await deleteUser(userId);
  }
});

// ---------------------------------------------------------------------------
// C. Claim + handoff — the ONE atomic transaction

test("J: a valid claim atomically flips armed→claimed, binds the destination, and hands prepared→scheduled NOW", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    const armRes = await armPost(userId, post.postId);
    const result = await firstWin.claimArmedAuthorization({
      userId,
      connectedPageId: "page-42",
    });
    assert.equal(result.claimed, true);
    assert.equal(result.postId, post.postId);
    const auth = await authRow(armRes.body.authorization.authorizationId);
    assert.equal(auth.status, "claimed");
    assert.ok(auth.claimed_at);
    assert.equal(auth.destination_page_id, "page-42"); // bound in the SAME tx
    assert.ok(auth.destination_bound_at);
    const row = await postRow(post.postId);
    assert.equal(row.status, "scheduled");
    assert.ok(row.scheduled_time <= new Date());
  } finally {
    await deleteUser(userId);
  }
});

test("J: a claim for a brand with NO facebook social account creates the executable Page binding in the same tx", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    await armPost(userId, post.postId);
    const result = await firstWin.claimArmedAuthorization({
      userId,
      connectedPageId: "page-exec-1",
      connectedPageName: "Exec Page",
    });
    assert.equal(result.claimed, true);
    // The canonical publisher's destination row now exists and points at the
    // EXACT consented Page — consent destination === executable destination.
    const { rows } = await db.query(
      `SELECT platform_username, credentials_encrypted, connection_status
         FROM social_accounts WHERE brand_id = $1 AND platform = 'facebook'`,
      [brandId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].connection_status, "connected");
    assert.equal(rows[0].platform_username, "Exec Page");
    const { decrypt } = require("../utils/encryption");
    assert.equal(JSON.parse(decrypt(rows[0].credentials_encrypted)).pageId, "page-exec-1");
  } finally {
    await deleteUser(userId);
  }
});

test("J: a claim NEVER fires when the brand's existing facebook account points at a DIFFERENT Page (page_switched)", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const { encrypt } = require("../utils/encryption");
    await db.query(
      `INSERT INTO social_accounts (brand_id, platform, platform_username, credentials_encrypted, connection_status)
       VALUES ($1, 'facebook', 'Old Page', $2, 'connected')`,
      [brandId, encrypt(JSON.stringify({ pageId: "page-OLD" }))],
    );
    const post = await preparePost(userId, brandId);
    const armRes = await armPost(userId, post.postId);
    const result = await firstWin.claimArmedAuthorization({
      userId,
      connectedPageId: "page-NEW",
    });
    assert.equal(result.claimed, false);
    assert.equal(result.reason, "page_switched");
    const auth = await authRow(armRes.body.authorization.authorizationId);
    assert.equal(auth.status, "invalidated");
    assert.equal(auth.invalidation_reason, "page_switched");
    assert.equal((await postRow(post.postId)).status, "prepared"); // never handed off
    // The pre-existing binding is untouched — we never silently repoint it.
    const { rows } = await db.query(
      `SELECT credentials_encrypted FROM social_accounts WHERE brand_id = $1 AND platform = 'facebook'`,
      [brandId],
    );
    const { decrypt } = require("../utils/encryption");
    assert.equal(JSON.parse(decrypt(rows[0].credentials_encrypted)).pageId, "page-OLD");
  } finally {
    await deleteUser(userId);
  }
});

test("J: a claim proceeds when the brand's existing facebook account already points at the SAME Page", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const { encrypt } = require("../utils/encryption");
    await db.query(
      `INSERT INTO social_accounts (brand_id, platform, platform_username, credentials_encrypted, connection_status)
       VALUES ($1, 'facebook', 'Same Page', $2, 'connected')`,
      [brandId, encrypt(JSON.stringify({ pageId: "page-SAME" }))],
    );
    const post = await preparePost(userId, brandId);
    await armPost(userId, post.postId);
    const result = await firstWin.claimArmedAuthorization({
      userId,
      connectedPageId: "page-SAME",
    });
    assert.equal(result.claimed, true);
    assert.equal((await postRow(post.postId)).status, "scheduled");
  } finally {
    await deleteUser(userId);
  }
});

test("J: claim with no armed authorization is a clean no-op", async () => {
  const userId = await createUser();
  try {
    const result = await firstWin.claimArmedAuthorization({
      userId,
      connectedPageId: "page-1",
    });
    assert.equal(result.claimed, false);
    assert.equal(result.reason, "no_armed_authorization");
  } finally {
    await deleteUser(userId);
  }
});

test("J: a callback that connected NO Page cannot claim — the authorization stays armed", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    const armRes = await armPost(userId, post.postId);
    const result = await firstWin.claimArmedAuthorization({ userId, connectedPageId: null });
    assert.equal(result.claimed, false);
    assert.equal(result.reason, "no_connected_page");
    assert.equal((await authRow(armRes.body.authorization.authorizationId)).status, "armed");
    assert.equal((await postRow(post.postId)).status, "prepared");
  } finally {
    await deleteUser(userId);
  }
});

test("J: an EXPIRED authorization is invalidated at claim time and never publishes (reconfirmation required)", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    const armRes = await armPost(userId, post.postId);
    await backdateArmedAt(armRes.body.authorization.authorizationId, 8);
    const result = await firstWin.claimArmedAuthorization({ userId, connectedPageId: "p" });
    assert.equal(result.claimed, false);
    assert.equal(result.reason, "expired");
    const auth = await authRow(armRes.body.authorization.authorizationId);
    assert.equal(auth.status, "invalidated");
    assert.equal(auth.invalidation_reason, "expired");
    assert.equal((await postRow(post.postId)).status, "prepared");
  } finally {
    await deleteUser(userId);
  }
});

test("J: an authorization still inside its 7 calendar days claims normally (day 6)", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    const armRes = await armPost(userId, post.postId);
    await backdateArmedAt(armRes.body.authorization.authorizationId, 6);
    const result = await firstWin.claimArmedAuthorization({ userId, connectedPageId: "p" });
    assert.equal(result.claimed, true);
  } finally {
    await deleteUser(userId);
  }
});

test("J: content drift after consent invalidates as content_changed at claim time", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId, "original");
    const armRes = await armPost(userId, post.postId);
    // Drift the content underneath the consent, bypassing the prepare
    // endpoint (which would have invalidated already) — the claim itself
    // must still catch the mismatch.
    await db.query("UPDATE social_posts SET post_content = 'tampered' WHERE post_id = $1", [post.postId]);
    const result = await firstWin.claimArmedAuthorization({ userId, connectedPageId: "p" });
    assert.equal(result.claimed, false);
    assert.equal(result.reason, "content_changed");
    const auth = await authRow(armRes.body.authorization.authorizationId);
    assert.equal(auth.status, "invalidated");
    assert.equal(auth.invalidation_reason, "content_changed");
    assert.equal((await postRow(post.postId)).status, "prepared");
  } finally {
    await deleteUser(userId);
  }
});

test("J: a bound destination that no longer matches the connected Page invalidates as page_switched", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    const armRes = await armPost(userId, post.postId, {
      consentCopyVersion: "p024-v1-destination-known",
      destinationPageId: "page-A",
    });
    const result = await firstWin.claimArmedAuthorization({ userId, connectedPageId: "page-B" });
    assert.equal(result.claimed, false);
    assert.equal(result.reason, "page_switched");
    const auth = await authRow(armRes.body.authorization.authorizationId);
    assert.equal(auth.status, "invalidated");
    assert.equal(auth.invalidation_reason, "page_switched");
    assert.equal((await postRow(post.postId)).status, "prepared");
  } finally {
    await deleteUser(userId);
  }
});

test("J (B3, acceptance-critical): a fault between the claim write and the handoff write rolls BOTH back", async () => {
  const userId = await createUser();
  const original = firstWin.afterClaimWrite;
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    const armRes = await armPost(userId, post.postId);
    firstWin.afterClaimWrite = async () => {
      throw new Error("injected fault between claim and handoff");
    };
    await assert.rejects(
      firstWin.claimArmedAuthorization({ userId, connectedPageId: "p" }),
      /injected fault/,
    );
    // NOTHING moved: no claimed-without-scheduled, no scheduled-without-claim.
    const auth = await authRow(armRes.body.authorization.authorizationId);
    assert.equal(auth.status, "armed");
    assert.equal(auth.claimed_at, null);
    assert.equal(auth.destination_page_id, null);
    assert.equal((await postRow(post.postId)).status, "prepared");
    // And after the fault clears, the SAME authorization claims cleanly.
    firstWin.afterClaimWrite = original;
    const retry = await firstWin.claimArmedAuthorization({ userId, connectedPageId: "p" });
    assert.equal(retry.claimed, true);
  } finally {
    firstWin.afterClaimWrite = original;
    await deleteUser(userId);
  }
});

test("J: parallel claims for the same authorization — exactly one wins, the post schedules exactly once", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    await armPost(userId, post.postId);
    const [a, b] = await Promise.all([
      firstWin.claimArmedAuthorization({ userId, connectedPageId: "p1" }),
      firstWin.claimArmedAuthorization({ userId, connectedPageId: "p1" }),
    ]);
    const wins = [a, b].filter((r) => r.claimed);
    assert.equal(wins.length, 1);
    const { rows } = await db.query(
      "SELECT COUNT(*)::int AS n FROM armed_publish_authorizations WHERE post_id = $1 AND status = 'claimed'",
      [post.postId],
    );
    assert.equal(rows[0].n, 1);
    assert.equal((await postRow(post.postId)).status, "scheduled");
  } finally {
    await deleteUser(userId);
  }
});

// ---------------------------------------------------------------------------
// D. Post-execution resolution — consumed / execution_failed / uncertain

async function claimedFixture(userId) {
  const brandId = await createBrand(userId);
  const post = await preparePost(userId, brandId);
  const armRes = await armPost(userId, post.postId);
  const result = await firstWin.claimArmedAuthorization({ userId, connectedPageId: "p" });
  assert.equal(result.claimed, true);
  return { brandId, postId: post.postId, authId: armRes.body.authorization.authorizationId };
}

test("J: provider success resolves claimed→consumed", async () => {
  const userId = await createUser();
  try {
    const { postId, authId } = await claimedFixture(userId);
    await firstWin.resolveAuthorizationAfterPublish(postId, "consumed");
    const auth = await authRow(authId);
    assert.equal(auth.status, "consumed");
    assert.ok(auth.consumed_at);
  } finally {
    await deleteUser(userId);
  }
});

test("J: definitive pre-provider failure resolves claimed→execution_failed", async () => {
  const userId = await createUser();
  try {
    const { postId, authId } = await claimedFixture(userId);
    await firstWin.resolveAuthorizationAfterPublish(postId, "execution_failed");
    const auth = await authRow(authId);
    assert.equal(auth.status, "execution_failed");
    assert.ok(auth.execution_failed_at);
  } finally {
    await deleteUser(userId);
  }
});

test("J: an UNCERTAIN failure leaves the authorization claimed (never guessed terminal)", async () => {
  const userId = await createUser();
  try {
    const { postId, authId } = await claimedFixture(userId);
    await firstWin.resolveAuthorizationAfterPublish(postId, "uncertain");
    assert.equal((await authRow(authId)).status, "claimed");
  } finally {
    await deleteUser(userId);
  }
});

test("J: resolution is a no-op for a non-claimed authorization (armed stays armed)", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    const armRes = await armPost(userId, post.postId);
    await firstWin.resolveAuthorizationAfterPublish(post.postId, "consumed");
    assert.equal((await authRow(armRes.body.authorization.authorizationId)).status, "armed");
  } finally {
    await deleteUser(userId);
  }
});

test("J: errors raised before the execution gateway carry preProvider=true (missing connection)", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    let thrown = null;
    try {
      await social.publishStoredPost({
        post_id: "00000000-0000-0000-0000-000000000000",
        brand_id: brandId,
        platform: "facebook",
        post_content: "x",
      });
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown, "expected publishStoredPost to fail without a connection");
    assert.equal(thrown.preProvider, true);
  } finally {
    await deleteUser(userId);
  }
});

// ---------------------------------------------------------------------------
// E. Disarm interleavings

test("J: disarm flips armed→disarmed before any claim", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    const armRes = await armPost(userId, post.postId);
    const res = mockRes();
    await onboarding.disarmFirstWinPost(
      req(userId, { authorizationId: armRes.body.authorization.authorizationId }),
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.disarmed, true);
    const auth = await authRow(armRes.body.authorization.authorizationId);
    assert.equal(auth.status, "disarmed");
    assert.ok(auth.disarmed_at);
    // A disarmed authorization can never claim.
    const claim = await firstWin.claimArmedAuthorization({ userId, connectedPageId: "p" });
    assert.equal(claim.claimed, false);
    assert.equal((await postRow(post.postId)).status, "prepared");
  } finally {
    await deleteUser(userId);
  }
});

test("J: claim-first, disarm-second — the owner gets the honest 'already claimed' answer and the row NEVER re-arms", async () => {
  const userId = await createUser();
  try {
    const { authId } = await claimedFixture(userId);
    const res = mockRes();
    await onboarding.disarmFirstWinPost(req(userId, { authorizationId: authId }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.disarmed, false);
    assert.match(res.body.error, /already been claimed/i);
    // claimed→armed is illegal: still claimed, untouched.
    assert.equal((await authRow(authId)).status, "claimed");
  } finally {
    await deleteUser(userId);
  }
});

test("J: disarming an already-disarmed (or foreign) authorization answers honestly", async () => {
  const userId = await createUser();
  const other = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    const armRes = await armPost(userId, post.postId);
    const authId = armRes.body.authorization.authorizationId;
    const first = mockRes();
    await onboarding.disarmFirstWinPost(req(userId, { authorizationId: authId }), first);
    assert.equal(first.body.disarmed, true);
    const second = mockRes();
    await onboarding.disarmFirstWinPost(req(userId, { authorizationId: authId }), second);
    assert.equal(second.statusCode, 409);
    assert.match(second.body.error, /disarmed/);
    // Another user cannot even see it.
    const foreign = mockRes();
    await onboarding.disarmFirstWinPost(req(other, { authorizationId: authId }), foreign);
    assert.equal(foreign.statusCode, 404);
  } finally {
    await deleteUser(userId);
    await deleteUser(other);
  }
});

test("J: after invalidation, reconfirmation arms a brand-NEW row with fresh consent; the old row is never re-armed", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    const first = await armPost(userId, post.postId);
    const firstId = first.body.authorization.authorizationId;
    await backdateArmedAt(firstId, 8);
    await firstWin.claimArmedAuthorization({ userId, connectedPageId: "p" }); // invalidates expired
    assert.equal((await authRow(firstId)).status, "invalidated");

    const second = await armPost(userId, post.postId);
    assert.equal(second.statusCode, 201);
    const secondId = second.body.authorization.authorizationId;
    assert.notEqual(secondId, firstId);
    assert.equal((await authRow(secondId)).status, "armed");
    assert.equal((await authRow(firstId)).status, "invalidated"); // history intact
  } finally {
    await deleteUser(userId);
  }
});

// ---------------------------------------------------------------------------
// F. Status projection — pure, zero writes

test("J: GET /api/onboarding/status performs ZERO writes — an expired armed row is projected, not flipped", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    const armRes = await armPost(userId, post.postId);
    const authId = armRes.body.authorization.authorizationId;
    await backdateArmedAt(authId, 8);

    const before = await db.query(
      `SELECT status, invalidation_reason, updated_at FROM armed_publish_authorizations WHERE authorization_id = $1`,
      [authId],
    );
    const postBefore = await postRow(post.postId);

    const res = mockRes();
    await onboarding.getStatus(req(userId), res);
    assert.equal(res.statusCode, 200);
    // Projection tells the truth…
    assert.equal(res.body.authorization.status, "armed");
    assert.equal(res.body.authorization.expired, true);
    assert.equal(res.body.authorization.reconfirmationRequired, true);
    assert.equal(res.body.firstWin.status, "prepared");
    assert.equal(res.body.onboardingCompleted, false);
    // …but WRITES nothing: rows byte-identical.
    const after = await db.query(
      `SELECT status, invalidation_reason, updated_at FROM armed_publish_authorizations WHERE authorization_id = $1`,
      [authId],
    );
    assert.deepEqual(after.rows[0], before.rows[0]);
    const postAfter = await postRow(post.postId);
    assert.deepEqual(postAfter, postBefore);
  } finally {
    await deleteUser(userId);
  }
});

test("J: status reports parked from the saved checkpoint and never conflates it with completion", async () => {
  const userId = await createUser();
  try {
    await db.query(
      `INSERT INTO guided_setup_progress (user_id, current_step, connections)
       VALUES ($1, 'welcome', $2::jsonb)`,
      [userId, JSON.stringify({ parked: { parked: true, at: "2026-08-10T00:00:00Z" } })],
    );
    const res = mockRes();
    await onboarding.getStatus(req(userId), res);
    assert.equal(res.body.parked, true);
    assert.equal(res.body.onboardingCompleted, false); // parked ≠ completed
    const { rows } = await db.query(
      "SELECT onboarding_completed FROM users WHERE user_id = $1",
      [userId],
    );
    assert.equal(rows[0].onboarding_completed, false);
  } finally {
    await deleteUser(userId);
  }
});

test("J: status surfaces the armed authorization's destination semantics for the resume banner", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    await armPost(userId, post.postId);
    const res = mockRes();
    await onboarding.getStatus(req(userId), res);
    assert.equal(res.body.authorization.status, "armed");
    assert.equal(
      res.body.authorization.destinationSemantics,
      "page_connected_during_onboarding",
    );
    assert.ok(res.body.authorization.expiresAt);
    assert.equal(res.body.armedWindowDays, 7);
    // Progressive tiers (Section G): nothing required, FB/Google recommended.
    assert.deepEqual(res.body.connectionTiers.requiredNow, []);
    assert.deepEqual(res.body.connectionTiers.recommendedNext, ["facebook", "google"]);
  } finally {
    await deleteUser(userId);
  }
});

// ---------------------------------------------------------------------------
// G. Parked ≠ completed vs the completion consumers

test("J: sanitizeConnections whitelists the parked checkpoint and strips junk", () => {
  const out = guidedSetup.sanitizeConnections({
    parked: { parked: true, at: "2026-08-10T12:00:00Z", evil: "x".repeat(500) },
    facebook: { skipped: true },
  });
  assert.deepEqual(out.parked, { parked: true, at: "2026-08-10T12:00:00Z" });
  assert.equal(out.parked.evil, undefined);
});

test("J: saving a parked checkpoint through saveProgress NEVER touches users.onboarding_completed", async () => {
  const userId = await createUser();
  try {
    const res = mockRes();
    await guidedSetup.saveProgress(
      req(userId, {
        currentStep: "welcome",
        connections: { parked: { parked: true, at: new Date().toISOString() } },
      }),
      res,
    );
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const { rows } = await db.query(
      "SELECT onboarding_completed FROM users WHERE user_id = $1",
      [userId],
    );
    assert.equal(rows[0].onboarding_completed, false);
  } finally {
    await deleteUser(userId);
  }
});

test("J: parking never disarms — the armed authorization survives a parked checkpoint", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    const armRes = await armPost(userId, post.postId);
    const res = mockRes();
    await guidedSetup.saveProgress(
      req(userId, {
        currentStep: "firstwin",
        connections: { parked: { parked: true, at: new Date().toISOString() } },
      }),
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal((await authRow(armRes.body.authorization.authorizationId)).status, "armed");
  } finally {
    await deleteUser(userId);
  }
});

// ---------------------------------------------------------------------------
// H. Publisher exclusion — 'prepared' is invisible to every publish sweep

test("J: a prepared post never satisfies the publisher's due-post predicate, even with a past scheduled_time", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    // Belt-and-suspenders: even if something wrote a past scheduled_time onto
    // a prepared row, the sweep's status filter must not see it.
    await db.query(
      "UPDATE social_posts SET scheduled_time = NOW() - INTERVAL '1 hour' WHERE post_id = $1",
      [post.postId],
    );
    const { rows } = await db.query(
      `SELECT sp.post_id FROM social_posts sp
        JOIN brands b ON b.brand_id = sp.brand_id
       WHERE sp.status = 'scheduled' AND sp.scheduled_time <= NOW()
         AND b.brand_id = $1`,
      [brandId],
    );
    assert.equal(rows.length, 0);
    assert.equal((await postRow(post.postId)).status, "prepared");
  } finally {
    await deleteUser(userId);
  }
});

// ---------------------------------------------------------------------------
// I. Celebration — provider-agnostic insert-once claim

async function seedFacebookWinProof(userId, brandId, postId) {
  const { rows: taskRows } = await db.query(
    `INSERT INTO agent_tasks (brand_id, user_id, task_type, source_type, source_id, status, title)
     VALUES ($1, $2, 'social_publish', 'social_post', $3, 'EXTERNALLY_VERIFIED', 'test first win')
     RETURNING task_id`,
    [brandId, userId, String(postId)],
  );
  const taskId = taskRows[0].task_id;
  const { row } = await recordExternalProof({
    runKey: `task-${taskId}`,
    provider: "facebook",
    action: "publish_readback",
    externalId: uniq("fbpost"),
    brandId,
    userId,
    environment: "test",
    evidence: { readBack: { id: "x" } },
  });
  await db.query("UPDATE agent_tasks SET proof_id = $1 WHERE task_id = $2", [
    row.proof_id,
    taskId,
  ]);
  return { taskId, proofId: row.proof_id };
}

test("J: no proof → celebrate:false, won:false (provider acceptance alone is never a win)", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    // PROVIDER_ACCEPTED without a proof must not qualify.
    await db.query(
      `INSERT INTO agent_tasks (brand_id, user_id, task_type, source_type, source_id, status, title)
       VALUES ($1, $2, 'social_publish', 'social_post', $3, 'PROVIDER_ACCEPTED', 'accepted only')`,
      [brandId, userId, String(post.postId)],
    );
    const res = mockRes();
    await onboarding.claimCelebration(req(userId), res);
    assert.deepEqual(res.body, { celebrate: false, won: false });
  } finally {
    await deleteUser(userId);
  }
});

test("J: Facebook read-back proof → first claim celebrates, every later claim renders quiet won-state", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    await seedFacebookWinProof(userId, brandId, post.postId);
    const first = mockRes();
    await onboarding.claimCelebration(req(userId), first);
    assert.equal(first.body.celebrate, true);
    assert.equal(first.body.won, true);
    assert.equal(first.body.provider, "facebook");
    const second = mockRes();
    await onboarding.claimCelebration(req(userId), second);
    assert.equal(second.body.celebrate, false);
    assert.equal(second.body.won, true);
  } finally {
    await deleteUser(userId);
  }
});

test("J: parallel celebration claims (Wizard vs Echo race) — exactly ONE celebrates", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    await seedFacebookWinProof(userId, brandId, post.postId);
    const resA = mockRes();
    const resB = mockRes();
    await Promise.all([
      onboarding.claimCelebration(req(userId), resA),
      onboarding.claimCelebration(req(userId), resB),
    ]);
    const celebrated = [resA.body, resB.body].filter((b) => b.celebrate === true);
    assert.equal(celebrated.length, 1);
    const { rows } = await db.query(
      "SELECT COUNT(*)::int AS n FROM onboarding_first_win_celebrations WHERE user_id = $1",
      [userId],
    );
    assert.equal(rows[0].n, 1);
  } finally {
    await deleteUser(userId);
  }
});

test("J: a Google GA4 first-win proof celebrates through the SAME insert-once mechanism", async () => {
  const userId = await createUser();
  try {
    await recordExternalProof({
      runKey: `onboarding-ga4-${userId}`,
      provider: "google",
      action: "ga4_first_win_readback",
      externalId: "properties/123",
      userId,
      environment: "test",
      evidence: { property: "properties/123", metrics: { sessions: 42 } },
    });
    const first = mockRes();
    await onboarding.claimCelebration(req(userId), first);
    assert.equal(first.body.celebrate, true);
    assert.equal(first.body.provider, "google");
    const second = mockRes();
    await onboarding.claimCelebration(req(userId), second);
    assert.deepEqual(
      { celebrate: second.body.celebrate, won: second.body.won },
      { celebrate: false, won: true },
    );
  } finally {
    await deleteUser(userId);
  }
});

test("J: the status projection reports won/celebrated truthfully after a celebration", async () => {
  const userId = await createUser();
  try {
    const brandId = await createBrand(userId);
    const post = await preparePost(userId, brandId);
    await seedFacebookWinProof(userId, brandId, post.postId);
    const s1 = mockRes();
    await onboarding.getStatus(req(userId), s1);
    assert.equal(s1.body.won, true);
    assert.equal(s1.body.celebrated, false);
    const claim = mockRes();
    await onboarding.claimCelebration(req(userId), claim);
    const s2 = mockRes();
    await onboarding.getStatus(req(userId), s2);
    assert.equal(s2.body.celebrated, true);
    assert.equal(s2.body.celebratedProvider, "facebook");
  } finally {
    await deleteUser(userId);
  }
});

// ---------------------------------------------------------------------------
// K. GA4 first-win probe — negatives record NOTHING, positives are redacted

async function withStubbedAnalytics(summary, fn) {
  const original = google.fetchAnalyticsSummary;
  google.fetchAnalyticsSummary = async () => {
    if (summary instanceof Error) throw summary;
    return summary;
  };
  try {
    return await fn();
  } finally {
    google.fetchAnalyticsSummary = original;
  }
}

async function googleProofCount(userId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM external_proofs
      WHERE run_key = $1 AND provider = 'google' AND action = 'ga4_first_win_readback'`,
    [`onboarding-ga4-${userId}`],
  );
  return rows[0].n;
}

test("J: GA4 probe — connected but NO property records no proof (no win)", async () => {
  const userId = await createUser();
  try {
    const result = await withStubbedAnalytics(
      { connected: true, property: null, metrics: null, topSources: [] },
      () => google.runGa4FirstWinProbe(userId),
    );
    assert.equal(result.won, false);
    assert.equal(result.reason, "no_property");
    assert.equal(await googleProofCount(userId), 0);
  } finally {
    await deleteUser(userId);
  }
});

test("J: GA4 probe — property with all-zero metrics and no sources records no proof", async () => {
  const userId = await createUser();
  try {
    const result = await withStubbedAnalytics(
      {
        connected: true,
        property: "properties/9",
        metrics: { sessions: 0, pageviews: 0, bounceRate: 0 },
        topSources: [],
      },
      () => google.runGa4FirstWinProbe(userId),
    );
    assert.equal(result.won, false);
    assert.equal(result.reason, "no_data");
    assert.equal(await googleProofCount(userId), 0);
  } finally {
    await deleteUser(userId);
  }
});

test("J: GA4 probe — an API error propagates and records no proof", async () => {
  const userId = await createUser();
  try {
    await assert.rejects(
      withStubbedAnalytics(new Error("Analytics report failed (HTTP 403)"), () =>
        google.runGa4FirstWinProbe(userId),
      ),
      /403/,
    );
    assert.equal(await googleProofCount(userId), 0);
  } finally {
    await deleteUser(userId);
  }
});

test("J: GA4 probe — real data records ONE redacted proof, idempotent on re-run", async () => {
  const userId = await createUser();
  try {
    const summary = {
      connected: true,
      property: "properties/777",
      dateRange: { startDate: "30daysAgo", endDate: "today" },
      metrics: { sessions: 12, pageviews: 30, bounceRate: 41.5 },
      topSources: [{ source: "google", sessions: 9 }],
    };
    const first = await withStubbedAnalytics(summary, () =>
      google.runGa4FirstWinProbe(userId),
    );
    assert.equal(first.won, true);
    assert.ok(first.proofId);
    const again = await withStubbedAnalytics(summary, () =>
      google.runGa4FirstWinProbe(userId),
    );
    assert.equal(again.won, true);
    assert.equal(await googleProofCount(userId), 1); // insert-once
    // Redaction: the stored evidence is the summary only — counts, not rows.
    const { rows } = await db.query(
      `SELECT evidence FROM external_proofs WHERE run_key = $1 AND provider = 'google'`,
      [`onboarding-ga4-${userId}`],
    );
    const evidence = rows[0].evidence;
    assert.equal(evidence.property, "properties/777");
    assert.equal(evidence.topSourceCount, 1);
    assert.equal(evidence.topSources, undefined); // raw rows never stored
    assert.equal(JSON.stringify(evidence).includes("token"), false);
  } finally {
    await deleteUser(userId);
  }
});

test("J: GA4 probe — sources alone (zero metrics) still qualify as real data", async () => {
  const userId = await createUser();
  try {
    const result = await withStubbedAnalytics(
      {
        connected: true,
        property: "properties/5",
        metrics: { sessions: 0, pageviews: 0, bounceRate: 0 },
        topSources: [{ source: "direct", sessions: 0 }],
      },
      () => google.runGa4FirstWinProbe(userId),
    );
    assert.equal(result.won, true);
  } finally {
    await deleteUser(userId);
  }
});
