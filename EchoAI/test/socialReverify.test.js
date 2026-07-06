const { test } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// reverifySocialConnections: the periodic sweep that re-verifies stored social
// credentials so an expired/revoked login is flagged ('error') BEFORE the next
// scheduled post fails. Covers the invariants that matter:
//   - a hard verification failure (auth rejection) flips the row to 'error'
//   - a transient failure (network/429/5xx) NEVER flips a working connection
//   - a previously-'error' account that verifies fine is restored to
//     'connected' (owner reauthorized platform-side)
//   - undecryptable credentials are a hard failure (they can never publish)
//   - the per-row guard seam contains one account's crash so the sweep
//     finishes the rest (stubbed via module.exports.reverifyAccountRow)
//   - a REAL 'connected' -> 'error' flip (guarded UPDATE hit a row) push-alerts
//     the brand owner with the platform name + reconnect deep link; an account
//     already in 'error' (0 rows) never re-alerts; transient skips stay silent
//   - alert delivery is best-effort: a push failure never breaks the sweep
// Tests never touch a real database or the network: db.query and
// socialApi.verifyConnection are swapped for fakes, and the push controllers'
// exports are stubbed (same pattern as socialFailureAlert.test.js).
// ---------------------------------------------------------------------------

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";

const db = require("../config/db");
const socialApi = require("../utils/socialApi");
const pushController = require("../controllers/pushController");
const mobilePushController = require("../controllers/mobilePushController");
const { encrypt } = require("../utils/encryption");
const socialController = require("../controllers/socialController");
const { reverifySocialConnections } = socialController;

const GOOD_CREDS = encrypt(JSON.stringify({ accessToken: "tok", pageId: "p1" }));

/**
 * Fake db for the sweep. `accounts` seeds the discovery query; every status
 * UPDATE is recorded (with its guard) so assertions can check exactly which
 * rows were flipped and that flips stay status-guarded. The error flip's
 * rowCount mirrors the real guard: 1 when the seeded account wasn't already
 * 'error', else 0 (so alert dedup can be tested). `brands` maps brand_id ->
 * { brand_name, user_id, is_demo } for the alert helper's owner lookup.
 */
function makeDb(accounts, brands = {}) {
  const state = { updates: [], brandLookups: [] };
  async function query(sql, params = []) {
    if (/FROM social_accounts sa/i.test(sql) && /JOIN brands b/i.test(sql)) {
      return { rows: accounts };
    }
    if (/UPDATE social_accounts SET connection_status = 'error'/i.test(sql)) {
      assert.match(sql, /connection_status <> 'error'/i, "error flip must be status-guarded");
      state.updates.push({ to: "error", accountId: params[0] });
      const seeded = accounts.find((a) => a.account_id === params[0]);
      const hit = seeded && seeded.connection_status !== "error";
      return { rows: [], rowCount: hit ? 1 : 0 };
    }
    if (/UPDATE social_accounts SET connection_status = 'connected'/i.test(sql)) {
      assert.match(sql, /connection_status = 'error'/i, "restore must be status-guarded");
      state.updates.push({ to: "connected", accountId: params[0] });
      return { rows: [], rowCount: 1 };
    }
    if (/SELECT brand_name, user_id, is_demo FROM brands/i.test(sql)) {
      state.brandLookups.push(params[0]);
      const b = brands[params[0]];
      return { rows: b ? [b] : [] };
    }
    throw new Error(`socialReverify.test: unexpected query: ${sql.slice(0, 80)}`);
  }
  return { query, state };
}

async function withStubs({ accounts, brands, verify, onPush }, fn) {
  const fake = makeDb(accounts, brands);
  const origQuery = db.query;
  const origVerify = socialApi.verifyConnection;
  const origPush = pushController.sendPushToUser;
  const origMobile = mobilePushController.sendToUser;
  db.query = fake.query;
  socialApi.verifyConnection = verify;
  pushController.sendPushToUser = onPush || (async () => ({ sent: 1, failed: 0 }));
  mobilePushController.sendToUser = async () => ({ sent: 0, failed: 0, skipped: true });
  try {
    return await fn(fake.state);
  } finally {
    db.query = origQuery;
    socialApi.verifyConnection = origVerify;
    pushController.sendPushToUser = origPush;
    mobilePushController.sendToUser = origMobile;
  }
}

