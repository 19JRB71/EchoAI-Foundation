const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const db = require("../config/db");

// ---------------------------------------------------------------------------
// Beta Program sweep + feature-tracking regressions.
//
// The email module is patched BEFORE betaProgram is required so the sweep
// captures the stub (betaProgram destructures sendEmail at require time).
// db.query is swapped per-test with in-memory fakes, mirroring the style of
// recurringSweeps.test.js.
// ---------------------------------------------------------------------------

const emailModule = require("../utils/email");
const sentEmails = [];
let failEmailTo = null;
emailModule.sendEmail = async ({ to, subject }) => {
  if (failEmailTo && to === failEmailTo) throw new Error("SMTP down");
  sentEmails.push({ to, subject });
  return { success: true, to };
};

const {
  featureFromBaseUrl,
  trackFeatureUse,
  sendInactiveWarnings,
  notifyWaitlist,
  runBetaProgramSweep,
  _recentWrites,
} = require("../utils/betaProgram");

const realQuery = db.query;

beforeEach(() => {
  db.query = realQuery;
  sentEmails.length = 0;
  failEmailTo = null;
  _recentWrites.clear();
});

// --- Feature name derivation -------------------------------------------------

test("featureFromBaseUrl maps API mounts to feature names", () => {
  assert.strictEqual(featureFromBaseUrl("/api/social"), "social");
  assert.strictEqual(featureFromBaseUrl("/api/email-marketing"), "email-marketing");
  assert.strictEqual(featureFromBaseUrl("/api/sales-scripts"), "sales-scripts");
});

test("featureFromBaseUrl skips non-feature mounts and junk", () => {
  assert.strictEqual(featureFromBaseUrl("/api/auth"), null);
  assert.strictEqual(featureFromBaseUrl("/api/admin"), null);
  assert.strictEqual(featureFromBaseUrl("/api/v2"), null);
  assert.strictEqual(featureFromBaseUrl("/api/public"), null);
  assert.strictEqual(featureFromBaseUrl("/somewhere"), null);
  assert.strictEqual(featureFromBaseUrl(""), null);
  assert.strictEqual(featureFromBaseUrl(undefined), null);
});

// --- Throttled usage tracking --------------------------------------------------

