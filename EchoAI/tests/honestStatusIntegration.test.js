// honestStatus DB-backed integration (Prompt 025, Sections B/G).
//
// Proves against real rows:
//  - deterministic correlation post → task attempt → proof (never brand-level
//    "any proof");
//  - attempt isolation (older verified attempt stays historical, latest
//    attempt state governs the current claim);
//  - first-win ladder: no auth → armed → consumed-unverified → proof-verified
//    (+ celebration linkage);
//  - a proof for a DIFFERENT post/brand never upgrades this one's claim.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { db, createTestUser, deleteUser } = require("./helpers");
const hs = require("../utils/honestStatus");

let userId;
let brandId;

before(async () => {
  userId = await createTestUser();
  const b = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, 'HS Integration Brand') RETURNING brand_id",
    [userId],
  );
  brandId = b.rows[0].brand_id;
});

after(async () => {
  await deleteUser(userId);
});

async function insertPost(status = "scheduled") {
  const r = await db.query(
    `INSERT INTO social_posts (brand_id, platform, post_content, status, scheduled_time)
     VALUES ($1, 'facebook', 'honestStatus integration post', $2, NOW() + INTERVAL '2 days')
     RETURNING post_id`,
    [brandId, status],
  );
  return r.rows[0].post_id;
}

async function insertTask(postId, status, { attempt = 1, proofId = null, lastError = null } = {}) {
  const r = await db.query(
    `INSERT INTO agent_tasks (brand_id, user_id, task_type, source_type, source_id, attempt, status, title, proof_id, last_error)
     VALUES ($1, $2, 'social_publish', 'social_post', $3, $4, $5, 'hs test', $6, $7)
     RETURNING task_id`,
    [brandId, userId, String(postId), attempt, status, proofId, lastError],
  );
  return r.rows[0].task_id;
}

async function insertProof(runKey, externalId) {
  const r = await db.query(
    `INSERT INTO external_proofs (run_key, provider, action, external_id, brand_id, user_id, environment, evidence)
     VALUES ($1, 'facebook', 'publish_readback', $2, $3, $4, 'test', '{"src":"hs-test"}'::jsonb)
     RETURNING proof_id, verified_at`,
    [runKey, externalId, brandId, userId],
  );
  return r.rows[0];
}

// ---- forSocialPublish -------------------------------------------------------

test("scheduled post with no task: recorded-only, never verified, never failed", async () => {
  const postId = await insertPost("scheduled");
  const r = await hs.forSocialPublish({ brandId, postId });
  assert.equal(r.outcome, hs.OUTCOMES.IN_PROGRESS_OR_PREPARED);
  assert.notEqual(r.outcome, hs.OUTCOMES.KNOWN_FAILURE);
});

test("EXECUTING task → in_progress; EXTERNAL_FAILURE task → known_failure with reason", async () => {
  const postId = await insertPost("scheduled");
  await insertTask(postId, "EXECUTING");
  let r = await hs.forSocialPublish({ brandId, postId });
  assert.equal(r.outcome, hs.OUTCOMES.IN_PROGRESS_OR_PREPARED);

  const post2 = await insertPost("failed");
  await insertTask(post2, "EXTERNAL_FAILURE", { lastError: "provider rejected" });
  r = await hs.forSocialPublish({ brandId, postId: post2 });
  assert.equal(r.outcome, hs.OUTCOMES.KNOWN_FAILURE);
  assert.equal(r.lastError, "provider rejected");
});

test("verified proof through task lineage → verified_success with proof identifiers", async () => {
  const postId = await insertPost("published");
  const proof = await insertProof(`hs-test-${postId}`, "page_post_123");
  await insertTask(postId, "COMPLETED", { proofId: proof.proof_id });
  const r = await hs.forSocialPublish({ brandId, postId });
  assert.equal(r.outcome, hs.OUTCOMES.VERIFIED_SUCCESS);
  assert.equal(r.basis, "external_proof");
  assert.equal(r.externalId, "page_post_123");
  assert.ok(r.verifiedAt);
});

