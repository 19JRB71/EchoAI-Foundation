// REPLIT_PROMPT_008 — Honestly disable the legacy-FCM mobile push surface.
//
// Proves the retired legacy endpoint (fcm.googleapis.com/fcm/send) is
// UNREACHABLE: even with FCM_SERVER_KEY set, sendToTokens no-ops with
// { skipped: true, reason: 'legacy_endpoint_disabled' } and never calls fetch.
// Rollback path (FCM_LEGACY_ENABLED=true) is deliberately not exercised against
// the network.

require("./dbGuard");

const test = require("node:test");
const assert = require("node:assert");

// Force the "operator configured a server key" scenario BEFORE the module loads,
// and make absolutely sure the disable flag is off.
process.env.FCM_SERVER_KEY = process.env.FCM_SERVER_KEY || "test-only-fake-fcm-server-key";
delete process.env.FCM_LEGACY_ENABLED;

// Tripwire: any network attempt from the FCM module is a hard failure.
const realFetch = global.fetch;
let fetchCalls = 0;
global.fetch = async (...args) => {
  fetchCalls += 1;
  throw new Error(`UNREACHABLE VIOLATION: fetch called with ${args[0]}`);
};

const fcm = require("../config/fcm");
const mobilePush = require("../controllers/mobilePushController");

test.after(() => {
  global.fetch = realFetch;
});

test("sendToTokens no-ops with reason even when FCM_SERVER_KEY is set", async () => {
  const out = await fcm.sendToTokens(["tok-a", "tok-b"], { title: "x", body: "y" });
  assert.deepStrictEqual(out, {
    sent: 0,
    failed: 0,
    invalidTokens: [],
    skipped: true,
    reason: "legacy_endpoint_disabled",
  });
  assert.strictEqual(fetchCalls, 0, "the legacy endpoint must never be contacted");
});

test("module reports disabled state honestly", () => {
  assert.strictEqual(fcm.isConfigured, false, "isConfigured must be false while disabled");
  assert.strictEqual(fcm.disabledReason, "legacy_endpoint_disabled");
});

test("sendToUser short-circuits with the same honest reason (no DB, no fetch)", async () => {
  const out = await mobilePush.sendToUser("00000000-0000-0000-0000-000000000000", {
    title: "x",
  });
  assert.deepStrictEqual(out, {
    sent: 0,
    failed: 0,
    skipped: true,
    reason: "legacy_endpoint_disabled",
  });
  assert.strictEqual(fetchCalls, 0);
});
