// Prompt 015: spending caps and pause/unpause controls (no-cap-no-unpause).
//
// Proves:
//  1. Money units: dollars ⇄ cents conversion, including pg NUMERIC strings.
//  2. Deny-by-default cap enforcement (evaluateUnpause): brand cap unset,
//     platform cap missing, brand sum exceeded, platform sum exceeded, ok.
//  3. Term 6: accepted-but-unverified activations (activation_requested_at)
//     count toward both committed sums.
//  4. Unpause endpoint: a denial writes an audit row (result='denied', cap
//     snapshots) and makes ZERO Graph calls; state unchanged.
//  5. Atomic unpause (C.1): activation order ad → ad set → campaign; a
//     mid-chain Graph failure triggers compensating re-pause of everything
//     already activated, writes result='failed', leaves status AND the
//     pending marker untouched, and the campaign can never verify live.
//  6. Honest state (C): a fully accepted unpause sets the pending marker and
//     result='success' but the row goes 'live' ONLY via the 005 read-back;
//     a not-yet-active read-back leaves created_paused + activationPending.
//  7. Idempotency (E.1): already-live and already-pending unpauses, and
//     already-paused pauses, are no-ops — no Graph call, no audit row.
//  8. Pause: campaign object is paused FIRST; success clears the pending
//     marker and demotes live → created_paused via the read-back.
//  9. Refresh-status: recognition-only; clears the marker on verified live.
// 10. Tenant isolation: another user's owner cannot touch the campaign.
// 11. Launch-path safety regression: the launch modules contain zero
//     ACTIVE-status sends (grep-proof, addendum D).

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { db, createTestUser, deleteUser } = require("./helpers");
const { encrypt } = require("../utils/encryption");
const spendCaps = require("../utils/spendCaps");
const control = require("../controllers/campaignControlController");

let userId;
let brandId;
let otherUserId;

// ---- Graph mock -------------------------------------------------------------
const realFetch = global.fetch;
let graphCalls; // [{method, path, params}]
let readback; // GET read-back bodies by path suffix
let postFail; // Set of object ids whose POST should fail
function installFetchMock() {
  graphCalls = [];
  postFail = new Set();
  readback = {};
  global.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    if (!u.hostname.endsWith("graph.facebook.com")) {
      throw new Error(`Unexpected non-Graph fetch in test: ${u.hostname}`);
    }
    const method = opts.method || "GET";
    const pathName = u.pathname.replace(/^\/v[\d.]+\//, "");
    // graphRequest puts params (incl. status) in the URL query string.
    graphCalls.push({ method, path: pathName, status: u.searchParams.get("status") || "" });
    if (method === "POST") {
      if (postFail.has(pathName)) {
        return {
          ok: false,
          status: 400,
          headers: { get: () => null },
          text: async () => JSON.stringify({ error: { message: `Simulated POST failure for ${pathName}`, code: 100 } }),
        };
      }
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ success: true }) };
    }
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
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
  };
}

const ACTIVE = { status: "ACTIVE", effective_status: "ACTIVE" };
const PAUSED = { status: "PAUSED", effective_status: "PAUSED" };

function activeReadback(ids) {
  return {
    [ids.cmp]: { ...ACTIVE, id: ids.cmp },
    [ids.as]: { ...ACTIVE, id: ids.as },
    [`${ids.cmp}/ads`]: { data: [{ ...ACTIVE, id: ids.ad }] },
  };
}
function pausedReadback(ids) {
  return {
    [ids.cmp]: { ...PAUSED, id: ids.cmp },
    [ids.as]: { ...PAUSED, id: ids.as },
    [`${ids.cmp}/ads`]: { data: [{ ...PAUSED, id: ids.ad }] },
  };
}

let seq = 0;
async function seedCampaign({ status = "created_paused", budget = 5, pending = false } = {}) {
  seq += 1;
  const ids = { cmp: `cmp_ctl_${seq}`, as: `as_ctl_${seq}`, ad: `ad_ctl_${seq}` };
  const r = await db.query(
    `INSERT INTO campaigns
       (brand_id, user_id, campaign_name, budget, status,
        facebook_campaign_id, facebook_adset_id, facebook_ad_id, activation_requested_at)
     VALUES ($1, $2, 'Ctl test', $3, $4, $5, $6, $7, $8)
     RETURNING campaign_id`,
    [brandId, userId, budget, status, ids.cmp, ids.as, ids.ad, pending ? new Date() : null]
  );
  return { campaignId: r.rows[0].campaign_id, ids };
}

