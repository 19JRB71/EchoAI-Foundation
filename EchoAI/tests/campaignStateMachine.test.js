// Prompt 005: honest campaign lifecycle.
//
// Proves:
//  1. The state machine: every legal transition is accepted, every illegal
//     transition throws, and the two verification-only transitions
//     (created_paused ⇔ live) throw for ANY caller without the verification
//     authority — i.e. it is impossible to render a campaign 'live' by a
//     direct write through the state machine.
//  2. transitionCampaignStatus is atomically guarded on the source state.
//  3. verifyCampaignStatus (the Single Verification Authority):
//     - upgrades created_paused → live ONLY when campaign + ad set + every ad
//       read back status == ACTIVE AND effective_status == ACTIVE;
//     - any non-ACTIVE / mixed / missing-object read-back verifies to
//       created_paused (downgrading live honestly);
//     - a FAILED read-back leaves the state unchanged and records
//       last_verify_error (never upgrades, downgrades, or converts to
//       failed/launch_failed);
//     - a successful read-back records last_verified_at and clears
//       last_verify_error;
//     - Graph traffic is GET-only (recognition rule).
//  4. The 128 migration mapping: legacy 'active' rows map unconditionally to
//     created_paused, launch_failed is preserved, unexpected values abort.
//  5. Consumer regressions: committed spend counts ONLY live campaigns.

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { db, createTestUser, deleteUser } = require("./helpers");
const { encrypt } = require("../utils/encryption");
const {
  LEGAL_STATES,
  TRANSITIONS,
  assertLegalTransition,
  transitionCampaignStatus,
} = require("../utils/campaignState");
const { verifyCampaignStatus } = require("../utils/campaignVerification");
const { getBrandSpend } = require("../utils/spendLimits");

let userId;
let brandId;

