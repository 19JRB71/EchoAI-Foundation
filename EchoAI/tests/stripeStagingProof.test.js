// Prompt 007: Stripe test-mode checkout round-trip proof endpoints.
//
// Proves:
//  1. stripe-preflight is read-only, never prints key values (modes only),
//     reports webhook-secret presence, price env ids, and asserts
//     STRIPE_PRICE_STARTER matches the live Starter price id.
//  2. stripe-proof writes rows ONLY from real Stripe API objects the handler
//     just fetched (term 4): a user with no Stripe checkout gets 409 and ZERO
//     rows; a missing webhook event stops after the subscription stage.
//  3. Live-mode stop condition: any livemode:true Stripe object aborts with
//     409 and records nothing further.
//  4. Idempotency (term 12): a re-run returns created:false for every stage
//     and the row count is unchanged.
//  5. Tenant scope: rows carry the test user's user_id only.
//  6. Redaction (term 10): evidence persists credential-clean.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { db, createTestUser, deleteUser } = require("./helpers");
const controller = require("../controllers/stagingProofController");
const stripeConfig = require("../config/stripe");

let userId;
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

// A fake Stripe client covering exactly what the endpoints call.
function fakeStripe({ livemode = false, withEvent = true } = {}) {
  return {
    webhookEndpoints: {
      list: async () => ({
        data: [
          {
            id: "we_test1",
            url: "https://staging.zorecho.com/api/subscriptions/webhook",
            status: "enabled",
            livemode: false,
            enabled_events: [
              "invoice.payment_succeeded",
              "invoice.payment_failed",
              "invoice.upcoming",
              "customer.subscription.deleted",
            ],
          },
        ],
      }),
    },
    prices: {
      list: async () => ({
        data: [
          {
            id: "price_starter_test",
            unit_amount: 19700,
            currency: "usd",
            livemode: false,
            recurring: { interval: "month" },
            product: { id: "prod_starter_test", name: "Zorecho Starter" },
          },
        ],
      }),
    },
    customers: {
      retrieve: async (id) => ({
        id,
        object: "customer",
        email: "proof@test.zorecho.com",
        livemode,
        created: 1785500000,
      }),
    },
    subscriptions: {
      retrieve: async (id) => ({
        id,
        object: "subscription",
        status: "active",
        livemode,
        customer: "cus_test_007",
        items: { data: [{ price: { id: "price_starter_test" } }] },
        latest_invoice: {
          id: "in_test_007",
          amount_due: 19700,
          amount_paid: 19700,
          currency: "usd",
          status: "paid",
          payment_intent: { id: "pi_test_007", status: "succeeded" },
        },
      }),
    },
    events: {
      list: async () => ({
        data: withEvent
          ? [
              {
                id: "evt_test_007",
                type: "invoice.payment_succeeded",
                livemode,
                created: 1785500100,
                data: { object: { id: "in_test_007", subscription: "sub_test_007", customer: "cus_test_007" } },
              },
            ]
          : [],
      }),
    },
  };
}

const realStripe = stripeConfig.stripe;
const savedEnv = {};

before(async () => {
  userId = await createTestUser();
  for (const k of [
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_STARTER",
  ]) {
    savedEnv[k] = process.env[k];
  }
});

after(async () => {
  stripeConfig.stripe = realStripe;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await db.query(
    "ALTER TABLE external_proofs DISABLE TRIGGER trg_external_proofs_immutable"
  );
  await db.query("DELETE FROM external_proofs WHERE run_key = ANY($1)", [runKeys]);
  await db.query(
    "ALTER TABLE external_proofs ENABLE TRIGGER trg_external_proofs_immutable"
  );
  await deleteUser(userId);
});

async function proofCount(runKey) {
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS n FROM external_proofs WHERE run_key = $1",
    [runKey]
  );
  return rows[0].n;
}

// ---- 1. Preflight -----------------------------------------------------------

