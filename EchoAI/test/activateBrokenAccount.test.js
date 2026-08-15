const { test } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// activateCalendar: activating a calendar aimed at a broken social account is
// refused up front. Covers the invariants that matter:
//   - any calendar platform whose stored connection_status is 'error' -> 409
//     with a clear "reconnect first" message (and connectionError flag for
//     the UI); no post is flipped to 'scheduled'
//   - all-connected platforms (or no stored account rows) activate normally
//   - after the owner reconnects (status back to 'connected') activation
//     works again with no extra steps
//   - multiple broken platforms are all named in the message
// 026-C1: activation now requires an artifact-bound confirmDigest. These
// calendars have zero drafts, so the valid confirmation is the digest of the
// empty artifact. The broken-connection refusal still fires first.
// Tests never touch a real database: db.query/db.getClient are swapped for
// fakes.
// ---------------------------------------------------------------------------

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";

const db = require("../config/db");
const { activateCalendar } = require("../controllers/contentCalendarController");
const { computeActivationDigest } = require("../utils/calendarActivationDigest");

const EMPTY_DIGEST = computeActivationDigest([]);

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function makeReq({ calendarId = "cal1", userId = "u1", confirmDigest = EMPTY_DIGEST } = {}) {
  return { user: { userId }, body: { calendarId, confirmDigest } };
}

/**
 * Fake db for the activate handler. `brokenPlatforms` is the list of the
 * calendar's platforms whose stored connection_status is 'error' (empty for
 * "everything healthy / no account rows"). The calendar has no draft posts,
 * so the artifact reconstruction inside the transaction returns the empty
 * artifact.
 */
function makeDb({ brokenPlatforms = [] } = {}) {
  const state = { activations: 0, postFlips: 0, brokenChecks: 0 };
  function routeArtifactQuery(sql) {
    if (/FROM social_posts/i.test(sql)) return { rows: [] }; // no drafts
    if (/FROM social_accounts/i.test(sql)) return { rows: [] }; // no bindings
    return null;
  }
  async function query(sql, params = []) {
    if (/FROM content_calendars c/i.test(sql)) {
      return {
        rows: [
          { calendar_id: params[0], brand_id: "b1", content_theme: null },
        ],
      };
    }
    if (/connection_status = 'error'/i.test(sql)) {
      state.brokenChecks += 1;
      return { rows: brokenPlatforms.map((p) => ({ platform: p })) };
    }
    const artifactRows = routeArtifactQuery(sql);
    if (artifactRows) return artifactRows;
    throw new Error(
      `activateBrokenAccount.test: unexpected query: ${sql.slice(0, 80)}`
    );
  }
  async function getClient() {
    return {
      async query(sql) {
        if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
        if (/FOR UPDATE/i.test(sql)) return { rows: [] };
        if (/UPDATE content_calendars SET status = 'active'/i.test(sql)) {
          state.activations += 1;
          return { rows: [] };
        }
        if (/UPDATE social_posts SET status = 'scheduled'/i.test(sql)) {
          state.postFlips += 1;
          return { rows: [] };
        }
        const artifactRows = routeArtifactQuery(sql);
        if (artifactRows) return artifactRows;
        throw new Error(
          `activateBrokenAccount.test: unexpected tx query: ${sql.slice(0, 80)}`
        );
      },
      release() {},
    };
  }
  return { query, getClient, state };
}

async function withDb(fake, fn) {
  const origQuery = db.query;
  const origGetClient = db.getClient;
  db.query = fake.query;
  db.getClient = fake.getClient;
  try {
    return await fn();
  } finally {
    db.query = origQuery;
    db.getClient = origGetClient;
  }
}

test("activateCalendar: a calendar platform in 'error' status is rejected with 409 and a reconnect message", async () => {
  const fake = makeDb({ brokenPlatforms: ["facebook"] });
  await withDb(fake, async () => {
    const res = makeRes();
    await activateCalendar(makeReq(), res);

    assert.strictEqual(res.statusCode, 409);
    assert.match(res.body.error, /reconnect/i);
    assert.match(res.body.error, /Facebook/);
    assert.strictEqual(res.body.connectionError, true);
    assert.deepStrictEqual(res.body.platforms, ["facebook"]);
    // Nothing must be flipped to scheduled/active.
    assert.strictEqual(fake.state.activations, 0);
    assert.strictEqual(fake.state.postFlips, 0);
  });
});

test("activateCalendar: multiple broken platforms are all named", async () => {
  const fake = makeDb({ brokenPlatforms: ["facebook", "instagram"] });
  await withDb(fake, async () => {
    const res = makeRes();
    await activateCalendar(makeReq(), res);

    assert.strictEqual(res.statusCode, 409);
    assert.match(res.body.error, /Facebook, Instagram/);
    assert.deepStrictEqual(res.body.platforms, ["facebook", "instagram"]);
    assert.strictEqual(fake.state.activations, 0);
  });
});

test("activateCalendar: healthy (or unstored) accounts activate normally with the empty-artifact digest", async () => {
  const fake = makeDb({ brokenPlatforms: [] });
  await withDb(fake, async () => {
    const res = makeRes();
    await activateCalendar(makeReq(), res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.calendarId, "cal1");
    assert.strictEqual(res.body.status, "active");
    // 026-C1 truthful accounting: zero drafts means zero activations claimed.
    assert.strictEqual(res.body.activatedCount, 0);
    assert.strictEqual(res.body.excludedStaleCount, 0);
    assert.strictEqual(res.body.excludedUnboundCount, 0);
    assert.strictEqual(res.body.digest, EMPTY_DIGEST);
    assert.strictEqual(fake.state.brokenChecks, 1);
    assert.strictEqual(fake.state.activations, 1);
    assert.strictEqual(fake.state.postFlips, 0, "no drafts -> no flips");
  });
});

test("activateCalendar: reconnecting (status back to 'connected') unblocks activation with no extra steps", async () => {
  // Same request, only the stored status changed — mirrors the reconnect flow.
  const broken = makeDb({ brokenPlatforms: ["twitter"] });
  await withDb(broken, async () => {
    const res = makeRes();
    await activateCalendar(makeReq(), res);
    assert.strictEqual(res.statusCode, 409);
  });

  const repaired = makeDb({ brokenPlatforms: [] });
  await withDb(repaired, async () => {
    const res = makeRes();
    await activateCalendar(makeReq(), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(repaired.state.activations, 1);
  });
});

test("activateCalendar: without a confirmDigest the request is refused with the preview (no zero-click activation)", async () => {
  const fake = makeDb({ brokenPlatforms: [] });
  await withDb(fake, async () => {
    const res = makeRes();
    await activateCalendar(makeReq({ confirmDigest: null }), res);

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.confirmationRequired, true);
    assert.strictEqual(res.body.preview.digest, EMPTY_DIGEST);
    assert.strictEqual(fake.state.activations, 0);
    assert.strictEqual(fake.state.postFlips, 0);
  });
});
