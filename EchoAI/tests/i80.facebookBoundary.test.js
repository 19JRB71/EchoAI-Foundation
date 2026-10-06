// Isolated PostgreSQL + actual HTTP/auth/controller boundaries. No provider traffic.
require("./dbGuard");
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const session = require("express-session");
const jwt = require("jsonwebtoken");
const { db, createTestUser, deleteUser } = require("./helpers");
const { encrypt, decrypt } = require("../utils/encryption");
process.env.FACEBOOK_APP_ID = "test-app";
process.env.FACEBOOK_APP_SECRET = "test-secret";
const social = require("../controllers/socialController");
const socialApi = require("../utils/socialApi");
const onboarding = require("../controllers/onboardingController");
const auth = require("../middleware/auth");
const nativeFetch = global.fetch;
let server, base, pages, calls, sweeps, refreshFailure, sessions;
const providerMethods = ["publishPost", "verifyConnection", "fetchMetrics", "verifyPostExists"];
const originalProviders = Object.fromEntries(providerMethods.map((key) => [key, socialApi[key]]));
const originalSweep = social.publishDuePosts;
test.before(async () => {
  for (const key of providerMethods) socialApi[key] = async () => {
    calls.push(`FORBIDDEN:${key}`);
    throw new Error(`Unexpected provider execution blocked: ${key}`);
  };
  global.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    assert.equal(url.hostname, "graph.facebook.com", "unexpected external request blocked");
    let body;
    if (url.pathname.endsWith("/oauth/access_token")) body = { access_token: "stub-user-token" };
    else if (url.pathname.endsWith("/me/adaccounts")) body = { data: [] };
    else if (url.pathname.endsWith("/me/accounts")) {
      if (refreshFailure) return { ok: false, status: 503, json: async () => ({ error: { message: "temporary grant outage" } }) };
      body = { data: pages };
    }
    else if (url.pathname.endsWith("/ratings")) body = { data: [] };
    else throw new Error(`Unstubbed provider request: ${url.pathname}`);
    return { ok: true, status: 200, json: async () => body };
  };
  social.publishDuePosts = async () => { sweeps++; };
  const app = express();
  app.use(express.json());
  sessions = new session.MemoryStore();
  app.use(session({ store: sessions, secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
  app.use("/api/facebook", require("../routes/facebookOAuthRoutes"));
  // Minimal routers retain actual auth; unrelated feature gates/providers are not booted.
  const router = express.Router();
  router.use(auth);
  router.post("/social/facebook-page", social.setFacebookBrandPage);
  router.post("/social/connect", social.connectSocialAccount);
  router.post("/onboarding/first-win/prepare", onboarding.prepareFirstWinPost);
  router.post("/onboarding/first-win/arm", onboarding.armFirstWinPost);
  router.post("/onboarding/first-win/disarm", onboarding.disarmFirstWinPost);
  router.get("/onboarding/status", onboarding.getStatus);
  router.put("/brands/:brandId", require("../controllers/brandController").updateBrand);
  router.post("/reputation/:brandId/fetch", require("../controllers/reputationController").fetchReviews);
  app.use("/api", router);
  server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  global.fetch = nativeFetch;
  social.publishDuePosts = originalSweep;
  Object.assign(socialApi, originalProviders);
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.pool.end();
});
async function request(user, path, body, method = body === undefined ? "GET" : "POST", cookie) {
  const res = await nativeFetch(base + path, {
    method, redirect: "manual",
    headers: { ...(user ? { Authorization: `Bearer ${jwt.sign({ userId: user }, process.env.JWT_SECRET)}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text.startsWith("{") ? JSON.parse(text) : text,
    cookie: res.headers.get("set-cookie")?.split(";")[0], location: res.headers.get("location") };
}
async function fixture(fn) {
  const user = await createTestUser();
  const other = await createTestUser();
  calls = []; sweeps = 0; refreshFailure = false;
  pages = ["page-a", "page-b"].map((id) => ({ id, name: id, access_token: `token-${id}` }));
  const brand = async (owner, name) => (await db.query(
    "INSERT INTO brands(user_id, brand_name) VALUES($1,$2) RETURNING brand_id", [owner, name])).rows[0].brand_id;
  try {
    await fn({ user, other, a: await brand(user, "Business A"), b: await brand(user, "Business B"),
      foreign: await brand(other, "Private business") });
  } finally { await deleteUser(user); await deleteUser(other); }
}
async function grant(user, visible = pages, tokens = Object.fromEntries(visible.map((p) => [p.id, p.access_token]))) {
  await db.query(`INSERT INTO api_integrations(user_id,platform,api_token_encrypted,facebook_pages,
    facebook_page_tokens,connection_status,page_ref) VALUES($1,'facebook',$2,$3::jsonb,$4,'connected','page-a')
    ON CONFLICT(user_id,platform) DO UPDATE SET facebook_pages=EXCLUDED.facebook_pages,
    facebook_page_tokens=EXCLUDED.facebook_page_tokens,connection_status='connected'`,
  [user, encrypt("stub-user-token"), JSON.stringify(visible.map(({ id, name }) => ({ id, name }))), encrypt(JSON.stringify(tokens))]);
}
const c1 = (user, brandId, pageId, extra = {}) => request(user, "/api/social/facebook-page",
  { brandId, pageId, intent: "confirm_business_facebook_page", ...extra });
const c3 = (user, brandId, pageId, extra = {}) => request(user, "/api/facebook/select-page",
  { brandId, pageId, adLinkUrl: "https://example.test/", intent: "confirm_ads_destination", ...extra });
async function state(brandId) {
  const brand = (await db.query("SELECT facebook_page_id,ad_link_url FROM brands WHERE brand_id=$1", [brandId])).rows[0];
  const rows = (await db.query("SELECT * FROM social_accounts WHERE brand_id=$1 AND platform='facebook'", [brandId])).rows;
  return { ...brand, posting: rows[0] ? JSON.parse(decrypt(rows[0].credentials_encrypted)).pageId : null, rows };
}
async function prepare(user, brandId, destinationPageId) {
  const prepared = await request(user, "/api/onboarding/first-win/prepare", { brandId, postContent: "Consent artifact stays unchanged." });
  assert.equal(prepared.status, 201, JSON.stringify(prepared.body));
  const armed = await request(user, "/api/onboarding/first-win/arm", {
    postId: prepared.body.post.postId, destinationPageId,
    consentCopyVersion: destinationPageId ? "p024-v1-destination-known" : "p024-v1-destination-unbound",
  });
  assert.equal(armed.status, 201, JSON.stringify(armed.body));
  return armed.body.authorization.authorizationId;
}
async function authorization(id) {
  return (await db.query(`SELECT a.*,p.status AS post_status,p.post_content FROM armed_publish_authorizations a
    JOIN social_posts p ON p.post_id=a.post_id WHERE authorization_id=$1`, [id])).rows[0];
}
async function start(user, brandId, authorizationId, extra = {}) {
  const result = await request(user, "/api/facebook/oauth/initiate", { brandId, authorizationId, returnStep: "social_select_page", ...extra });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return { cookie: result.cookie, nonce: new URL(result.body.authUrl).searchParams.get("state") };
}
const callback = ({ cookie, nonce }, suffix = "") =>
  request(null, `/api/facebook/oauth/callback?code=stub&state=${nonce}${suffix}`, undefined, "GET", cookie);

test("H-corrupt: unreadable ciphertext, invalid JSON and absent Page identity block C1 and C3 without mutation", () => fixture(async ({ user, a, b }) => {
  await grant(user);
  for (const credentials of ["not-ciphertext", encrypt("not-json"), encrypt("{}"), encrypt('{"pageId":null}')]) {
    await db.query("DELETE FROM social_accounts WHERE brand_id=$1", [b]);
    await db.query("INSERT INTO social_accounts(brand_id,platform,credentials_encrypted) VALUES($1,'facebook',$2)", [b, credentials]);
    const before = (await db.query("SELECT * FROM social_accounts WHERE brand_id=$1", [b])).rows;
    assert.equal((await c1(user, a, "page-a")).status, 500);
    assert.equal((await c3(user, a, "page-a")).status, 500);
    assert.equal((await state(a)).posting, null);
    assert.equal((await state(a)).facebook_page_id, null);
    assert.deepEqual((await db.query("SELECT * FROM social_accounts WHERE brand_id=$1", [b])).rows, before);
    assert.deepEqual(calls, []);
  }
}));

test("H-refresh: transient grant fetch failure preserves S1, S2, S3 and prepared authorization", () => fixture(async ({ user, a }) => {
  await grant(user);
  assert.equal((await c1(user, a, "page-a")).status, 200);
  assert.equal((await c3(user, a, "page-a")).status, 200);
  const id = await prepare(user, a, "page-a");
  const integration = async () => (await db.query("SELECT * FROM api_integrations WHERE user_id=$1", [user])).rows;
  const before = { grant: await integration(), binding: await state(a), auth: await authorization(id) };
  const oauth = await start(user, a, id);
  refreshFailure = true;
  assert.match((await callback(oauth)).location, /fb=error/);
  assert.deepEqual(await integration(), before.grant);
  assert.deepEqual(await state(a), before.binding);
  assert.deepEqual(await authorization(id), before.auth);
  assert.equal(sweeps, 0);
  assert.ok(!calls.some((s) => s.startsWith("FORBIDDEN:")));
}));

test("H-expiry-return: expired OAuth nonce and invalid return step fail before provider or writes", () => fixture(async ({ user, a }) => {
  await grant(user);
  const id = await prepare(user, a);
  assert.equal((await request(user, "/api/facebook/oauth/initiate", {
    brandId: a, authorizationId: id, returnStep: "https://evil.test/",
  })).status, 400);
  const oauth = await start(user, a, id);
  const all = await new Promise((resolve, reject) => sessions.all((err, value) => err ? reject(err) : resolve(value)));
  const entry = Object.entries(all).find(([, value]) => value.fbOAuth?.state === oauth.nonce);
  assert.ok(entry);
  entry[1].fbOAuth.expiresAt = Date.now() - 1;
  await new Promise((resolve, reject) => sessions.set(entry[0], entry[1], (err) => err ? reject(err) : resolve()));
  assert.match((await callback(oauth)).location, /fb=error/);
  assert.deepEqual(calls, []);
  assert.equal((await authorization(id)).status, "armed");
  assert.equal((await state(a)).posting, null);
}));

// Pause real transactions at their lock boundary, not SQL-string mocks. A
// facade prevents pooled clients retaining patched query methods on release.
async function waitForLock(count = 1) {
  for (let i = 0; i < 200; i++) {
    const { rows } = await db.query("SELECT COUNT(*)::int AS blocked FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'");
    if (rows[0].blocked >= count) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail("second request never reached a real PostgreSQL lock wait");
}
async function interleave(match, first, second) {
  const getClient = db.getClient;
  let release, reached;
  const gate = new Promise((r) => { release = r; });
  const locked = new Promise((r) => { reached = r; });
  let used = false;
  db.getClient = async (...args) => {
    const client = await getClient(...args);
    return { release: client.release.bind(client), query: async (...q) => {
      const result = await client.query(...q);
      if (!used && match(String(q[0]))) { used = true; reached(); await gate; }
      return result;
    } };
  };
  const timeout = setTimeout(() => { reached(); release(); }, 8000);
  try {
    const a = first();
    await locked;
    assert.ok(used, "first request reached real locked transaction");
    const b = second();
    await waitForLock();
    release();
    return await Promise.all([a, b]);
  } finally { release(); clearTimeout(timeout); db.getClient = getClient; }
}

for (const action of ["disarm", "edit"]) {
  for (const order of ["before", "confirm-first", "during"]) {
    test(`H-race: ${action} ${order} confirmation preserves the consent boundary`, () => fixture(async ({ user, a }) => {
      await grant(user);
      const id = await prepare(user, a);
      const original = await authorization(id);
      const confirm = () => c1(user, a, "page-a", { authorizationId: id });
      const mutate = () => action === "disarm"
        ? request(user, "/api/onboarding/first-win/disarm", { authorizationId: id })
        : request(user, "/api/onboarding/first-win/prepare", { brandId: a, postContent: "Edited content requires new consent." });
      let confirmation, mutation;
      if (order === "before") { mutation = await mutate(); confirmation = await confirm(); }
      else if (order === "confirm-first") {
        [confirmation, mutation] = await interleave(
          (sql) => /SELECT a\.armed_at/.test(sql), confirm, mutate);
      } else if (action === "edit") {
        [mutation, confirmation] = await interleave(
          (sql) => /SELECT post_id, status FROM social_posts/.test(sql), mutate, confirm);
      } else {
        // Real disarm row lock wins while C1 is in flight.
        const client = await db.getClient();
        try {
          await client.query("BEGIN");
          await client.query("SELECT authorization_id FROM armed_publish_authorizations WHERE authorization_id=$1 FOR UPDATE", [id]);
          const disarming = mutate();
          await waitForLock();
          const pending = confirm();
          await waitForLock(2);
          await client.query("COMMIT");
          confirmation = await pending;
          mutation = await disarming;
        } finally { await client.query("ROLLBACK"); client.release(); }
      }
      const after = await authorization(id);
      assert.equal(sweeps, 0);
      assert.deepEqual(calls, []);
      if (confirmation.status === 200) {
        assert.equal(mutation.status, 409, JSON.stringify(mutation.body));
        assert.equal(after.status, "claimed");
        assert.equal(after.post_status, "scheduled");
        assert.equal(after.post_content, original.post_content);
        assert.equal(after.content_hash, original.content_hash);
      } else {
        assert.equal(confirmation.status, 409, JSON.stringify(confirmation.body));
        assert.equal(after.post_status, "prepared");
        assert.equal((await state(a)).posting, null);
        assert.equal(after.status, action === "disarm" ? "disarmed" : "invalidated");
      }
    }));
  }
}

test("H: real wrong-brand pages[0] callback cannot bind, schedule or publish; C1 preserves content consent", () => fixture(async ({ user, a, b }) => {
  await grant(user);
  assert.equal((await c1(user, a, "page-a")).status, 200);
  const originalA = await state(a);
  const id = await prepare(user, b);
  const before = await authorization(id);
  const oauth = await start(user, b, id);
  const result = await callback(oauth);
  assert.match(result.location, /fb=pending/);
  assert.equal((await state(b)).posting, null);
  assert.deepEqual(await state(a), originalA);
  assert.deepEqual(await authorization(id), before);
  assert.equal(sweeps, 0);
  const list = await request(user, `/api/facebook/accounts?brandId=${b}`);
  assert.equal(list.body.selectedPageId, null);
  assert.equal(list.body.pages[0].unavailable, true);
  assert.equal(list.body.pages[0].boundBusinessName, "Business A");
  assert.equal((await c1(user, b, "page-a", { authorizationId: id })).status, 409);
  assert.equal((await c1(user, b, "page-b", { authorizationId: id })).status, 200);
  const after = await authorization(id);
  assert.equal(after.content_hash, before.content_hash);
  assert.equal(after.consent_copy_version, before.consent_copy_version);
  assert.equal(after.post_content, before.post_content);
  assert.equal(after.status, "claimed");
  assert.equal(after.post_status, "scheduled");
  assert.equal(after.destination_page_id, "page-b");
  assert.equal((await state(b)).facebook_page_id, null);
}));

test("H: singleton list/GET/status/skip remain unselected, zero writes and zero provider calls despite defaults", () => fixture(async ({ user, a }) => {
  pages = [pages[0]];
  await grant(user);
  const id = await prepare(user, a);
  const before = await authorization(id);
  const store = await state(a);
  const integration = (await db.query("SELECT * FROM api_integrations WHERE user_id=$1", [user])).rows;
  process.env.FACEBOOK_PAGE_ID = "page-a";
  try {
    for (let i = 0; i < 2; i++) {
      const list = await request(user, `/api/facebook/accounts?brandId=${a}`);
      assert.equal(list.status, 200);
      assert.equal(list.body.pages.length, 1);
      assert.equal(list.body.selectedPageId, null);
      assert.equal((await request(user, "/api/onboarding/status")).status, 200);
    }
    assert.equal((await request(user, "/api/social/facebook-page", { brandId: a, pageId: "page-a" })).status, 400);
    assert.equal((await c1(user, a, null)).status, 400);
    assert.deepEqual(await authorization(id), before);
    assert.deepEqual(await state(a), store);
    assert.deepEqual((await db.query("SELECT * FROM api_integrations WHERE user_id=$1", [user])).rows, integration);
    assert.deepEqual(calls, []);
    assert.equal(sweeps, 0);
  } finally { delete process.env.FACEBOOK_PAGE_ID; }
}));

test("H: OAuth scoped nonce rejects partial/foreign context, mismatch and replay before provider", () => fixture(async ({ user, other, a, b, foreign }) => {
  assert.equal((await request(user, "/api/facebook/oauth/initiate", { returnStep: "social_select_page" })).status, 404);
  assert.equal((await request(user, "/api/facebook/oauth/initiate", { brandId: foreign })).status, 404);
  const id = await prepare(user, a);
  assert.equal((await request(user, "/api/facebook/oauth/initiate", { brandId: b, authorizationId: id })).status, 409);
  assert.equal((await request(other, "/api/facebook/oauth/initiate", { brandId: a, authorizationId: id })).status, 404);
  const sessionId = (await db.query(`INSERT INTO setup_sessions(user_id,brand_id,status)
    VALUES($1,$2,'in_progress') RETURNING session_id`, [user, b])).rows[0].session_id;
  assert.equal((await request(user, "/api/facebook/oauth/initiate", { brandId: a, sessionId })).status, 409);
  const oauth = await start(user, a, id);
  assert.match((await callback({ ...oauth, nonce: "wrong" })).location, /fb=error/);
  assert.match((await callback(oauth)).location, /fb=error/);
  assert.deepEqual(calls, []);
  assert.equal((await authorization(id)).status, "armed");
}));

test("H: generic context-free OAuth grants S1 only, never borrows an armed authorization or binds a business", () => fixture(async ({ user, a, b }) => {
  const boundId = await prepare(user, a, "page-a");
  const nullId = await prepare(user, b);
  const before = [await authorization(boundId), await authorization(nullId)];
  const stores = [await state(a), await state(b)];
  const initiated = await request(user, "/api/facebook/oauth/initiate", {});
  assert.equal(initiated.status, 200);
  const oauth = { cookie: initiated.cookie, nonce: new URL(initiated.body.authUrl).searchParams.get("state") };
  await callback(oauth, `&brandId=${a}&authorizationId=${boundId}`);
  const grantRow = (await db.query("SELECT connection_status,facebook_pages,page_ref FROM api_integrations WHERE user_id=$1", [user])).rows[0];
  assert.equal(grantRow.connection_status, "connected");
  assert.equal(grantRow.facebook_pages.length, 2);
  assert.equal(grantRow.page_ref, null);
  assert.deepEqual([await state(a), await state(b)], stores);
  assert.deepEqual([await authorization(boundId), await authorization(nullId)], before);
  assert.equal(sweeps, 0);
  assert.equal(calls.some((path) => path.startsWith("FORBIDDEN:")), false);
}));

test("H: exact-bound OAuth schedules only existing C1 binding, ignores pages[0], and nonce replay is inert", () => fixture(async ({ user, a }) => {
  await grant(user);
  assert.equal((await c1(user, a, "page-b")).status, 200);
  const id = await prepare(user, a, "page-b");
  const store = await state(a);
  const oauth = await start(user, a, id);
  await callback(oauth, "&brandId=00000000-0000-0000-0000-000000000000");
  assert.equal((await authorization(id)).status, "claimed");
  assert.equal((await authorization(id)).destination_page_id, "page-b");
  assert.deepEqual(await state(a), store);
  const count = calls.length;
  assert.match((await callback(oauth)).location, /fb=error/);
  assert.equal(calls.length, count);
}));

test("H: bound callback mismatch/missing grant never replaces existing binding or schedules", () => fixture(async ({ user, a }) => {
  await grant(user);
  assert.equal((await c1(user, a, "page-a")).status, 200);
  const id = await prepare(user, a, "page-b");
  const store = await state(a);
  pages = [pages[0]];
  await callback(await start(user, a, id));
  assert.deepEqual(await state(a), store);
  assert.equal((await authorization(id)).post_status, "prepared");
  assert.notEqual((await authorization(id)).status, "claimed");
  assert.equal(sweeps, 0);
}));

test("H: owner and cross-owner collisions rejected; PostgreSQL concurrent C1 attempts have exactly one winner", () => fixture(async ({ user, other, a, b, foreign }) => {
  await grant(user); await grant(other);
  const outcomes = await Promise.all([c1(user, a, "page-a"), c1(user, b, "page-a")]);
  assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
  assert.equal([await state(a), await state(b)].filter((s) => s.posting === "page-a").length, 1);
  assert.equal((await c1(other, foreign, "page-a")).status, 409);
  assert.equal((await c1(other, a, "page-b")).status, 404);
  assert.equal((await state(foreign)).posting, null);
  const list = await request(other, `/api/facebook/accounts?brandId=${foreign}`);
  assert.equal(list.body.pages[0].boundBusinessName, "another business");
  assert.equal(JSON.stringify(list.body).includes("Business A"), false);
}));

test("R-S3a/b/c: generic writes rejected, explicit C3 write/removal identity, three stores stay separate", () => fixture(async ({ user, a }) => {
  await grant(user);
  assert.equal((await c3(user, a, "page-a")).status, 200);
  const ads = await state(a);
  assert.equal(ads.posting, null);
  for (const payload of [{ facebook_page_id: "page-b", ad_link_url: "https://evil.test" },
    { facebookPageId: null, adLinkUrl: null }]) {
    const result = await request(user, `/api/brands/${a}`, payload, "PUT");
    assert.equal(result.status, 400);
    assert.deepEqual(await state(a), ads);
  }
  assert.equal((await request(user, "/api/facebook/select-page", { brandId: a, pageId: "page-a" })).status, 400);
  assert.equal((await c1(user, a, "page-b", { intent: "confirm_ads_destination" })).status, 400);
  assert.equal((await c3(user, a, "page-a", { intent: "confirm_business_facebook_page" })).status, 400);
  assert.equal((await c1(user, a, "page-b")).status, 200);
  const both = await state(a);
  assert.equal(both.facebook_page_id, ads.facebook_page_id);
  assert.equal(both.ad_link_url, ads.ad_link_url);
  assert.equal((await c3(user, a, "page-b", { remove: true, adLinkUrl: null })).status, 409);
  assert.equal((await c3(user, a, "page-a", { remove: true })).status, 400);
  assert.equal((await c3(user, a, "page-a", { remove: true, adLinkUrl: null })).status, 200);
  const removed = await state(a);
  assert.equal(removed.facebook_page_id, null);
  assert.equal(removed.ad_link_url, null);
  assert.deepEqual(removed.rows, both.rows);
  assert.equal((await db.query("SELECT page_ref FROM api_integrations WHERE user_id=$1", [user])).rows[0].page_ref, "page-a");
}));

test("R-REPa/b/c: reputation reads exact C1 Page, unbound and foreign businesses never enumerate or borrow", () => fixture(async ({ user, other, a, b }) => {
  await grant(user);
  assert.equal((await c1(user, a, "page-b")).status, 200);
  assert.equal((await c3(user, a, "page-a")).status, 200);
  const result = await request(user, `/api/reputation/${a}/fetch`, {});
  assert.equal(result.status, 200);
  assert.equal(result.body.platforms.facebook.error, null);
  assert.deepEqual(calls, ["/v19.0/page-b/ratings"]);
  calls = [];
  const unbound = await request(user, `/api/reputation/${b}/fetch`, {});
  assert.match(unbound.body.platforms.facebook.error, /no page bound/i);
  assert.equal((await request(other, `/api/reputation/${a}/fetch`, {})).status, 404);
  assert.deepEqual(calls, []);
}));

test("H: grant loss and legacy embedded-token accounts preserve binding but cannot execute", () => fixture(async ({ user, a, b }) => {
  await grant(user);
  assert.equal((await c1(user, a, "page-a")).status, 200);
  const store = await state(a);
  await grant(user, pages, {});
  assert.equal((await c1(user, a, "page-a")).status, 409);
  const list = await request(user, `/api/facebook/accounts?brandId=${a}`);
  assert.equal(list.body.pages[0].unavailable, true);
  await assert.rejects(social.publishStoredPost({ brand_id: a, platform: "facebook", post_content: "never send" }));
  assert.deepEqual(await state(a), store);
  assert.equal(await social.reverifyAccountRow(store.rows[0]), "flagged");
  assert.equal((await state(a)).posting, "page-a");
  assert.equal((await state(a)).rows[0].connection_status, "error");
  assert.equal((await request(user, "/api/social/connect", { brandId: b, platform: "facebook",
    credentials: { pageId: "page-a", accessToken: "legacy-token" } })).status, 400);
  await db.query(`INSERT INTO social_accounts(brand_id,platform,credentials_encrypted,connection_status)
    VALUES($1,'facebook',$2,'connected')`, [b, encrypt(JSON.stringify({ pageId: "page-a", accessToken: "legacy-token" }))]);
  // Restore a valid grant: now it is the collision guard, not missing tokens,
  // which must block a legacy cross-business duplicate.
  await grant(user);
  await assert.rejects(social.publishStoredPost({ brand_id: b, platform: "facebook", post_content: "never send" }));
  assert.equal(await social.resolveFacebookPageToken(b, "page-a"), null);
  assert.deepEqual(calls, []);
}));

test("H: C1 and C3 concurrent cross-owner attempts serialize on the same Page", () => fixture(async ({ user, other, a, foreign }) => {
  await grant(user); await grant(other);
  const results = await Promise.all([c1(user, a, "page-a"), c3(other, foreign, "page-a")]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const s2 = await state(a), s3 = await state(foreign);
  assert.equal(Number(s2.posting === "page-a") + Number(s3.facebook_page_id === "page-a"), 1);
  assert.equal(s2.facebook_page_id, null);
  assert.equal(s3.posting, null);
}));

test("H: exact prior consent with no S2 converges on C1; missing consent never does", () => fixture(async ({ user, a, b }) => {
  const id = await prepare(user, a, "page-b");
  await callback(await start(user, a, id));
  assert.equal((await state(a)).posting, "page-b");
  assert.equal((await authorization(id)).status, "claimed");
  assert.equal((await state(a)).facebook_page_id, null);
  await callback(await start(user, b));
  assert.equal((await state(b)).posting, null);
}));

test("H: real auth remapping never lets a team member confirm C1/C3 or initiate OAuth", () => fixture(async ({ user, other, a }) => {
  await grant(user);
  await db.query(`INSERT INTO team_members
    (account_owner_user_id,invited_user_id,email,role,status,accepted_at)
    VALUES($1,$2,$3,'admin','active',NOW())`, [user, other, `${other}@example.test`]);
  assert.equal((await c1(other, a, "page-a")).status, 403);
  assert.equal((await c3(other, a, "page-a")).status, 403);
  assert.equal((await request(other, "/api/facebook/oauth/initiate", { brandId: a })).status, 403);
  assert.equal((await state(a)).posting, null);
  assert.equal((await state(a)).facebook_page_id, null);
  assert.deepEqual(calls, []);
}));