test("trackFeatureUse upserts once per throttle window per user+feature", async () => {
  const upserts = [];
  db.query = async (sql, params) => {
    if (/INSERT INTO beta_feature_usage/i.test(sql)) {
      upserts.push(params);
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${sql}`);
  };

  trackFeatureUse("user-1", "/api/social");
  trackFeatureUse("user-1", "/api/social"); // throttled duplicate
  trackFeatureUse("user-1", "/api/seo"); // different feature — tracked
  trackFeatureUse("user-2", "/api/social"); // different user — tracked
  trackFeatureUse("user-1", "/api/auth"); // untracked mount

  // Fire-and-forget writes: give the microtask queue a beat.
  await new Promise((r) => setImmediate(r));

  assert.strictEqual(upserts.length, 3);
  assert.deepStrictEqual(upserts[0], ["user-1", "social"]);
  assert.deepStrictEqual(upserts[1], ["user-1", "seo"]);
  assert.deepStrictEqual(upserts[2], ["user-2", "social"]);
});

// --- Inactive warnings: claim-then-send with revert ---------------------------

function makeWarningDb(seed) {
  const state = { reverted: [] };
  db.query = async (sql, params) => {
    if (/FROM beta_settings/i.test(sql)) {
      return {
        rows: [
          { max_slots: 10, active_threshold_days: 7, warning_after_days: 5 },
        ],
      };
    }
    if (/UPDATE users u/i.test(sql) && /beta_warning_sent_at = NOW\(\)/i.test(sql)) {
      assert.strictEqual(params[0], 5, "uses warning_after_days from settings");
      return { rows: seed.due };
    }
    if (/SET beta_warning_sent_at = NULL/i.test(sql)) {
      state.reverted.push(params[0]);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected query: ${sql}`);
  };
  return state;
}

test("sendInactiveWarnings emails every claimed user", async () => {
  makeWarningDb({
    due: [
      { user_id: "u1", email: "a@x.com", business_name: "A Co", first_name: null },
      { user_id: "u2", email: "b@x.com", business_name: null, first_name: "Bea" },
    ],
  });

  const result = await sendInactiveWarnings();
  assert.strictEqual(result.warned, 2);
  assert.deepStrictEqual(
    sentEmails.map((e) => e.to),
    ["a@x.com", "b@x.com"]
  );
});

test("sendInactiveWarnings reverts the claim when the email fails", async () => {
  const state = makeWarningDb({
    due: [
      { user_id: "u1", email: "a@x.com", business_name: "A", first_name: null },
      { user_id: "u2", email: "broken@x.com", business_name: "B", first_name: null },
    ],
  });
  failEmailTo = "broken@x.com";

  const result = await sendInactiveWarnings();
  assert.strictEqual(result.warned, 1);
  // The failed send's claim is reverted so tomorrow's run retries it.
  assert.deepStrictEqual(state.reverted, ["u2"]);
});

// --- Waitlist notifications ----------------------------------------------------

function makeWaitlistDb(seed) {
  const state = { claimLimit: null, reverted: [] };
  db.query = async (sql, params) => {
    if (/FROM beta_settings/i.test(sql)) {
      return {
        rows: [
          { max_slots: seed.maxSlots, active_threshold_days: 7, warning_after_days: 5 },
        ],
      };
    }
    if (/COUNT\(\*\)::int AS used/i.test(sql)) {
      return { rows: [{ used: seed.used }] };
    }
    if (/UPDATE beta_waitlist w/i.test(sql)) {
      state.claimLimit = params[0];
      return { rows: seed.pending.slice(0, params[0]) };
    }
    if (/SET notified_at = NULL/i.test(sql)) {
      state.reverted.push(params[0]);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected query: ${sql}`);
  };
  return state;
}

test("notifyWaitlist notifies exactly one email per open slot, oldest first", async () => {
  const state = makeWaitlistDb({
    maxSlots: 10,
    used: 8,
    pending: [
      { waitlist_id: "w1", email: "first@x.com" },
      { waitlist_id: "w2", email: "second@x.com" },
      { waitlist_id: "w3", email: "third@x.com" },
    ],
  });

  const result = await notifyWaitlist();
  assert.strictEqual(state.claimLimit, 2, "claims only as many as open slots");
  assert.strictEqual(result.notified, 2);
  assert.deepStrictEqual(
    sentEmails.map((e) => e.to),
    ["first@x.com", "second@x.com"]
  );
});

test("notifyWaitlist does nothing when the beta is full", async () => {
  makeWaitlistDb({ maxSlots: 10, used: 10, pending: [] });
  const result = await notifyWaitlist();
  assert.strictEqual(result.notified, 0);
  assert.strictEqual(sentEmails.length, 0);
});

test("notifyWaitlist reverts the claim when the email fails", async () => {
  const state = makeWaitlistDb({
    maxSlots: 10,
    used: 9,
    pending: [{ waitlist_id: "w1", email: "broken@x.com" }],
  });
  failEmailTo = "broken@x.com";

  const result = await notifyWaitlist();
  assert.strictEqual(result.notified, 0);
  assert.deepStrictEqual(state.reverted, ["w1"]);
});

// --- Sweep isolation -----------------------------------------------------------

test("runBetaProgramSweep survives a warning-half failure and still notifies the waitlist", async () => {
  let calls = 0;
  db.query = async (sql) => {
    calls += 1;
    if (calls === 1) throw new Error("settings table unreachable");
    if (/FROM beta_settings/i.test(sql)) {
      return {
        rows: [{ max_slots: 5, active_threshold_days: 7, warning_after_days: 5 }],
      };
    }
    if (/COUNT\(\*\)::int AS used/i.test(sql)) return { rows: [{ used: 4 }] };
    if (/UPDATE beta_waitlist w/i.test(sql)) {
      return { rows: [{ waitlist_id: "w1", email: "wait@x.com" }] };
    }
    throw new Error(`unexpected query: ${sql}`);
  };

  const result = await runBetaProgramSweep();
  assert.strictEqual(result.warned, 0);
  assert.strictEqual(result.notified, 1);
  assert.deepStrictEqual(sentEmails.map((e) => e.to), ["wait@x.com"]);
});
