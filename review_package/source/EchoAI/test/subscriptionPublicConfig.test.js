// GET /api/subscriptions/config — public runtime Stripe publishable-key
// endpoint. The SPA bundle is prebuilt and committed (no build-time env), so
// the client fetches the publishable key from the server at runtime; this lets
// one bundle serve staging (pk_test) and production (pk_live).

const { test } = require("node:test");
const assert = require("node:assert");

const { getPublicConfig } = require("../controllers/subscriptionController");

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

test("getPublicConfig returns the publishable key when configured", async () => {
  const prev = process.env.STRIPE_PUBLISHABLE_KEY;
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_example123";
  try {
    const res = mockRes();
    await getPublicConfig({}, res);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, { publishableKey: "pk_test_example123" });
  } finally {
    if (prev === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
    else process.env.STRIPE_PUBLISHABLE_KEY = prev;
  }
});

test("getPublicConfig returns null (not an error) when Stripe is not configured", async () => {
  const prev = process.env.STRIPE_PUBLISHABLE_KEY;
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  try {
    const res = mockRes();
    await getPublicConfig({}, res);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, { publishableKey: null });
  } finally {
    if (prev === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
    else process.env.STRIPE_PUBLISHABLE_KEY = prev;
  }
});

test("the /config route is mounted publicly (before any auth middleware)", () => {
  const router = require("../routes/subscriptionRoutes");
  const layer = router.stack.find(
    (l) => l.route && l.route.path === "/config"
  );
  assert.ok(layer, "GET /config route must exist on subscriptionRoutes");
  assert.ok(layer.route.methods.get, "/config must be a GET route");
  // Exactly one handler: the controller itself — no auth/lockout middleware.
  assert.strictEqual(layer.route.stack.length, 1);
});