test("a proof on ANOTHER post in the same brand never upgrades this post's claim", async () => {
  const winner = await insertPost("published");
  const proof = await insertProof(`hs-test-${winner}`, "page_post_win");
  await insertTask(winner, "COMPLETED", { proofId: proof.proof_id });

  const bystander = await insertPost("scheduled");
  await insertTask(bystander, "QUEUED");
  const r = await hs.forSocialPublish({ brandId, postId: bystander });
  assert.equal(r.outcome, hs.OUTCOMES.IN_PROGRESS_OR_PREPARED);
});

test("attempt isolation: older verified attempt is historical; latest failed attempt governs", async () => {
  const postId = await insertPost("failed");
  const proof = await insertProof(`hs-test-${postId}`, "page_post_old");
  await insertTask(postId, "COMPLETED", { attempt: 1, proofId: proof.proof_id });
  await insertTask(postId, "EXTERNAL_FAILURE", { attempt: 2, lastError: "token expired" });

  const r = await hs.forSocialPublish({ brandId, postId });
  assert.equal(r.outcome, hs.OUTCOMES.KNOWN_FAILURE, "latest attempt governs the current claim");
  assert.equal(r.olderVerifiedAttempts.length, 1, "older verified attempt reported as historical fact");
  assert.equal(r.olderVerifiedAttempts[0].attempt, 1);
});

// ---- forFirstWin -------------------------------------------------------------

async function insertAuthorization(postId, status, extra = {}) {
  const r = await db.query(
    `INSERT INTO armed_publish_authorizations
       (user_id, brand_id, post_id, content_hash, consent_copy_version, status, consumed_at)
     VALUES ($1, $2, $3, 'hash', 'v1', $4, $5)
     RETURNING authorization_id`,
    [userId, brandId, postId, status, extra.consumedAt || null],
  );
  return r.rows[0].authorization_id;
}

test("first-win ladder: no authorization → in_progress (recorded-only), not failure", async () => {
  const r = await hs.forFirstWin({ userId, brandId });
  assert.equal(r.outcome, hs.OUTCOMES.IN_PROGRESS_OR_PREPARED);
  assert.equal(r.basis, "no_authorization");
  assert.equal(r.celebrated, false);
});

test("first-win ladder: armed is never won; consumed without proof is not published", async () => {
  const postId = await insertPost("scheduled");
  await insertAuthorization(postId, "armed");
  let r = await hs.forFirstWin({ userId, brandId });
  assert.equal(r.outcome, hs.OUTCOMES.IN_PROGRESS_OR_PREPARED);
  assert.equal(r.basis, "authorization_armed");

  await db.query(
    `UPDATE armed_publish_authorizations SET status = 'consumed', consumed_at = NOW() WHERE post_id = $1`,
    [postId],
  );
  r = await hs.forFirstWin({ userId, brandId });
  assert.equal(r.outcome, hs.OUTCOMES.IN_PROGRESS_OR_PREPARED);
  assert.equal(r.basis, "authorization_consumed_unverified");
});

test("first-win verified: proof through the consumed authorization's post lineage + celebration flag", async () => {
  // Reuse the consumed authorization's post from the previous test row set:
  const auth = (
    await db.query(
      `SELECT post_id FROM armed_publish_authorizations
        WHERE user_id = $1 AND status = 'consumed' ORDER BY created_at DESC LIMIT 1`,
      [userId],
    )
  ).rows[0];
  const proof = await insertProof(`hs-fw-${auth.post_id}`, "page_post_firstwin");
  await insertTask(auth.post_id, "EXTERNALLY_VERIFIED", { proofId: proof.proof_id });

  let r = await hs.forFirstWin({ userId, brandId });
  assert.equal(r.outcome, hs.OUTCOMES.VERIFIED_SUCCESS);
  assert.equal(r.externalId, "page_post_firstwin");
  assert.equal(r.celebrated, false, "no celebration row yet");

  await db.query(
    `INSERT INTO onboarding_first_win_celebrations (proof_id, user_id, brand_id, provider)
     VALUES ($1, $2, $3, 'facebook')`,
    [proof.proof_id, userId, brandId],
  );
  r = await hs.forFirstWin({ userId, brandId });
  assert.equal(r.celebrated, true);
  assert.ok(r.celebrationId);
});
