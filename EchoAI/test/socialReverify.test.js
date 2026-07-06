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
// Tests never touch a real database or the network: db.query and
// socialApi.verifyConnection are swapped for fakes.
// ---------------------------------------------------------------------------

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";

const db = require("../config/db");
const socialApi = require("../utils/socialApi");
const { encrypt } = require("../utils/encryption");
const socialController = require("../controllers/socialController");
const { reverifySocialConnections } = socialController;

const GOOD_CREDS = encrypt(JSON.stringify({ accessToken: "tok", pageId: "p1" }));

/**
 * Fake db for the sweep. `accounts` seeds the discovery query; every status
 * UPDATE is recorded (with its guard) so assertions can check exactly which
 * rows were flipped and that flips stay status-guarded.
 */
function makeDb(accounts) {
  const state = { updates: [] };
  async function query(sql, params = []) {
    if (/FROM social_accounts sa/i.test(sql) && /JOIN brands b/i.test(sql)) {
      return { rows: accounts };
    }
    if (/UPDATE social_accounts SET connection_status = 'error'/i.test(sql)) {
      assert.match(sql, /connection_status <> 'error'/i, "error flip must be status-guarded");
      state.updates.push({ to: "error", accountId: params[0] });
      return { rows: [] };
    }
    if (/UPDATE social_accounts SET connection_status = 'connected'/i.test(sql)) {
      assert.match(sql, /connection_status = 'error'/i, "restore must be status-guarded");
      state.updates.push({ to: "connected", accountId: params[0] });
      return { rows: [] };
    }
    throw new Error(`socialReverify.test: unexpected query: ${sql.slice(0, 80)}`);
  }
  return { query, state };
}

async function withStubs({ accounts, verify }, fn) {
  const fake = makeDb(accounts);
  const origQuery = db.query;
  const origVerify = socialApi.verifyConnection;
  db.query = fake.query;
  socialApi.verifyConnection = verify;
  try {
    return await fn(fake.state);
  } finally {
    db.query = origQuery;
    socialApi.verifyConnection = origVerify;
  }
}

function account(id, { platform = "facebook", status = "connected", creds = GOOD_CREDS } = {}) {
  return {
    account_id: id,
    platform,
    connection_status: status,
    credentials_encrypted: creds,
  };
}

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
