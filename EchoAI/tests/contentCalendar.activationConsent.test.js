// 026-C1 Stage 2 — the digest-bound activation consent boundary, end-to-end
// against the real test DB via the controller's own SQL (R26-grade: no mocked
// query strings; the exact transaction the app runs).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { db, createTestUser, deleteUser } = require("./helpers");
const contentCalendarController = require("../controllers/contentCalendarController");
const { computeActivationDigest } = require("../utils/calendarActivationDigest");
const { encrypt } = require("../utils/encryption");

let userId;
let otherUserId;
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

async function callActivate(uid, body) {
  const res = mockRes();
  await contentCalendarController.activateCalendar({ user: { userId: uid }, body }, res);
  return res;
}

async function callPreview(uid, body) {
  const res = mockRes();
  await contentCalendarController.previewActivation({ user: { userId: uid }, body }, res);
  return res;
}

async function insertDraftPost(offsetMs, platform = "facebook") {
  const { rows } = await db.query(
    `INSERT INTO social_posts (brand_id, calendar_id, platform, post_content, scheduled_time, status)
     VALUES ($1, $2, $3, 'stage2 test post', NOW() + ($4 || ' milliseconds')::interval, 'draft')
     RETURNING post_id`,
    [brandId, calendarId, platform, String(offsetMs)],
  );
  return rows[0].post_id;
}

before(async () => {
  userId = await createTestUser();
  otherUserId = await createTestUser();
  const b = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, 'Stage2 Consent Brand') RETURNING brand_id",
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
     VALUES ($1, 'facebook', 'Stage2 Page', $2, 'connected')`,
    [brandId, encrypt(JSON.stringify({ pageId: "page-777" }))],
  );
});

after(async () => {
  await deleteUser(userId);
  await deleteUser(otherUserId);
  await db.pool.end();
});

test("activation without a confirmDigest is refused with the preview (no zero-click path)", async () => {
  const futureId = await insertDraftPost(60 * 60 * 1000);
  const res = await callActivate(userId, { calendarId });
  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.confirmationRequired, true);
  assert.ok(res.payload.preview.digest, "the refusal carries the reviewable artifact + digest");
  assert.equal(res.payload.preview.eligibleCount, 1);
  const { rows } = await db.query("SELECT status FROM social_posts WHERE post_id = $1", [futureId]);
  assert.equal(rows[0].status, "draft", "nothing may flip without consent");
  const cal = await db.query("SELECT status FROM content_calendars WHERE calendar_id = $1", [calendarId]);
  assert.equal(cal.rows[0].status, "draft");
});

test("a stale digest is refused with a fresh preview; the matching digest activates ONLY the eligible set", async () => {
  // Current artifact: one future post (from the prior test) — preview it.
  const preview1 = await callPreview(userId, { calendarId });
  assert.equal(preview1.statusCode, 200);
  const staleDigest = preview1.payload.digest;

  // The calendar changes AFTER review: a new future post + a past post.
  const secondFutureId = await insertDraftPost(2 * 60 * 60 * 1000);
  const pastId = await insertDraftPost(-60 * 60 * 1000);

  const mismatch = await callActivate(userId, { calendarId, confirmDigest: staleDigest });
  assert.equal(mismatch.statusCode, 409);
  assert.equal(mismatch.payload.digestMismatch, true);
  assert.ok(mismatch.payload.preview.digest, "the refusal carries a FRESH preview");
  assert.notEqual(mismatch.payload.preview.digest, staleDigest);

  // Approve the fresh artifact: 2 future posts eligible, the past one stale.
  const res = await callActivate(userId, {
    calendarId,
    confirmDigest: mismatch.payload.preview.digest,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.activatedCount, 2);
  assert.equal(res.payload.excludedStaleCount, 1);
  assert.equal(res.payload.excludedStale[0].postId, String(pastId));
  const flipped = await db.query(
    "SELECT post_id, status FROM social_posts WHERE calendar_id = $1",
    [calendarId],
  );
  const byId = Object.fromEntries(flipped.rows.map((r) => [r.post_id, r.status]));
  assert.equal(byId[pastId], "draft", "a stale draft NEVER silently flips");
  assert.equal(byId[secondFutureId], "scheduled");
});

test("the consent echo lands in each activated post's spine task meta", async () => {
  const { rows } = await db.query(
    `SELECT t.meta FROM agent_tasks t
      WHERE t.meta->>'calendarId' = $1 AND t.meta->'consent' IS NOT NULL`,
    [String(calendarId)],
  );
  assert.ok(rows.length >= 1, "at least one activated post carries the consent echo");
  const consent = rows[0].meta.consent;
  assert.match(consent.digest, /^[0-9a-f]{64}$/);
  assert.equal(consent.activatedCount, 2);
  assert.equal(consent.excludedStaleCount, 1);
  assert.equal(consent.destination, "page-777");
});

test("drafts with no eligible post fail closed (nothingEligible), and empty calendars may re-activate", async () => {
  // Pause first so we can try again (pause flips scheduled back to draft).
  const pauseRes = mockRes();
  await contentCalendarController.pauseCalendar(
    { user: { userId }, body: { calendarId } },
    pauseRes,
  );
  assert.equal(pauseRes.statusCode, 200);
  // Unbind the destination: every draft becomes unbound.
  await db.query("UPDATE social_accounts SET connection_status = 'disconnected' WHERE brand_id = $1", [brandId]);
  const preview = await callPreview(userId, { calendarId });
  assert.equal(preview.payload.eligibleCount, 0);
  assert.ok(preview.payload.excludedUnboundCount >= 3);
  const res = await callActivate(userId, { calendarId, confirmDigest: preview.payload.digest });
  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.nothingEligible, true);
  const cal = await db.query("SELECT status FROM content_calendars WHERE calendar_id = $1", [calendarId]);
  assert.equal(cal.rows[0].status, "paused", "the calendar must NOT be marked active");

  // A calendar with no drafts at all (resume case) may activate with the
  // empty-set digest.
  await db.query("DELETE FROM social_posts WHERE calendar_id = $1", [calendarId]);
  const resume = await callActivate(userId, {
    calendarId,
    confirmDigest: computeActivationDigest([]),
  });
  assert.equal(resume.statusCode, 200);
  assert.equal(resume.payload.activatedCount, 0);
});

test("another user's calendar is a 404 for both preview and activate", async () => {
  const p = await callPreview(otherUserId, { calendarId });
  assert.equal(p.statusCode, 404);
  const a = await callActivate(otherUserId, { calendarId, confirmDigest: "x" });
  assert.equal(a.statusCode, 404);
});