function account(id, { platform = "facebook", status = "connected", creds = GOOD_CREDS, brandId = "b1" } = {}) {
  return {
    account_id: id,
    brand_id: brandId,
    platform,
    connection_status: status,
    credentials_encrypted: creds,
  };
}

const REAL_BRAND = { b1: { brand_name: "Acme", user_id: "owner-1", is_demo: false } };

test("hard verification failure flips a connected account to 'error'", async () => {
  const hardErr = Object.assign(new Error("190 token expired"), { statusCode: 401 });
  await withStubs(
    {
      accounts: [account("a1")],
      verify: async () => {
        throw hardErr;
      },
    },
    async (state) => {
      const summary = await reverifySocialConnections();
      assert.deepStrictEqual(state.updates, [{ to: "error", accountId: "a1" }]);
      assert.strictEqual(summary.flagged, 1);
      assert.strictEqual(summary.checked, 1);
    }
  );
});

test("transient failures (network/429/5xx) never flip a working connection", async () => {
  const transientErrs = [
    Object.assign(new Error("network blip"), { transient: true }),
    Object.assign(new Error("rate limited"), { statusCode: 429 }),
    Object.assign(new Error("platform down"), { statusCode: 503 }),
  ];
  let i = 0;
  await withStubs(
    {
      accounts: [account("a1"), account("a2"), account("a3")],
      verify: async () => {
        throw transientErrs[i++];
      },
    },
    async (state) => {
      const summary = await reverifySocialConnections();
      assert.deepStrictEqual(state.updates, [], "no status writes on transient failures");
      assert.strictEqual(summary.skipped, 3);
      assert.strictEqual(summary.flagged, 0);
    }
  );
});

test("a previously-'error' account that verifies fine is restored to 'connected'", async () => {
  await withStubs(
    {
      accounts: [account("a1", { status: "error" }), account("a2")],
      verify: async () => ({ ok: true }),
    },
    async (state) => {
      const summary = await reverifySocialConnections();
      assert.deepStrictEqual(state.updates, [{ to: "connected", accountId: "a1" }]);
      assert.strictEqual(summary.restored, 1);
      assert.strictEqual(summary.checked, 2);
    }
  );
});

test("undecryptable credentials are flagged as a hard failure without calling the platform", async () => {
  let verifyCalls = 0;
  await withStubs(
    {
      accounts: [account("a1", { creds: "not-a-valid-ciphertext" })],
      verify: async () => {
        verifyCalls += 1;
        return { ok: true };
      },
    },
    async (state) => {
      const summary = await reverifySocialConnections();
      assert.strictEqual(verifyCalls, 0, "corrupt creds must not reach the platform");
      assert.deepStrictEqual(state.updates, [{ to: "error", accountId: "a1" }]);
      assert.strictEqual(summary.flagged, 1);
    }
  );
});

test("a real 'connected' -> 'error' flip push-alerts the owner with platform + reconnect link", async () => {
  const hardErr = Object.assign(new Error("token revoked"), { statusCode: 401 });
  const pushes = [];
  await withStubs(
    {
      accounts: [account("a1", { platform: "instagram" })],
      brands: REAL_BRAND,
      verify: async () => {
        throw hardErr;
      },
      onPush: async (userId, payload) => {
        pushes.push({ userId, payload });
        return { sent: 1, failed: 0 };
      },
    },
    async () => {
      const summary = await reverifySocialConnections();
      assert.strictEqual(summary.flagged, 1);
    }
  );

  assert.strictEqual(pushes.length, 1, "exactly one alert for the real flip");
  assert.strictEqual(pushes[0].userId, "owner-1");
  const p = pushes[0].payload;
  assert.match(p.title, /Instagram/i, "title names the platform");
  assert.match(p.body, /Instagram/i, "body names the platform");
  assert.match(p.body, /Acme/, "body names the brand");
  assert.match(p.body, /reconnect/i, "body carries the reconnect call to action");
  assert.strictEqual(p.url, "/dashboard?section=social", "deep-links to the calendar");
  assert.strictEqual(p.tag, "social-connection-error-a1", "per-account tag");
});

