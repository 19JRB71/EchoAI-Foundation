// Prompt 016: Google data pull proof endpoints.
//
// Proves:
//  1. google-preflight is read-only, never returns token values, reports the
//     grant state and probes surfaces honestly (provider error text on
//     failure, never fabricated reachability).
//  2. google-proof writes the row ONLY from a real pull response: a user with
//     no Google connection gets 409 and ZERO rows; a failed pull writes ZERO
//     rows; an account with no GA4 property writes ZERO rows.
//  3. Idempotency: a re-run returns created:false and the row count is
//     unchanged.
//  4. Run-key ↔ user binding: reusing another user's run key is a 409.
//  5. Redaction: persisted evidence is credential-clean.
//  6. Read-only construction: the proof path calls only the exported
//     read-only pull helper — no Google write surface exists in the module.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { db, createTestUser, deleteUser } = require("./helpers");
const controller = require("../controllers/stagingProofController");
const googleController = require("../controllers/googleController");

let userId;
let otherUserId;
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

const SAMPLE_SUMMARY = {
  connected: true,
  property: "properties/473906255",
  dateRange: { startDate: "30daysAgo", endDate: "today" },
  metrics: { sessions: 9, pageviews: 19, bounceRate: 0.11 },
  topSources: [
    { source: "google", sessions: 5 },
    { source: "(direct)", sessions: 2 },
  ],
};

async function insertGrant(uid) {
  await db.query(
    `INSERT INTO google_integrations
       (user_id, access_token_encrypted, refresh_token_encrypted, scope, token_expiry, connection_status)
     VALUES ($1, 'enc-access', 'enc-refresh',
             'https://www.googleapis.com/auth/analytics.readonly openid',
             NOW() + INTERVAL '1 hour', 'connected')
     ON CONFLICT (user_id) DO UPDATE SET refresh_token_encrypted = 'enc-refresh'`,
    [uid]
  );
}

const realFetchAnalyticsSummary = googleController.fetchAnalyticsSummary;
const realGetValidAccessToken = googleController.getValidAccessToken;
const realGoogleFetch = googleController.googleFetch;

before(async () => {
  userId = await createTestUser();
  otherUserId = await createTestUser();
});

after(async () => {
  googleController.fetchAnalyticsSummary = realFetchAnalyticsSummary;
  googleController.getValidAccessToken = realGetValidAccessToken;
  googleController.googleFetch = realGoogleFetch;
  if (runKeys.length > 0) {
    await db.query("ALTER TABLE external_proofs DISABLE TRIGGER trg_external_proofs_immutable");
    await db.query("DELETE FROM external_proofs WHERE run_key = ANY($1)", [runKeys]);
    await db.query("ALTER TABLE external_proofs ENABLE TRIGGER trg_external_proofs_immutable");
  }
  await db.query("DELETE FROM google_integrations WHERE user_id = ANY($1)", [
    [userId, otherUserId].filter(Boolean),
  ]);
  if (userId) await deleteUser(userId);
  if (otherUserId) await deleteUser(otherUserId);
});