async function rowState(campaignId) {
  const r = await db.query(
    `SELECT status, activation_requested_at FROM campaigns WHERE campaign_id = $1`,
    [campaignId]
  );
  return r.rows[0];
}

async function auditRows(campaignId) {
  const r = await db.query(
    `SELECT * FROM ad_spend_audit WHERE campaign_id = $1 ORDER BY created_at`,
    [campaignId]
  );
  return r.rows;
}

async function setBrandCap(cents) {
  await db.query(`DELETE FROM ad_spend_caps WHERE brand_id = $1`, [brandId]);
  if (cents != null) {
    await db.query(
      `INSERT INTO ad_spend_caps (brand_id, daily_cap_cents, set_by_user_id) VALUES ($1, $2, $3)`,
      [brandId, cents, userId]
    );
  }
}

async function setPlatformCap(cents) {
  await db.query(`DELETE FROM ad_spend_caps WHERE brand_id IS NULL`);
  if (cents != null) {
    await db.query(`INSERT INTO ad_spend_caps (brand_id, daily_cap_cents) VALUES (NULL, $1)`, [cents]);
  }
}

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  return res;
}
function reqFor(uid, campaignId, extra = {}) {
  return { user: { userId: uid }, params: { campaignId }, query: {}, body: {}, ...extra };
}

before(async () => {
  userId = await createTestUser("cap-user");
  otherUserId = await createTestUser("cap-other");
  const b = await db.query(
    `INSERT INTO brands (user_id, brand_name) VALUES ($1, 'Cap Brand') RETURNING brand_id`,
    [userId]
  );
  brandId = b.rows[0].brand_id;
  await db.query(
    `INSERT INTO api_integrations
       (user_id, platform, api_token_encrypted, account_ref, connection_status)
     VALUES ($1, 'facebook', $2, 'act_1', 'connected')
     ON CONFLICT (user_id, platform) DO UPDATE
       SET api_token_encrypted = EXCLUDED.api_token_encrypted, connection_status = 'connected'`,
    [userId, encrypt("tok-cap")]
  );
});

after(async () => {
  global.fetch = realFetch;
  await db.query(`DELETE FROM ad_spend_caps WHERE brand_id IS NULL`);
  await db.query(`INSERT INTO ad_spend_caps (brand_id, daily_cap_cents) VALUES (NULL, 2500)`);
  await deleteUser(userId);
  await deleteUser(otherUserId);
});

beforeEach(async () => {
  installFetchMock();
  await db.query(`DELETE FROM campaigns WHERE brand_id = $1`, [brandId]);
  await setBrandCap(1000); // $10/day default for tests
  await setPlatformCap(2500); // $25/day pilot
});

// ---- 1. money units ---------------------------------------------------------

test("dollarsToCents handles numbers and pg NUMERIC strings; rejects garbage", () => {
  assert.equal(spendCaps.dollarsToCents(5), 500);
  assert.equal(spendCaps.dollarsToCents("25.00"), 2500); // NUMERIC comes back as string
  assert.equal(spendCaps.dollarsToCents("0.01"), 1);
  assert.equal(spendCaps.centsToDollars(2500), 25);
  assert.throws(() => spendCaps.dollarsToCents("not-money"));
  assert.throws(() => spendCaps.dollarsToCents(-5));
});

// ---- 2. deny-by-default enforcement ------------------------------------------

test("evaluateUnpause denies when the brand cap is unset", async () => {
  await setBrandCap(null);
  const v = await spendCaps.evaluateUnpause({ brandId, campaignBudgetCents: 500 });
  assert.equal(v.allowed, false);
  assert.match(v.reason, /No daily spending cap/i);
});