test("an account already in 'error' that still fails never re-alerts (0-row flip)", async () => {
  const hardErr = Object.assign(new Error("token revoked"), { statusCode: 401 });
  const pushes = [];
  await withStubs(
    {
      accounts: [account("a1", { status: "error" })],
      brands: REAL_BRAND,
      verify: async () => {
        throw hardErr;
      },
      onPush: async (userId, payload) => {
        pushes.push(payload);
        return { sent: 1, failed: 0 };
      },
    },
    async (state) => {
      const summary = await reverifySocialConnections();
      assert.strictEqual(state.updates.length, 1, "the guarded flip was attempted");
      assert.strictEqual(summary.flagged, 1, "still counted as flagged in the summary");
    }
  );
  assert.strictEqual(pushes.length, 0, "no alert without a real transition");
});

test("transient skips never alert", async () => {
  const pushes = [];
  await withStubs(
    {
      accounts: [account("a1")],
      brands: REAL_BRAND,
      verify: async () => {
        throw Object.assign(new Error("platform down"), { statusCode: 503 });
      },
      onPush: async (userId, payload) => {
        pushes.push(payload);
        return { sent: 1, failed: 0 };
      },
    },
    async () => {
      await reverifySocialConnections();
    }
  );
  assert.strictEqual(pushes.length, 0);
});

test("demo brands are flipped but never alerted", async () => {
  const hardErr = Object.assign(new Error("token revoked"), { statusCode: 401 });
  const pushes = [];
  await withStubs(
    {
      accounts: [account("a1", { brandId: "b-demo" })],
      brands: { "b-demo": { brand_name: "Demo Co", user_id: "owner-1", is_demo: true } },
      verify: async () => {
        throw hardErr;
      },
      onPush: async (userId, payload) => {
        pushes.push(payload);
        return { sent: 1, failed: 0 };
      },
    },
    async (state) => {
      const summary = await reverifySocialConnections();
      assert.deepStrictEqual(state.updates, [{ to: "error", accountId: "a1" }]);
      assert.strictEqual(summary.flagged, 1, "the flip itself still happens");
      assert.deepStrictEqual(state.brandLookups, ["b-demo"], "demo filtered at alert time");
    }
  );
  assert.strictEqual(pushes.length, 0);
});

test("a push delivery failure never breaks the sweep", async () => {
  const hardErr = Object.assign(new Error("token revoked"), { statusCode: 401 });
  let pushCalls = 0;
  await withStubs(
    {
      accounts: [account("a1"), account("a2", { status: "error" })],
      brands: REAL_BRAND,
      verify: async (platform, creds) => {
        if (pushCalls === 0 && creds) throw hardErr; // a1 hard-fails
        return { ok: true }; // a2 verifies fine -> restored
      },
      onPush: async () => {
        pushCalls += 1;
        throw new Error("push service down");
      },
    },
    async (state) => {
      const summary = await reverifySocialConnections();
      assert.strictEqual(summary.checked, 2, "both accounts were processed");
      assert.strictEqual(summary.flagged, 1);
      assert.strictEqual(summary.restored, 1, "a2 was still restored after a1's push failed");
      assert.deepStrictEqual(state.updates, [
        { to: "error", accountId: "a1" },
        { to: "connected", accountId: "a2" },
      ]);
    }
  );
  assert.strictEqual(pushCalls, 1, "the alert was attempted");
});

test("per-row guard: one account's crash never stops the rest of the sweep", async () => {
  const origRow = socialController.reverifyAccountRow;
  socialController.reverifyAccountRow = async (row) => {
    if (row.account_id === "a1") throw new Error("boom");
    return origRow(row);
  };
  try {
    await withStubs(
      {
        accounts: [account("a1"), account("a2", { status: "error" })],
        verify: async () => ({ ok: true }),
      },
      async (state) => {
        const summary = await reverifySocialConnections();
        // a1 crashed inside the guard; a2 still got verified and restored.
        assert.deepStrictEqual(state.updates, [{ to: "connected", accountId: "a2" }]);
        assert.strictEqual(summary.checked, 1);
        assert.strictEqual(summary.restored, 1);
      }
    );
  } finally {
    socialController.reverifyAccountRow = origRow;
  }
});