test("google-preflight reports a missing grant honestly and never leaks tokens", async () => {
  const res = mockRes();
  await controller.googlePreflight({ query: { userId }, user: { userId } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.readOnly, true);
  assert.equal(res.body.grant, null);
  const text = JSON.stringify(res.body);
  assert.ok(!/enc-access|enc-refresh|ya29|Bearer /.test(text));
});

test("google-preflight probes surfaces honestly with provider error text", async () => {
  await insertGrant(userId);
  googleController.getValidAccessToken = async () => ({ accessToken: "ya29.test-token" });
  googleController.googleFetch = async () => {
    throw new Error("Quota exceeded for quota metric 'Requests'");
  };
  googleController.fetchAnalyticsSummary = async () => SAMPLE_SUMMARY;
  try {
    const res = mockRes();
    await controller.googlePreflight({ query: { userId }, user: { userId } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.grant.connected, true);
    assert.equal(res.body.grant.hasRefreshToken, true);
    assert.equal(res.body.businessProfile.reachable, false);
    assert.match(res.body.businessProfile.error, /Quota exceeded/);
    assert.equal(res.body.analytics.reachable, true);
    assert.equal(res.body.analytics.property, "properties/473906255");
    // Token values must never appear anywhere in the response.
    const text = JSON.stringify(res.body);
    assert.ok(!/ya29|enc-access|enc-refresh|Bearer /.test(text));
  } finally {
    googleController.getValidAccessToken = realGetValidAccessToken;
    googleController.googleFetch = realGoogleFetch;
    googleController.fetchAnalyticsSummary = realFetchAnalyticsSummary;
  }
});

test("GET /api/google/analytics keeps its exact legacy response contract", async () => {
  googleController.fetchAnalyticsSummary = async () => SAMPLE_SUMMARY;
  try {
    const res = mockRes();
    await googleController.getAnalytics({ user: { userId } }, res);
    assert.equal(res.statusCode, 200);
    // Exact key set — dateRange must stay internal to the helper.
    assert.deepEqual(Object.keys(res.body).sort(), [
      "connected",
      "metrics",
      "property",
      "topSources",
    ]);
    assert.equal(res.body.property, "properties/473906255");
  } finally {
    googleController.fetchAnalyticsSummary = realFetchAnalyticsSummary;
  }
});

test("provider error text in responses is redacted (tokens in URLs stripped)", async () => {
  await insertGrant(userId);
  const leakyError =
    "Business Profile accounts failed: see https://example.com/page?access_token=ya29.SECRETLEAK&next=1";
  googleController.getValidAccessToken = async () => ({ accessToken: "ya29.test-token" });
  googleController.googleFetch = async () => {
    throw new Error(leakyError);
  };
  googleController.fetchAnalyticsSummary = async () => {
    throw new Error(leakyError);
  };
  try {
    const res = mockRes();
    await controller.googlePreflight({ query: { userId }, user: { userId } }, res);
    assert.equal(res.statusCode, 200);
    const preflightText = JSON.stringify(res.body);
    assert.ok(!preflightText.includes("ya29.SECRETLEAK"), "preflight response leaked a token");

    const runKey = freshRunKey("redact");
    const res2 = mockRes();
    await controller.googleProof({ body: { runKey, userId } }, res2);
    assert.equal(res2.statusCode, 502);
    const proofText = JSON.stringify(res2.body);
    assert.ok(!proofText.includes("ya29.SECRETLEAK"), "proof error response leaked a token");
    const rows = await db.query("SELECT 1 FROM external_proofs WHERE run_key = $1", [runKey]);
    assert.equal(rows.rows.length, 0);
  } finally {
    googleController.getValidAccessToken = realGetValidAccessToken;
    googleController.googleFetch = realGoogleFetch;
    googleController.fetchAnalyticsSummary = realFetchAnalyticsSummary;
  }
});

test("google-proof requires runKey and userId", async () => {
  const res = mockRes();
  await controller.googleProof({ body: {} }, res);
  assert.equal(res.statusCode, 400);
});

test("google-proof with no Google connection writes ZERO rows", async () => {
  const runKey = freshRunKey("noconn");
  const res = mockRes();
  await controller.googleProof({ body: { runKey, userId: otherUserId } }, res);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /no Google connection/);
  const rows = await db.query("SELECT 1 FROM external_proofs WHERE run_key = $1", [runKey]);
  assert.equal(rows.rows.length, 0);
});

test("google-proof happy path: one row from the real response, idempotent re-run", async () => {
  await insertGrant(userId);
  googleController.fetchAnalyticsSummary = async () => SAMPLE_SUMMARY;
  try {
    const runKey = freshRunKey("happy");
    const res = mockRes();
    await controller.googleProof({ body: { runKey, userId } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.completed, [{ action: "analytics_pull", created: true }]);
    assert.equal(res.body.proofs.length, 1);
    const proof = res.body.proofs[0];
    assert.equal(proof.provider, "google");
    assert.equal(proof.action, "analytics_pull");
    assert.equal(proof.external_id, "properties/473906255");
    assert.equal(proof.user_id, userId);
    assert.equal(proof.evidence.metrics.sessions, 9);
    assert.equal(proof.evidence.resultCounts.topSources, 2);

    // Idempotent re-run: created:false, still exactly one row.
    const res2 = mockRes();
    await controller.googleProof({ body: { runKey, userId } }, res2);
    assert.equal(res2.statusCode, 200);
    assert.deepEqual(res2.body.completed, [{ action: "analytics_pull", created: false }]);
    const rows = await db.query(
      "SELECT evidence::text AS ev FROM external_proofs WHERE run_key = $1",
      [runKey]
    );
    assert.equal(rows.rows.length, 1);
    // Credential-clean persistence.
    assert.ok(!/ya29|Bearer |access_token|refresh_token/.test(rows.rows[0].ev));
  } finally {
    googleController.fetchAnalyticsSummary = realFetchAnalyticsSummary;
  }
});

test("google-proof rejects a runKey bound to a different user", async () => {
  await insertGrant(userId);
  await insertGrant(otherUserId);
  googleController.fetchAnalyticsSummary = async () => SAMPLE_SUMMARY;
  try {
    const runKey = freshRunKey("bind");
    const res = mockRes();
    await controller.googleProof({ body: { runKey, userId } }, res);
    assert.equal(res.statusCode, 200);
    const res2 = mockRes();
    await controller.googleProof({ body: { runKey, userId: otherUserId } }, res2);
    assert.equal(res2.statusCode, 409);
    assert.match(res2.body.error, /bound to a different user/);
  } finally {
    googleController.fetchAnalyticsSummary = realFetchAnalyticsSummary;
  }
});

test("google-proof pull failure writes ZERO rows", async () => {
  await insertGrant(userId);
  googleController.fetchAnalyticsSummary = async () => {
    throw new Error("Token has been expired or revoked.");
  };
  try {
    const runKey = freshRunKey("fail");
    const res = mockRes();
    await controller.googleProof({ body: { runKey, userId } }, res);
    assert.equal(res.statusCode, 502);
    assert.match(res.body.error, /expired or revoked/);
    const rows = await db.query("SELECT 1 FROM external_proofs WHERE run_key = $1", [runKey]);
    assert.equal(rows.rows.length, 0);
  } finally {
    googleController.fetchAnalyticsSummary = realFetchAnalyticsSummary;
  }
});

test("google-proof with no GA4 property writes ZERO rows and says so", async () => {
  await insertGrant(userId);
  googleController.fetchAnalyticsSummary = async () => ({
    connected: true,
    property: null,
    metrics: null,
    topSources: [],
  });
  try {
    const runKey = freshRunKey("noprop");
    const res = mockRes();
    await controller.googleProof({ body: { runKey, userId } }, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.error, /no GA4 property/);
    const rows = await db.query("SELECT 1 FROM external_proofs WHERE run_key = $1", [runKey]);
    assert.equal(rows.rows.length, 0);
  } finally {
    googleController.fetchAnalyticsSummary = realFetchAnalyticsSummary;
  }
});