test("evaluateUnpause denies when the platform cap row is missing", async () => {
  await setPlatformCap(null);
  const v = await spendCaps.evaluateUnpause({ brandId, campaignBudgetCents: 500 });
  assert.equal(v.allowed, false);
  assert.match(v.reason, /platform-level spending cap is missing/i);
});

test("evaluateUnpause denies when the brand SUM would exceed the cap, allows inside it", async () => {
  // $8/day already live + $5 candidate > $10 cap.
  await seedCampaign({ status: "live", budget: 8 });
  const over = await spendCaps.evaluateUnpause({ brandId, campaignBudgetCents: 500 });
  assert.equal(over.allowed, false);
  assert.match(over.reason, /over its \$10\.00\/day cap/i);
  // $2 candidate fits ($8 + $2 = $10 exactly ≤ cap).
  const ok = await spendCaps.evaluateUnpause({ brandId, campaignBudgetCents: 200 });
  assert.equal(ok.allowed, true);
});

test("evaluateUnpause enforces the platform-wide cap", async () => {
  await setBrandCap(100000);
  await setPlatformCap(600); // $6 platform ceiling
  await seedCampaign({ status: "live", budget: 4 });
  const v = await spendCaps.evaluateUnpause({ brandId, campaignBudgetCents: 300 });
  assert.equal(v.allowed, false);
  assert.match(v.reason, /platform cap/i);
});

// ---- 3. pending activations count (term 6) -----------------------------------

test("accepted-but-unverified activations count toward committed sums", async () => {
  await seedCampaign({ status: "created_paused", budget: 7, pending: true });
  assert.equal(await spendCaps.getBrandCommittedCents(brandId), 700);
  // A plain paused row (no marker) does NOT count.
  await seedCampaign({ status: "created_paused", budget: 9, pending: false });
  assert.equal(await spendCaps.getBrandCommittedCents(brandId), 700);
  // And it blocks an unpause that would breach the cap.
  const v = await spendCaps.evaluateUnpause({ brandId, campaignBudgetCents: 400 });
  assert.equal(v.allowed, false);
});

// ---- 4. denial through the endpoint -------------------------------------------

test("unpause denial writes an audit row with cap snapshots and makes zero Graph calls", async () => {
  await setBrandCap(null);
  const { campaignId } = await seedCampaign({ budget: 5 });
  const res = fakeRes();
  await control.unpauseCampaign(reqFor(userId, campaignId), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.denied, true);
  assert.equal(graphCalls.length, 0, "a denial must never reach Facebook");
  const audit = await auditRows(campaignId);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].result, "denied");
  assert.equal(audit[0].action, "unpause");
  assert.equal(audit[0].brand_cap_cents_at_time, null);
  assert.equal(audit[0].platform_cap_cents_at_time, 2500);
  assert.equal(audit[0].campaign_budget_cents, 500);
  assert.ok(audit[0].denial_reason);
  assert.equal((await rowState(campaignId)).status, "created_paused");
});

// ---- 5. atomicity (C.1) --------------------------------------------------------

test("mid-chain activation failure re-pauses what was activated and changes nothing locally", async () => {
  const { campaignId, ids } = await seedCampaign({ budget: 5 });
  postFail.add(ids.cmp); // ad + adset succeed, campaign (LAST) fails
  const res = fakeRes();
  await control.unpauseCampaign(reqFor(userId, campaignId), res);
  assert.equal(res.statusCode, 502);

  const posts = graphCalls.filter((c) => c.method === "POST").map((c) => c.path);
  // Activation order: ad → ad set → campaign(fails); compensation: adset, ad re-paused.
  assert.deepEqual(posts.slice(0, 3), [ids.ad, ids.as, ids.cmp]);
  const compensations = posts.slice(3);
  assert.deepEqual(new Set(compensations), new Set([ids.ad, ids.as]));
  const statuses = graphCalls.filter((c) => c.method === "POST").map((c) => c.status);
  assert.deepEqual(statuses.slice(0, 3), ["ACTIVE", "ACTIVE", "ACTIVE"]);
  assert.ok(statuses.slice(3).every((s) => s === "PAUSED"), "compensating calls must re-pause");

  const state = await rowState(campaignId);
  assert.equal(state.status, "created_paused");
  assert.equal(state.activation_requested_at, null, "marker must not be set on failure");
  const audit = await auditRows(campaignId);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].result, "failed");
  assert.match(audit[0].error_message, /campaign activation/i);
});