test("stripe-preflight reports modes/presence only and asserts the Starter match", async () => {
  stripeConfig.stripe = fakeStripe();
  process.env.STRIPE_SECRET_KEY = "sk_test_abc";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_abc";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_abc";
  process.env.STRIPE_PRICE_STARTER = "price_starter_test";
  const res = mockRes();
  await controller.stripePreflight({ query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.readOnly, true);
  assert.equal(res.body.secretKeyMode, "test");
  assert.equal(res.body.publishableKeyMode, "test");
  // Never the key values themselves.
  assert.ok(!JSON.stringify(res.body).includes("sk_test_abc"));
  assert.ok(!JSON.stringify(res.body).includes("whsec_abc"));
  assert.deepEqual(res.body.webhookSecret, { present: true, looksValid: true });
  assert.equal(res.body.webhookEndpoints.length, 1);
  assert.equal(res.body.starter.priceId, "price_starter_test");
  assert.equal(res.body.starter.unitAmount, 19700);
  assert.equal(res.body.starterPriceMatchesEnv, true);
});

test("stripe-preflight reports a Starter mismatch and a missing webhook secret honestly", async () => {
  stripeConfig.stripe = fakeStripe();
  process.env.STRIPE_PRICE_STARTER = "price_something_else";
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const res = mockRes();
  await controller.stripePreflight({ query: {} }, res);
  assert.equal(res.body.starterPriceMatchesEnv, false);
  assert.deepEqual(res.body.webhookSecret, { present: false, looksValid: false });
});

// ---- 2. stripe-proof guards -------------------------------------------------

test("stripe-proof requires runKey and userId", async () => {
  const res = mockRes();
  await controller.stripeProof({ body: {} }, res);
  assert.equal(res.statusCode, 400);
});

test("stripe-proof on a user with no checkout writes ZERO rows", async () => {
  stripeConfig.stripe = fakeStripe();
  const runKey = freshRunKey("nocheckout");
  const res = mockRes();
  await controller.stripeProof({ body: { runKey, userId } }, res);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /no stripe_customer_id/);
  assert.equal(await proofCount(runKey), 0);
});

// ---- 3 + 4 + 5 + 6. Happy path, livemode abort, idempotency ------------------

