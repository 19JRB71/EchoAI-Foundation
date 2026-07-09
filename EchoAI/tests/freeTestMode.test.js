// Free test mode — FREE_TEST_MODE=true gives new signups full Enterprise
// access with no payment and tells the client (via GET /api/auth/signup-mode)
// to skip the Stripe payment step during onboarding.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  freeTestModeEnabled,
  signupMode,
} = require("../controllers/authController");

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

function withEnv(value, fn) {
  const prev = process.env.FREE_TEST_MODE;
  if (value === undefined) delete process.env.FREE_TEST_MODE;
  else process.env.FREE_TEST_MODE = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.FREE_TEST_MODE;
    else process.env.FREE_TEST_MODE = prev;
  }
}

test("freeTestModeEnabled only accepts an explicit 'true'", () => {
  withEnv("true", () => assert.equal(freeTestModeEnabled(), true));
  withEnv("TRUE", () => assert.equal(freeTestModeEnabled(), true));
  withEnv("false", () => assert.equal(freeTestModeEnabled(), false));
  withEnv("1", () => assert.equal(freeTestModeEnabled(), false));
  withEnv("", () => assert.equal(freeTestModeEnabled(), false));
  withEnv(undefined, () => assert.equal(freeTestModeEnabled(), false));
});

test("GET /signup-mode reports the flag honestly and nothing else", async () => {
  await withEnv("true", async () => {
    const res = mockRes();
    await signupMode({}, res);
    assert.equal(res.body.freeTestMode, true);
    // betaFull is a boolean capacity hint (fail-open false when unknowable).
    assert.equal(typeof res.body.betaFull, "boolean");
    assert.deepEqual(Object.keys(res.body).sort(), ["betaFull", "freeTestMode"]);
  });
  await withEnv(undefined, async () => {
    const res = mockRes();
    await signupMode({}, res);
    assert.deepEqual(res.body, { freeTestMode: false, betaFull: false });
  });
});