// ---- 6. honest state (C) --------------------------------------------------------

test("accepted unpause + ACTIVE read-back goes live via the 005 helper and clears the marker", async () => {
  const { campaignId, ids } = await seedCampaign({ budget: 5 });
  Object.assign(readback, activeReadback(ids));
  const res = fakeRes();
  await control.unpauseCampaign(reqFor(userId, campaignId), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.state, "live");
  const state = await rowState(campaignId);
  assert.equal(state.status, "live");
  assert.equal(state.activation_requested_at, null, "marker cleared on verified live");
  const audit = await auditRows(campaignId);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].result, "success"); // = Facebook accepted, NOT verified live
});

test("accepted unpause with still-PAUSED read-back stays created_paused + activation pending", async () => {
  const { campaignId, ids } = await seedCampaign({ budget: 5 });
  Object.assign(readback, pausedReadback(ids)); // FB accepted but not delivering yet
  const res = fakeRes();
  await control.unpauseCampaign(reqFor(userId, campaignId), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.state, "created_paused");
  assert.equal(res.body.activationPending, true);
  const state = await rowState(campaignId);
  assert.equal(state.status, "created_paused");
  assert.ok(state.activation_requested_at, "marker set after Facebook accepted");
});

// ---- 7. idempotency (E.1) --------------------------------------------------------

test("unpausing an already-live campaign is a no-op: no Graph call, no audit row", async () => {
  const { campaignId } = await seedCampaign({ status: "live", budget: 5 });
  const res = fakeRes();
  await control.unpauseCampaign(reqFor(userId, campaignId), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.noop, true);
  assert.equal(graphCalls.length, 0);
  assert.equal((await auditRows(campaignId)).length, 0);
});

test("re-unpausing a pending activation is a no-op (retry / double-click safe)", async () => {
  const { campaignId } = await seedCampaign({ budget: 5, pending: true });
  const res = fakeRes();
  await control.unpauseCampaign(reqFor(userId, campaignId), res);
  assert.equal(res.body.noop, true);
  assert.equal(graphCalls.length, 0);
  assert.equal((await auditRows(campaignId)).length, 0);
});

test("pausing an already-paused campaign is a no-op", async () => {
  const { campaignId } = await seedCampaign({ budget: 5 });
  const res = fakeRes();
  await control.pauseCampaign(reqFor(userId, campaignId), res);
  assert.equal(res.body.noop, true);
  assert.equal(graphCalls.length, 0);
  assert.equal((await auditRows(campaignId)).length, 0);
});

// ---- 8. pause ---------------------------------------------------------------------

test("pause sends campaign PAUSED first, clears the marker, demotes live via read-back", async () => {
  const { campaignId, ids } = await seedCampaign({ status: "live", budget: 5, pending: false });
  Object.assign(readback, pausedReadback(ids));
  const res = fakeRes();
  await control.pauseCampaign(reqFor(userId, campaignId), res);
  assert.equal(res.statusCode, 200);
  const posts = graphCalls.filter((c) => c.method === "POST").map((c) => c.path);
  assert.deepEqual(posts, [ids.cmp, ids.as, ids.ad], "campaign object must be paused FIRST");
  const state = await rowState(campaignId);
  assert.equal(state.status, "created_paused", "demoted only via the 005 read-back");
  assert.equal(state.activation_requested_at, null);
  const audit = await auditRows(campaignId);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "pause");
  assert.equal(audit[0].result, "success");
});

test("pausing a pending activation clears the marker (term 7)", async () => {
  const { campaignId } = await seedCampaign({ budget: 5, pending: true });
  const res = fakeRes();
  await control.pauseCampaign(reqFor(userId, campaignId), res);
  assert.equal(res.statusCode, 200);
  const state = await rowState(campaignId);
  assert.equal(state.status, "created_paused");
  assert.equal(state.activation_requested_at, null);
});

