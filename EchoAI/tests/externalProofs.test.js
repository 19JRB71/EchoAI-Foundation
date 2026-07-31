// Prompt 006: external_proofs evidence substrate + staging-proof runner.
//
// Proves:
//  1. Redaction (term 10): credential keys and credential-shaped values
//     (Facebook EAA tokens, Resend re_ keys, Bearer headers, tokens in URLs)
//     are stripped before persisting; benign keys like "author"/"action"
//     survive.
//  2. Proof rows written ONLY from provider responses (term 4): a failed
//     email send writes ZERO rows; a social post that never published (no
//     external_post_id) yields 409 and ZERO rows; missing evidence throws.
//  3. Idempotency (term 12): the same (run_key, provider, action) can never
//     produce a second row — the writer returns the existing row, and a
//     re-run of the facebook stage recorder is a no-op resume.
//  4. Immutability (term 13): UPDATE and DELETE on external_proofs are
//     rejected by the trigger; created_at is set by the database.
//  5. Partial-proof honesty (term 11): a Graph read-back failure after
//     publish keeps the publish row, writes no readback/delete rows, and
//     reports the live post id with cleanupIncomplete.
//  6. Tenant scope (migration): rows carry brand_id/user_id.

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { db, createTestUser, deleteUser } = require("./helpers");
const { encrypt } = require("../utils/encryption");
const {
  recordExternalProof,
  getRunProofs,
  redactEvidence,
} = require("../utils/externalProofs");
const controller = require("../controllers/stagingProofController");
const email = require("../utils/email");

let userId;
let brandId;
const runKeys = [];