// ---- Graph GET mock ---------------------------------------------------------
const realFetch = global.fetch;
let graphCalls;
let readback; // map of path-suffix -> body object, or "ERROR" to fail
function installFetchMock() {
  graphCalls = [];
  global.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    if (!u.hostname.endsWith("graph.facebook.com")) {
      throw new Error(`Unexpected non-Graph fetch in test: ${u.hostname}`);
    }
    const pathName = u.pathname.replace(/^\/v[\d.]+\//, "");
    graphCalls.push({ method: opts.method || "GET", path: pathName });
    const key = Object.keys(readback).find((k) => pathName === k || pathName.endsWith(k));
    const body = key ? readback[key] : null;
    if (!body || body === "ERROR") {
      return {
        ok: false,
        status: 400,
        headers: { get: () => null },
        text: async () => JSON.stringify({ error: { message: "Simulated read-back failure", code: 100 } }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    };
  };
}

const ACTIVE = { status: "ACTIVE", effective_status: "ACTIVE" };
const PAUSED = { status: "PAUSED", effective_status: "PAUSED" };

async function seedCampaign(status) {
  const r = await db.query(
    `INSERT INTO campaigns
       (brand_id, user_id, campaign_name, budget, status,
        facebook_campaign_id, facebook_adset_id, facebook_ad_id)
     VALUES ($1, $2, 'SM test', 25, $3, 'cmp_sm', 'as_sm', 'ad_sm')
     RETURNING campaign_id`,
    [brandId, userId, status]
  );
  return r.rows[0].campaign_id;
}

async function rowState(campaignId) {
  const r = await db.query(
    `SELECT status, last_verified_at, last_verify_error FROM campaigns WHERE campaign_id = $1`,
    [campaignId]
  );
  return r.rows[0];
}

before(async () => {
  userId = await createTestUser("sm-user");
  const b = await db.query(
    `INSERT INTO brands (user_id, brand_name) VALUES ($1, 'SM Brand') RETURNING brand_id`,
    [userId]
  );
  brandId = b.rows[0].brand_id;
  await db.query(
    `INSERT INTO api_integrations
       (user_id, platform, api_token_encrypted, account_ref, connection_status)
     VALUES ($1, 'facebook', $2, 'act_1', 'connected')
     ON CONFLICT (user_id, platform) DO UPDATE
       SET api_token_encrypted = EXCLUDED.api_token_encrypted,
           connection_status = 'connected'`,
    [userId, encrypt("tok-sm")]
  );
});

after(async () => {
  global.fetch = realFetch;
  await deleteUser(userId);
});

beforeEach(async () => {
  installFetchMock();
  readback = {};
  await db.query(`DELETE FROM campaigns WHERE brand_id = $1`, [brandId]);
});

// ---- 1. State machine legality ---------------------------------------------

test("every declared transition is legal for its writer; everything else throws", () => {
  for (const from of LEGAL_STATES) {
    for (const to of LEGAL_STATES) {
      const declared = TRANSITIONS[from].includes(to);
      const verificationOnly =
        (from === "created_paused" && to === "live") ||
        (from === "live" && to === "created_paused");
      if (declared && !verificationOnly) {
        assert.doesNotThrow(() => assertLegalTransition(from, to));
      } else {
        assert.throws(() => assertLegalTransition(from, to), /Illegal|reserved for the verification helper/);
      }
    }
  }
  assert.throws(() => assertLegalTransition("active", "live"), /unknown source state/);
  assert.throws(() => assertLegalTransition("draft", "bogus"), /unknown target state/);
});

test("IMPOSSIBLE-TO-RENDER-LIVE: no caller without the verification authority can write live", async () => {
  const id = await seedCampaign("created_paused");
  // Direct state-machine call without the authority token throws...
  await assert.rejects(
    () => transitionCampaignStatus(id, "created_paused", "live"),
    /reserved for the verification helper/
  );
  // ...and the row is untouched.
  assert.equal((await rowState(id)).status, "created_paused");
  // The same guard covers the honest downgrade direction.
  await assert.rejects(
    () => transitionCampaignStatus(id, "live", "created_paused"),
    /reserved for the verification helper/
  );
});

test("transitionCampaignStatus is guarded on the source state (atomic row-count branch)", async () => {
  const id = await seedCampaign("created_paused");
  // Row is NOT launch_failed, so this legal transition must fail loudly.
  await assert.rejects(
    () => transitionCampaignStatus(id, "launch_failed", "approved"),
    /not in state 'launch_failed'/
  );
  assert.equal((await rowState(id)).status, "created_paused");
});

test("launch_failed → approved (explicit retry) works through the machine", async () => {
  const id = await seedCampaign("launch_failed");
  await transitionCampaignStatus(id, "launch_failed", "approved");
  assert.equal((await rowState(id)).status, "approved");
  await transitionCampaignStatus(id, "approved", "created_paused");
  assert.equal((await rowState(id)).status, "created_paused");
});

// ---- 2. verifyCampaignStatus ------------------------------------------------

test("full-chain ACTIVE read-back upgrades created_paused → live (GET-only) and stamps last_verified_at", async () => {
  const id = await seedCampaign("created_paused");
  readback = { cmp_sm: ACTIVE, as_sm: ACTIVE, "cmp_sm/ads": { data: [ACTIVE, ACTIVE] } };
  const res = await verifyCampaignStatus(id);
  assert.deepEqual(res, { verified: true, state: "live", changed: true });
  const row = await rowState(id);
  assert.equal(row.status, "live");
  assert.ok(row.last_verified_at, "last_verified_at recorded");
  assert.equal(row.last_verify_error, null);
  assert.ok(graphCalls.length >= 3);
  for (const c of graphCalls) assert.equal(c.method, "GET", `read-back must be GET-only: ${c.path}`);
});

test("any non-ACTIVE object verifies to created_paused — honest downgrade of live", async () => {
  const id = await seedCampaign("live");
  readback = { cmp_sm: ACTIVE, as_sm: ACTIVE, "cmp_sm/ads": { data: [ACTIVE, PAUSED] } };
  const res = await verifyCampaignStatus(id);
  assert.deepEqual(res, { verified: true, state: "created_paused", changed: true });
  assert.equal((await rowState(id)).status, "created_paused");
});

test("mixed status vs effective_status never yields live", async () => {
  const id = await seedCampaign("created_paused");
  readback = {
    cmp_sm: { status: "ACTIVE", effective_status: "IN_PROCESS" },
    as_sm: ACTIVE,
    "cmp_sm/ads": { data: [ACTIVE] },
  };
  const res = await verifyCampaignStatus(id);
  assert.equal(res.state, "created_paused");
  assert.equal((await rowState(id)).status, "created_paused");
});

test("a chain with ZERO ads never yields live", async () => {
  const id = await seedCampaign("created_paused");
  readback = { cmp_sm: ACTIVE, as_sm: ACTIVE, "cmp_sm/ads": { data: [] } };
  const res = await verifyCampaignStatus(id);
  assert.equal(res.state, "created_paused");
});

test("failed read-back: state UNCHANGED (both directions), last_verify_error recorded", async () => {
  for (const start of ["created_paused", "live"]) {
    const id = await seedCampaign(start);
    readback = { cmp_sm: "ERROR" };
    const res = await verifyCampaignStatus(id);
    assert.equal(res.verified, false);
    const row = await rowState(id);
    assert.equal(row.status, start, `state must stay '${start}' after a failed read-back`);
    assert.match(row.last_verify_error, /Simulated read-back failure/);
  }
});

test("read-back failure never converts to failed/launch_failed; success clears the error", async () => {
  const id = await seedCampaign("created_paused");
  readback = { cmp_sm: "ERROR" };
  await verifyCampaignStatus(id);
  assert.equal((await rowState(id)).status, "created_paused");
  readback = { cmp_sm: PAUSED, as_sm: PAUSED, "cmp_sm/ads": { data: [PAUSED] } };
  const res = await verifyCampaignStatus(id);
  assert.deepEqual(res, { verified: true, state: "created_paused", changed: false });
  const row = await rowState(id);
  assert.equal(row.last_verify_error, null);
  assert.ok(row.last_verified_at);
});

test("verifying a non-verifiable state throws (programmer error, no silent verify)", async () => {
  const id = await seedCampaign("launch_failed");
  await assert.rejects(() => verifyCampaignStatus(id), /only created_paused\/live/);
});

test("rows missing Facebook ids fail closed: state unchanged + error recorded", async () => {
  const r = await db.query(
    `INSERT INTO campaigns (brand_id, user_id, campaign_name, budget, status)
     VALUES ($1, $2, 'No ids', 5, 'created_paused') RETURNING campaign_id`,
    [brandId, userId]
  );
  const id = r.rows[0].campaign_id;
  const res = await verifyCampaignStatus(id);
  assert.equal(res.verified, false);
  const row = await rowState(id);
  assert.equal(row.status, "created_paused");
  assert.match(row.last_verify_error, /missing Facebook object ids/);
});

// ---- 3. Migration 128 mapping ----------------------------------------------

const MIGRATION = fs.readFileSync(
  path.join(__dirname, "..", "models", "128_campaign_state_machine.sql"),
  "utf8"
);

test("migration 128: legacy 'active' maps unconditionally to created_paused; launch_failed preserved", async () => {
  const a = await seedCampaign("active"); // legacy value (pre-005 rows)
  const lf = await seedCampaign("launch_failed");
  const cp = await seedCampaign("created_paused");
  await db.query(MIGRATION); // idempotent — re-runs the mapping deterministically
  assert.equal((await rowState(a)).status, "created_paused");
  assert.equal((await rowState(lf)).status, "launch_failed");
  assert.equal((await rowState(cp)).status, "created_paused");
});

test("migration 128: an unexpected status value aborts loudly (STOP AND REPORT)", async () => {
  await seedCampaign("bogus_state");
  await assert.rejects(() => db.query(MIGRATION), /unexpected status value/i);
});

// ---- 4. Consumer regression: recurring jobs must see launched brands --------

test("weekly/recurring brand discovery includes created_paused and live brands (legacy 'active' filter cannot re-enter)", async () => {
  await seedCampaign("created_paused");
  // The exact discovery predicate the scheduler jobs use.
  const r = await db.query(
    `SELECT DISTINCT b.brand_id
       FROM brands b
       JOIN campaigns c ON c.brand_id = b.brand_id
      WHERE c.status IN ('created_paused', 'live') AND b.is_demo = false
        AND b.brand_id = $1`,
    [brandId]
  );
  assert.equal(r.rows.length, 1, "a created_paused brand is still an ads brand for recurring jobs");
  // And the scheduler source itself no longer carries the legacy filter.
  const src = fs.readFileSync(path.join(__dirname, "..", "utils", "scheduler.js"), "utf8");
  assert.ok(
    !/FROM campaigns WHERE status = 'active'|c\.status = 'active'/.test(src),
    "scheduler.js must not filter campaigns on the retired 'active' status"
  );
});

// ---- 5. Consumer regression: committed spend counts ONLY live ---------------

test("committed spend counts only live campaigns — created_paused/launch_failed cost $0", async () => {
  await seedCampaign("created_paused");
  await seedCampaign("launch_failed");
  let spend = await getBrandSpend(brandId);
  assert.equal(spend.committedDailySpend, 0, "paused-at-Facebook chains commit no spend");
  await seedCampaign("live");
  spend = await getBrandSpend(brandId);
  assert.equal(spend.committedDailySpend, 25, "only the live campaign's budget counts");
});
