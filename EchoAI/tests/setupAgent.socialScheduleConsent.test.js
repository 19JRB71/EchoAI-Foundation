// 026-C1 Stage 2 (R26/R27) — the setup agent's social_schedule step goes
// through the REAL digest-guarded activateCalendar boundary (no parallel
// unguarded path), pauses for consent when none is given, and skip-at-gate
// activates nothing. Driven through executeNextAction against the test DB.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { db, createTestUser, deleteUser } = require("./helpers");
const setupAgent = require("../controllers/setupAgentController");
const { encrypt } = require("../utils/encryption");

// Every ACTIONS key before social_schedule marked complete.
const PRIOR_STEPS = [
  "create_brand_profile",
  "set_availability",
  "connect_google",
  "content_calendar",
  "ad_creatives",
  "create_facebook_campaign",
  "setup_google_ads",
  "connect_social",
];

let userId;
let brandId;
let calendarId;

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
     VALUES ($1, $2, 'in_progress', TRUE, TRUE, $3::jsonb, '{}'::jsonb)
     RETURNING *`,
    [userId, brandId, JSON.stringify(PRIOR_STEPS)],
  );
  return rows[0];
}

async function execute(session, body = {}) {
  const res = mockRes();
  await setupAgent.executeNextAction(
    { user: { userId }, setupSession: session, body },
    res,
  );
  return res;
}

async function draftStatuses() {
  const { rows } = await db.query(
    "SELECT status, COUNT(*)::int AS n FROM social_posts WHERE calendar_id = $1 GROUP BY status",
    [calendarId],
  );
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

before(async () => {
  userId = await createTestUser();
  const b = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, 'Stage2 Schedule Brand') RETURNING brand_id",
    [userId],
  );
  brandId = b.rows[0].brand_id;
  const c = await db.query(
    `INSERT INTO content_calendars (brand_id, month, year, posting_frequency, status)
     VALUES ($1, 8, 2026, 'daily', 'draft') RETURNING calendar_id`,
    [brandId],
  );
  calendarId = c.rows[0].calendar_id;
  await db.query(
    `INSERT INTO social_accounts (brand_id, platform, platform_username, credentials_encrypted, connection_status)
     VALUES ($1, 'facebook', 'Sched Page', $2, 'connected')`,
    [brandId, encrypt(JSON.stringify({ pageId: "page-sched" }))],
  );
  await db.query(
    `INSERT INTO social_posts (brand_id, calendar_id, platform, post_content, scheduled_time, status)
     VALUES ($1, $2, 'facebook', 'stage2 sched post', NOW() + INTERVAL '2 hours', 'draft')`,
    [brandId, calendarId],
  );
});

beforeEach(async () => {
  await db.query("DELETE FROM setup_sessions WHERE user_id = $1", [userId]);
  // Reset: everything back to draft, calendar back to draft.
  await db.query("UPDATE social_posts SET status = 'draft' WHERE calendar_id = $1", [calendarId]);
  await db.query("UPDATE content_calendars SET status = 'draft' WHERE calendar_id = $1", [calendarId]);
});

after(async () => {
  await deleteUser(userId);
  await db.pool.end();
});

test("without a confirmation the step pauses with the preview and activates NOTHING", async () => {
  const res = await execute(await makeSession());
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, "needs_connection");
  assert.equal(res.payload.connect.type, "activate_calendar");
  assert.equal(res.payload.connect.calendarId, calendarId);
  assert.equal(res.payload.connect.preview.eligibleCount, 1);
  assert.ok(res.payload.connect.preview.digest);
  assert.deepEqual(await draftStatuses(), { draft: 1 });
  const cal = await db.query("SELECT status FROM content_calendars WHERE calendar_id = $1", [calendarId]);
  assert.equal(cal.rows[0].status, "draft", "the calendar must not activate without consent");
});

test("R26: a digest-bound confirmation drives the REAL activateCalendar boundary and reports truthfully", async () => {
  const session = await makeSession();
  const paused = await execute(session);
  const digest = paused.payload.connect.preview.digest;
  const fresh = await db.query("SELECT * FROM setup_sessions WHERE session_id = $1", [session.session_id]);
  const res = await execute(fresh.rows[0], { confirm: { step: "social_schedule", digest } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, "done");
  assert.match(res.payload.detail, /Scheduled 1 post\./);
  assert.deepEqual(await draftStatuses(), { scheduled: 1 });
  // Truthful outcome recorded for reload seeding.
  const after1 = await db.query("SELECT answers FROM setup_sessions WHERE session_id = $1", [session.session_id]);
  assert.equal(after1.rows[0].answers.step_outcomes.social_schedule, "completed");
});

test("a stale confirmation re-pauses with the FRESH preview and changed:true — never activates the wrong artifact", async () => {
  const session = await makeSession();
  const paused = await execute(session);
  const staleDigest = paused.payload.connect.preview.digest;
  // The calendar changes after review.
  await db.query(
    `INSERT INTO social_posts (brand_id, calendar_id, platform, post_content, scheduled_time, status)
     VALUES ($1, $2, 'facebook', 'late addition', NOW() + INTERVAL '3 hours', 'draft')`,
    [brandId, calendarId],
  );
  const fresh = await db.query("SELECT * FROM setup_sessions WHERE session_id = $1", [session.session_id]);
  const res = await execute(fresh.rows[0], { confirm: { step: "social_schedule", digest: staleDigest } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, "needs_connection");
  assert.equal(res.payload.connect.type, "activate_calendar");
  assert.equal(res.payload.connect.changed, true);
  assert.notEqual(res.payload.connect.preview.digest, staleDigest);
  assert.equal((await draftStatuses()).scheduled || 0, 0, "nothing activates on a stale digest");
  // Clean up the extra post for other tests.
  await db.query(
    "DELETE FROM social_posts WHERE calendar_id = $1 AND post_content = 'late addition'",
    [calendarId],
  );
});

test("R27: skip-at-gate marks the step skipped and activates nothing (AM-C1-2)", async () => {
  const session = await makeSession();
  const res = await execute(session, { skip: true });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, "skipped");
  assert.deepEqual(await draftStatuses(), { draft: 1 });
  const cal = await db.query("SELECT status FROM content_calendars WHERE calendar_id = $1", [calendarId]);
  assert.equal(cal.rows[0].status, "draft");
  const after1 = await db.query("SELECT answers FROM setup_sessions WHERE session_id = $1", [session.session_id]);
  assert.equal(after1.rows[0].answers.step_outcomes.social_schedule, "skipped");
});
