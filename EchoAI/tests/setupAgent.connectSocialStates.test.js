// 026-C1 Stage 2 (AM-C1-1) — connect_social's three honest states, driven
// through the REAL executeNextAction path against the test DB: an explicit
// social_accounts binding is the only thing that makes a platform "connected";
// user-level Facebook credentials without a Page binding route to the Page
// picker; nothing at all routes to the generic connect handoff.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { db, createTestUser, deleteUser } = require("./helpers");
const setupAgent = require("../controllers/setupAgentController");
const { encrypt } = require("../utils/encryption");

// Every ACTIONS key before connect_social, marked complete so the executor's
// next pending action is exactly the one under test.
const PRIOR_STEPS = [
  "create_brand_profile",
  "set_availability",
  "connect_google",
  "content_calendar",
  "ad_creatives",
  "create_facebook_campaign",
  "setup_google_ads",
];

let userId;
let brandId;

function mockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.payload = obj;
      return this;
    },
  };
}

async function makeSession() {
  const { rows } = await db.query(
    `INSERT INTO setup_sessions (user_id, brand_id, status, interview_complete, consent_granted,
                                 completed_steps, answers)
     VALUES ($1, $2, 'in_progress', TRUE, TRUE, $3::jsonb, $4::jsonb)
     RETURNING *`,
    [
      userId,
      brandId,
      JSON.stringify(PRIOR_STEPS),
      JSON.stringify({ platforms: "facebook" }),
    ],
  );
  return rows[0];
}

async function execute(session) {
  const res = mockRes();
  await setupAgent.executeNextAction(
    { user: { userId }, setupSession: session, body: {} },
    res,
  );
  return res;
}

before(async () => {
  userId = await createTestUser();
  const b = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, 'Stage2 States Brand') RETURNING brand_id",
    [userId],
  );
  brandId = b.rows[0].brand_id;
  // A draft calendar must exist or connect_social skips as "nothing to publish".
  await db.query(
    `INSERT INTO content_calendars (brand_id, month, year, posting_frequency, status)
     VALUES ($1, 8, 2026, 'daily', 'draft')`,
    [brandId],
  );
});

beforeEach(async () => {
  await db.query("DELETE FROM setup_sessions WHERE user_id = $1", [userId]);
  await db.query("DELETE FROM social_accounts WHERE brand_id = $1", [brandId]);
  await db.query("DELETE FROM api_integrations WHERE user_id = $1", [userId]);
});

after(async () => {
  await deleteUser(userId);
  await db.pool.end();
});

test("state C: no credentials anywhere pauses with the generic social connect", async () => {
  const res = await execute(await makeSession());
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, "needs_connection");
  assert.equal(res.payload.connect.type, "social");
});

test("state B: Facebook credentials WITHOUT a Page binding pause with the Page picker — never a false 'connected'", async () => {
  await db.query(
    `INSERT INTO api_integrations (user_id, platform, api_token_encrypted, connection_status)
     VALUES ($1, 'facebook', $2, 'connected')`,
    [userId, encrypt("user-level-token")],
  );
  const res = await execute(await makeSession());
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, "needs_connection");
  assert.equal(res.payload.connect.type, "social_select_page");
});

test("state A: an explicit social_accounts binding completes the step", async () => {
  await db.query(
    `INSERT INTO social_accounts (brand_id, platform, platform_username, credentials_encrypted, connection_status)
     VALUES ($1, 'facebook', 'Bound Page', $2, 'connected')`,
    [brandId, encrypt(JSON.stringify({ pageId: "page-1" }))],
  );
  const res = await execute(await makeSession());
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, "done");
  assert.match(res.payload.detail, /facebook/i);
});

test("disconnected user-level credentials do NOT unlock the Page picker — they are state C", async () => {
  await db.query(
    `INSERT INTO api_integrations (user_id, platform, api_token_encrypted, connection_status)
     VALUES ($1, 'facebook', $2, 'disconnected')`,
    [userId, encrypt("stale-token")],
  );
  const res = await execute(await makeSession());
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, "needs_connection");
  assert.equal(res.payload.connect.type, "social");
});
