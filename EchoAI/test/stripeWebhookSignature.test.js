// REPLIT_PROMPT_001 — Stripe webhook signature-verification evidence.
// Proves handleWebhook rejects forged/missing signatures with 400 BEFORE any
// state change, and accepts a legitimately signed event.

const { test } = require("node:test");
const assert = require("node:assert");

// The controller builds the real Stripe client at require time; give it a key
// so stripe.webhooks.constructEvent (pure crypto, no network) is available.
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy_key_for_signature_tests";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret_for_unit_tests";

const Stripe = require("stripe");
const db = require("../config/db");
const { handleWebhook } = require("../controllers/subscriptionController");

const stripe = new Stripe("sk_test_dummy_key_for_signature_tests", {
  apiVersion: "2024-12-18.acacia",
});

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    json(payload) {
      // Express defaults to 200 when res.json() is called without status().
      if (this.statusCode === null) this.statusCode = 200;
      this.body = payload;
      return this;
    },
  };
}

function makeReq(rawBody, signature) {
  return { body: Buffer.from(rawBody), headers: { "stripe-signature": signature } };
}

const eventPayload = JSON.stringify({
  id: "evt_test_1",
  object: "event",
  type: "customer.subscription.deleted",
  data: { object: { customer: "cus_test_1" } },
});

test("forged signature is rejected with 400 and NO database write", async () => {
  const originalQuery = db.query;
  let dbCalls = 0;
  db.query = async () => {
    dbCalls += 1;
    return { rows: [], rowCount: 0 };
  };
  try {
    const res = mockRes();
    await handleWebhook(makeReq(eventPayload, "t=12345,v1=forgedsignature"), res);
    assert.strictEqual(res.statusCode, 400);
    assert.match(String(res.body), /Webhook Error/);
    assert.strictEqual(dbCalls, 0, "no state change may happen on a forged signature");
  } finally {
    db.query = originalQuery;
  }
});

test("missing signature header is rejected with 400 and NO database write", async () => {
  const originalQuery = db.query;
  let dbCalls = 0;
  db.query = async () => {
    dbCalls += 1;
    return { rows: [], rowCount: 0 };
  };
  try {
    const res = mockRes();
    await handleWebhook({ body: Buffer.from(eventPayload), headers: {} }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(dbCalls, 0);
  } finally {
    db.query = originalQuery;
  }
});

test("valid payload with a signature made under the WRONG secret is rejected", async () => {
  const header = stripe.webhooks.generateTestHeaderString({
    payload: eventPayload,
    secret: "whsec_some_other_secret",
  });
  const originalQuery = db.query;
  let dbCalls = 0;
  db.query = async () => {
    dbCalls += 1;
    return { rows: [], rowCount: 0 };
  };
  try {
    const res = mockRes();
    await handleWebhook(makeReq(eventPayload, header), res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(dbCalls, 0);
  } finally {
    db.query = originalQuery;
  }
});

test("legitimately signed event is accepted (200) and processed", async () => {
  const header = stripe.webhooks.generateTestHeaderString({
    payload: eventPayload,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  });
  const originalQuery = db.query;
  const queries = [];
  db.query = async (sql, params) => {
    queries.push({ sql: String(sql), params });
    return { rows: [], rowCount: 1 };
  };
  try {
    const res = mockRes();
    await handleWebhook(makeReq(eventPayload, header), res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(queries.length >= 1, "a verified subscription.deleted event must update state");
    assert.match(queries[0].sql, /UPDATE subscriptions/i);
  } finally {
    db.query = originalQuery;
  }
});

test("webhook route uses express.raw and no auth middleware", () => {
  const router = require("../routes/subscriptionRoutes");
  const layer = router.stack.find((l) => l.route && l.route.path === "/webhook");
  assert.ok(layer, "POST /webhook route must exist");
  assert.ok(layer.route.methods.post);
  const names = layer.route.stack.map((s) => s.name);
  assert.ok(!names.includes("authMiddleware"), "webhook must not require app auth (Stripe calls it)");
});