test("stripe-proof records 3 tenant-scoped stripe rows, idempotently, credential-clean", async () => {
  stripeConfig.stripe = fakeStripe();
  await db.query(
    "UPDATE users SET stripe_customer_id = 'cus_test_007' WHERE user_id = $1",
    [userId]
  );
  // createTestUser does not create a subscriptions row — stage one like a
  // real post-checkout tenant.
  await db.query(
    `INSERT INTO subscriptions (user_id, subscription_tier, payment_status, stripe_subscription_id)
     VALUES ($1, 'starter', 'active', 'sub_test_007')
     ON CONFLICT DO NOTHING`,
    [userId]
  );
  await db.query(
    "UPDATE subscriptions SET stripe_subscription_id = 'sub_test_007', subscription_tier = 'starter' WHERE user_id = $1",
    [userId]
  );
  const runKey = freshRunKey("happy");
  const res = mockRes();
  await controller.stripeProof({ body: { runKey, userId } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(
    res.body.completed.map((c) => c.action),
    ["customer", "subscription", "webhook_event"]
  );
  assert.equal(await proofCount(runKey), 3);

  const { rows } = await db.query(
    "SELECT * FROM external_proofs WHERE run_key = $1 ORDER BY created_at",
    [runKey]
  );
  for (const row of rows) {
    assert.equal(row.provider, "stripe");
    assert.equal(row.user_id, userId); // tenant scope
    assert.ok(!JSON.stringify(row.evidence).match(/sk_test|whsec_|pk_live|sk_live/));
  }
  const eventRow = rows.find((r) => r.action === "webhook_event");
  assert.equal(eventRow.external_id, "evt_test_007");
  assert.equal(eventRow.evidence.eventType, "invoice.payment_succeeded");
  assert.equal(eventRow.evidence.resultingSubscriptionRow.user_id, userId);

  // Idempotent re-run: created:false everywhere, still 3 rows.
  const res2 = mockRes();
  await controller.stripeProof({ body: { runKey, userId } }, res2);
  assert.equal(res2.statusCode, 200);
  assert.ok(res2.body.completed.every((c) => c.created === false));
  assert.equal(await proofCount(runKey), 3);
});

test("stripe-proof rejects a runKey already bound to a different user", async () => {
  stripeConfig.stripe = fakeStripe();
  const otherUser = await createTestUser();
  const runKey = freshRunKey("crossuser");
  // Seed a stripe proof row for the OTHER user under this run key.
  const { recordExternalProof } = require("../utils/externalProofs");
  await recordExternalProof({
    runKey,
    provider: "stripe",
    action: "customer",
    externalId: "cus_other",
    userId: otherUser,
    environment: "test",
    evidence: { id: "cus_other" },
  });
  const res = mockRes();
  await controller.stripeProof({ body: { runKey, userId } }, res);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /bound to a different user/);
  assert.equal(await proofCount(runKey), 1); // nothing added
  // Clean up before deleting the other user (proof rows are immutable; FK-free
  // so deleteUser is safe, but drop the row with the trigger disabled).
  await db.query("ALTER TABLE external_proofs DISABLE TRIGGER trg_external_proofs_immutable");
  await db.query("DELETE FROM external_proofs WHERE run_key = $1", [runKey]);
  await db.query("ALTER TABLE external_proofs ENABLE TRIGGER trg_external_proofs_immutable");
  await deleteUser(otherUser);
});

test("stripe-proof aborts when the subscription belongs to another customer", async () => {
  const s = fakeStripe();
  s.subscriptions.retrieve = async (id) => ({
    id,
    status: "active",
    livemode: false,
    customer: "cus_SOMEONE_ELSE",
    items: { data: [{ price: { id: "price_starter_test" } }] },
    latest_invoice: null,
  });
  stripeConfig.stripe = s;
  const runKey = freshRunKey("wrongcust");
  const res = mockRes();
  await controller.stripeProof({ body: { runKey, userId } }, res);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /does not belong to this user's Stripe customer/);
  assert.equal(await proofCount(runKey), 1); // only the customer stage row
});

test("stripe-proof ignores a customer-only event match (older unrelated payment)", async () => {
  const s = fakeStripe();
  s.events.list = async () => ({
    data: [
      {
        id: "evt_unrelated",
        type: "invoice.payment_succeeded",
        livemode: false,
        created: 1700000000,
        // Same customer, DIFFERENT subscription + invoice — must NOT match.
        data: { object: { id: "in_old", subscription: "sub_old", customer: "cus_test_007" } },
      },
    ],
  });
  stripeConfig.stripe = s;
  const runKey = freshRunKey("staleevent");
  const res = mockRes();
  await controller.stripeProof({ body: { runKey, userId } }, res);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /No invoice\.payment_succeeded event/);
  assert.equal(await proofCount(runKey), 2);
});

test("stripe-proof aborts on a live-mode object and records nothing", async () => {
  stripeConfig.stripe = fakeStripe({ livemode: true });
  const runKey = freshRunKey("livemode");
  const res = mockRes();
  await controller.stripeProof({ body: { runKey, userId } }, res);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /LIVE-MODE/);
  assert.equal(await proofCount(runKey), 0);
});

test("stripe-proof stops honestly when the webhook event has not arrived", async () => {
  stripeConfig.stripe = fakeStripe({ withEvent: false });
  const runKey = freshRunKey("noevent");
  const res = mockRes();
  await controller.stripeProof({ body: { runKey, userId } }, res);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /No invoice\.payment_succeeded event/);
  // Customer + subscription stages recorded; webhook stage absent.
  assert.equal(await proofCount(runKey), 2);
  assert.deepEqual(
    res.body.completed.map((c) => c.action),
    ["customer", "subscription"]
  );
});