function freshRunKey(tag) {
  const key = `test-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  runKeys.push(key);
  return key;
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

before(async () => {
  userId = await createTestUser();
  const brand = await db.query(
    `INSERT INTO brands (user_id, brand_name, is_demo)
     VALUES ($1, 'Proof Test Brand', false) RETURNING brand_id`,
    [userId]
  );
  brandId = brand.rows[0].brand_id;
});

after(async () => {
  // external_proofs rows are immutable (that's the point) — disable the
  // trigger as superuser-of-our-own-test-db for cleanup only.
  await db.query(
    "ALTER TABLE external_proofs DISABLE TRIGGER trg_external_proofs_immutable"
  );
  await db.query("DELETE FROM external_proofs WHERE run_key = ANY($1)", [runKeys]);
  await db.query(
    "ALTER TABLE external_proofs ENABLE TRIGGER trg_external_proofs_immutable"
  );
  await deleteUser(userId);
});

// ---- 1. Redaction -----------------------------------------------------------

test("redactEvidence strips credential keys and credential-shaped values", () => {
  const out = redactEvidence({
    access_token: "EAAsecretsecretsecretsecretsecret",
    api_key: "whatever",
    Authorization: "Bearer abc.def-ghi_jkl.mno",
    nested: {
      page_token: "x",
      url: "https://graph.facebook.com/123?fields=id&access_token=EAAabc123",
      note: "contains EAAabcdefghijklmnopqrstuvwxyz012345 inline",
      resend: "re_AbCdEfGhIjKlMnOp",
    },
    list: [{ password: "p" }, "Bearer 0123456789abcdef"],
    author: "Jane Doe",
    action: "publish",
    message: "hello world",
  });
  assert.equal(out.access_token, "[REDACTED]");
  assert.equal(out.api_key, "[REDACTED]");
  assert.equal(out.Authorization, "[REDACTED]");
  assert.equal(out.nested.page_token, "[REDACTED]");
  assert.ok(!out.nested.url.includes("EAAabc123"));
  assert.ok(out.nested.url.includes("access_token=[REDACTED]"));
  assert.ok(!out.nested.note.includes("EAAabcdefghijklmnopqrstuvwxyz"));
  assert.ok(!out.nested.resend.includes("re_AbCdEfGhIjKlMnOp"));
  assert.equal(out.list[0].password, "[REDACTED]");
  assert.ok(!String(out.list[1]).includes("0123456789abcdef"));
  // Benign keys survive untouched.
  assert.equal(out.author, "Jane Doe");
  assert.equal(out.action, "publish");
  assert.equal(out.message, "hello world");
});

test("persisted evidence is redacted", async () => {
  const runKey = freshRunKey("redact");
  const { row } = await recordExternalProof({
    runKey,
    provider: "facebook",
    action: "publish",
    externalId: "123_456",
    brandId,
    userId,
    environment: "test",
    evidence: { id: "123_456", access_token: "EAAleakleakleakleakleak" },
  });
  assert.equal(row.evidence.access_token, "[REDACTED]");
  assert.equal(row.evidence.id, "123_456");
});

// ---- 2. Only-from-provider-responses ----------------------------------------

test("missing evidence throws — a row can never be written preemptively", async () => {
  await assert.rejects(
    recordExternalProof({
      runKey: freshRunKey("noev"),
      provider: "email",
      action: "send",
      environment: "test",
      evidence: null,
    }),
    /evidence/
  );
});

test("failed email send writes ZERO proof rows", async (t) => {
  const runKey = freshRunKey("emailfail");
  t.mock.method(email, "sendEmail", async () => {
    throw new Error("SMTP connection refused");
  });
  const res = mockRes();
  await controller.runEmail(
    { body: { runKey, to: "proof@example.com", brandId }, user: { userId } },
    res
  );
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.proofWritten, false);
  assert.equal((await getRunProofs(runKey)).length, 0);
});

test("unpublished post yields 409 and ZERO proof rows", async () => {
  const runKey = freshRunKey("unpub");
  const post = await db.query(
    `INSERT INTO social_posts (brand_id, platform, post_content, scheduled_time, status, proof_run_key)
     VALUES ($1, 'facebook', 'never published', NOW(), 'scheduled', $2)
     RETURNING post_id`,
    [brandId, runKey]
  );
  const res = mockRes();
  await controller.runFacebook(
    { body: { runKey, postId: post.rows[0].post_id }, user: { userId } },
    res
  );
  assert.equal(res.statusCode, 409);
  assert.equal((await getRunProofs(runKey)).length, 0);
});

// ---- 3. Idempotency ----------------------------------------------------------

test("duplicate (run_key, provider, action) returns the existing row, never a second one", async () => {
  const runKey = freshRunKey("dup");
  const first = await recordExternalProof({
    runKey,
    provider: "email",
    action: "send",
    externalId: "<id-1@z>",
    environment: "test",
    evidence: { messageId: "<id-1@z>" },
  });
  assert.equal(first.created, true);
  const second = await recordExternalProof({
    runKey,
    provider: "email",
    action: "send",
    externalId: "<id-2@z>",
    environment: "test",
    evidence: { messageId: "<id-2@z>" },
  });
  assert.equal(second.created, false);
  assert.equal(second.row.proof_id, first.row.proof_id);
  assert.equal(second.row.external_id, "<id-1@z>");
  assert.equal((await getRunProofs(runKey)).length, 1);
});

test("proof-post claim is atomic get-or-create: retries converge on ONE row (no double-post path)", async () => {
  const runKey = freshRunKey("claim");
  const res1 = mockRes();
  await controller.createProofPost(
    { body: { runKey, brandId, text: "claim test post" }, user: { userId } },
    res1
  );
  assert.equal(res1.statusCode, 200, JSON.stringify(res1.body));
  const res2 = mockRes();
  await controller.createProofPost(
    { body: { runKey, brandId, text: "claim test post" }, user: { userId } },
    res2
  );
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.post.post_id, res1.body.post.post_id);
  const count = await db.query(
    "SELECT COUNT(*)::int AS n FROM social_posts WHERE proof_run_key = $1",
    [runKey]
  );
  assert.equal(count.rows[0].n, 1);
  await db.query("DELETE FROM social_posts WHERE proof_run_key = $1", [runKey]);
});

test("runFacebook rejects a post not bound to the run key (409, zero rows)", async () => {
  const runKey = freshRunKey("bindmismatch");
  const postId = await seedPublishedPost(freshRunKey("otherrun"));
  const res = mockRes();
  await controller.runFacebook({ body: { runKey, postId }, user: { userId } }, res);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /not bound to this run key/);
  assert.equal((await getRunProofs(runKey)).length, 0);
});

test("one run key, one tenant: a run key carrying another brand's evidence is rejected", async () => {
  const runKey = freshRunKey("crossbrand");
  const otherUserId = await createTestUser();
  const otherBrand = await db.query(
    `INSERT INTO brands (user_id, brand_name, is_demo)
     VALUES ($1, 'Other Tenant Brand', false) RETURNING brand_id`,
    [otherUserId]
  );
  await recordExternalProof({
    runKey,
    provider: "facebook",
    action: "publish",
    externalId: "999_1",
    brandId: otherBrand.rows[0].brand_id,
    userId: otherUserId,
    environment: "test",
    evidence: { id: "999_1" },
  });
  const res = mockRes();
  await controller.createProofPost(
    { body: { runKey, brandId }, user: { userId } },
    res
  );
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /different brand/);
  await deleteUser(otherUserId);
});

// ---- 4. Immutability ----------------------------------------------------------

test("external_proofs rejects UPDATE and DELETE (append-only trigger)", async () => {
  const runKey = freshRunKey("immutable");
  const { row } = await recordExternalProof({
    runKey,
    provider: "email",
    action: "send",
    environment: "test",
    evidence: { messageId: "<x@z>" },
  });
  assert.ok(row.created_at);
  await assert.rejects(
    db.query("UPDATE external_proofs SET external_id = 'tampered' WHERE proof_id = $1", [
      row.proof_id,
    ]),
    /append-only/
  );
  await assert.rejects(
    db.query("DELETE FROM external_proofs WHERE proof_id = $1", [row.proof_id]),
    /append-only/
  );
});

// ---- 5. Facebook stages: happy path, partial failure, resume -----------------

async function seedPublishedPost(runKey) {
  const post = await db.query(
    `INSERT INTO social_posts
       (brand_id, platform, post_content, scheduled_time, status, published_time, external_post_id, proof_run_key)
     VALUES ($1, 'facebook', 'proof post', NOW(), 'published', NOW(), '140006_777', $2)
     RETURNING post_id`,
    [brandId, runKey]
  );
  // Connected FB account + page token so read-back/delete can resolve a token.
  await db.query(
    `INSERT INTO social_accounts (brand_id, platform, platform_username, credentials_encrypted, connection_status)
     VALUES ($1, 'facebook', 'Proof Page', $2, 'connected')
     ON CONFLICT DO NOTHING`,
    [brandId, encrypt(JSON.stringify({ pageId: "140006", accessToken: "EAAtesttoken" }))]
  );
  return post.rows[0].post_id;
}

const realFetch = global.fetch;
let graphCalls;
function installGraphMock({ failReadback = false, failDelete = false } = {}) {
  graphCalls = [];
  global.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    if (!u.hostname.endsWith("graph.facebook.com")) {
      throw new Error(`Unexpected non-Graph fetch in test: ${u.hostname}`);
    }
    const method = opts.method || "GET";
    graphCalls.push({ method, path: u.pathname });
    const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    const bad = (body) => ({ ok: false, status: 400, text: async () => JSON.stringify(body) });
    if (method === "GET") {
      if (failReadback) return bad({ error: { message: "readback boom" } });
      return ok({ id: "140006_777", message: "proof post", created_time: "2026-07-30T00:00:00+0000" });
    }
    if (method === "DELETE") {
      if (failDelete) return bad({ error: { message: "delete boom" } });
      return ok({ success: true });
    }
    throw new Error(`Unexpected Graph ${method}`);
  };
}

test("facebook stages: publish + readback + delete rows; re-run is a pure resume no-op", async (t) => {
  t.after(() => {
    global.fetch = realFetch;
  });
  const runKey = freshRunKey("fbhappy");
  const postId = await seedPublishedPost(runKey);
  installGraphMock();

  const res = mockRes();
  await controller.runFacebook({ body: { runKey, postId }, user: { userId } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const rows = await getRunProofs(runKey);
  assert.deepEqual(
    rows.map((r) => r.action).sort(),
    ["delete", "publish", "readback"]
  );
  const publish = rows.find((r) => r.action === "publish");
  assert.equal(publish.external_id, "140006_777");
  assert.equal(publish.brand_id, brandId);
  assert.equal(publish.user_id, userId);
  const readback = rows.find((r) => r.action === "readback");
  assert.equal(readback.evidence.id, "140006_777");

  // Re-run with the same key: deletion already proven -> zero new Graph calls.
  graphCalls = [];
  const res2 = mockRes();
  await controller.runFacebook({ body: { runKey, postId }, user: { userId } }, res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(graphCalls.length, 0);
  assert.equal((await getRunProofs(runKey)).length, 3);
});

test("partial failure: readback failure keeps the publish row, reports the live post id, writes no readback/delete rows", async (t) => {
  t.after(() => {
    global.fetch = realFetch;
  });
  const runKey = freshRunKey("fbpartial");
  const postId = await seedPublishedPost(runKey);
  installGraphMock({ failReadback: true });

  const res = mockRes();
  await controller.runFacebook({ body: { runKey, postId }, user: { userId } }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.cleanupIncomplete, true);
  assert.equal(res.body.livePostId, "140006_777");
  const rows = await getRunProofs(runKey);
  assert.deepEqual(rows.map((r) => r.action), ["publish"]);
});

// ---- 6. Email happy path ------------------------------------------------------

test("successful email writes exactly one redacted proof row from the SMTP response", async (t) => {
  const runKey = freshRunKey("emailok");
  t.mock.method(email, "sendEmail", async () => ({
    success: true,
    messageId: "<proof-1@zorecho.com>",
    to: "proof@example.com",
  }));
  const res = mockRes();
  await controller.runEmail(
    { body: { runKey, to: "proof@example.com", brandId }, user: { userId } },
    res
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const rows = await getRunProofs(runKey);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].external_id, "<proof-1@zorecho.com>");
  assert.equal(rows[0].evidence.messageId, "<proof-1@zorecho.com>");
});