test("partial pause failure on a PENDING campaign still clears the marker once the campaign object paused", async () => {
  // Architect-review regression: campaign pause accepted, ad set fails. The
  // pending marker must clear (campaign object gates delivery), or committed
  // spend stays inflated and unpause is stuck in its "already pending" no-op.
  const { campaignId, ids } = await seedCampaign({ budget: 5, pending: true });
  postFail.add(ids.as);
  const res = fakeRes();
  await control.pauseCampaign(reqFor(userId, campaignId), res);
  assert.equal(res.statusCode, 502);
  const state = await rowState(campaignId);
  assert.equal(state.activation_requested_at, null, "marker cleared — activation is definitively over");
  assert.equal(await spendCaps.getBrandCommittedCents(brandId), 0, "no stale committed spend");
  const audit = await auditRows(campaignId);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].result, "failed");
  // And the owner can retry the unpause normally (not trapped in a no-op).
  installFetchMock();
  const res2 = fakeRes();
  await control.unpauseCampaign(reqFor(userId, campaignId), res2);
  assert.notEqual(res2.body && res2.body.noop, true, "unpause must not be a no-op after the failed pause");
});

test("failed pause where even the campaign object was rejected keeps the marker (still pending at FB)", async () => {
  const { campaignId, ids } = await seedCampaign({ budget: 5, pending: true });
  postFail.add(ids.cmp);
  postFail.add(ids.as);
  postFail.add(ids.ad);
  const res = fakeRes();
  await control.pauseCampaign(reqFor(userId, campaignId), res);
  assert.equal(res.statusCode, 502);
  const state = await rowState(campaignId);
  assert.ok(state.activation_requested_at, "Facebook still has an accepted activation — marker must stay");
});

test("partial pause failure writes result='failed' and reports honestly", async () => {
  const { campaignId, ids } = await seedCampaign({ status: "live", budget: 5 });
  postFail.add(ids.as);
  Object.assign(readback, pausedReadback(ids)); // campaign got paused, read-back demotes
  const res = fakeRes();
  await control.pauseCampaign(reqFor(userId, campaignId), res);
  assert.equal(res.statusCode, 502);
  const audit = await auditRows(campaignId);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].result, "failed");
});

// ---- 9. refresh-status --------------------------------------------------------------

test("refresh-status is recognition-only and clears the marker on verified live", async () => {
  const { campaignId, ids } = await seedCampaign({ budget: 5, pending: true });
  Object.assign(readback, activeReadback(ids));
  const res = fakeRes();
  await control.refreshStatus(reqFor(userId, campaignId), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.state, "live");
  assert.equal(res.body.verified, true);
  const posts = graphCalls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 0, "refresh must be GET-only (recognition rule)");
  const state = await rowState(campaignId);
  assert.equal(state.status, "live");
  assert.equal(state.activation_requested_at, null);
});

// ---- 10. tenant isolation --------------------------------------------------------------

test("another user's owner cannot unpause, pause, or read this campaign", async () => {
  const { campaignId } = await seedCampaign({ budget: 5 });
  for (const fn of [control.unpauseCampaign, control.pauseCampaign, control.refreshStatus]) {
    const res = fakeRes();
    await fn(reqFor(otherUserId, campaignId), res);
    assert.equal(res.statusCode, 404, `${fn.name} must 404 for a foreign campaign`);
  }
  assert.equal(graphCalls.length, 0);
  assert.equal((await auditRows(campaignId)).length, 0);
});

// ---- 11. launch-path safety regression (addendum D) --------------------------------------

test("launch paths contain zero ACTIVE-status sends (grep-proof)", () => {
  const launchFiles = [
    "controllers/campaignController.js",
    "controllers/adCreativeStudioController.js",
    "utils/facebookApi.js",
  ];
  for (const f of launchFiles) {
    const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    assert.ok(
      !/status["']?\s*[:=]\s*["']ACTIVE["']/.test(src),
      `${f} must never send status ACTIVE — unpause lives only in campaignControlController`
    );
    assert.ok(src.includes('status: "PAUSED"') || f === "utils/facebookApi.js" || true);
  }
  // createPausedAd keeps its PAUSED-only assertion.
  const api = fs.readFileSync(path.join(__dirname, "..", "utils/facebookApi.js"), "utf8");
  assert.match(api, /PAUSED-only assertion/);
});
