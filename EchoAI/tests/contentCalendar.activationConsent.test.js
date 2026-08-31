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

async function callUpdate(uid, postId, body) {
  const res = mockRes();
  await contentCalendarController.updatePost(
    { user: { userId: uid }, params: { postId }, body },
    res,
  );
  return res;
}

async function insertDraftPost(offsetMs, platform = "facebook", content = "stage2 test post") {
  const { rows } = await db.query(
    `INSERT INTO social_posts (brand_id, calendar_id, platform, post_content, scheduled_time, status)
     VALUES ($1, $2, $3, $5, NOW() + ($4 || ' milliseconds')::interval, 'draft')
     RETURNING post_id`,
    [brandId, calendarId, platform, String(offsetMs), content],
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

test("v1 eligible-only digest and exclusion-only artifact changes are clean 409 mismatches", async () => {
  await db.query(
    "UPDATE social_posts SET status = 'draft' WHERE calendar_id = $1 AND status = 'scheduled'",
    [calendarId],
  );
  const preview = await callPreview(userId, { calendarId });
  const v1 = require("crypto")
    .createHash("sha256")
    .update(
      preview.payload.eligible
        .map((e) => `${e.postId}|${e.scheduledTime}|${e.platform}|${e.destination || ""}`)
        .sort()
        .join("\n"),
      "utf8",
    )
    .digest("hex");
  const oldVersion = await callActivate(userId, { calendarId, confirmDigest: v1 });
  assert.equal(oldVersion.statusCode, 409);
  assert.equal(oldVersion.payload.digestMismatch, true);

  await insertDraftPost(-2 * 60 * 60 * 1000, "facebook", "excluded-only addition");
  const exclusionChanged = await callActivate(userId, {
    calendarId,
    confirmDigest: preview.payload.digest,
  });
  assert.equal(exclusionChanged.statusCode, 409);
  assert.equal(exclusionChanged.payload.digestMismatch, true);
  assert.notEqual(exclusionChanged.payload.preview.digest, preview.payload.digest);
});

test("eligible content, media, and calendar identity are digest-bound", async () => {
  const preview = await callPreview(userId, { calendarId });
  const eligibleId = preview.payload.eligible[0].postId;
  await db.query(
    "UPDATE social_posts SET post_content = post_content || ' edited', image_url = 'https://example.test/new.png' WHERE post_id = $1",
    [eligibleId],
  );
  const changed = await callActivate(userId, { calendarId, confirmDigest: preview.payload.digest });
  assert.equal(changed.statusCode, 409);
  assert.equal(changed.payload.digestMismatch, true);
  assert.notEqual(changed.payload.preview.digest, preview.payload.digest);

  const other = await db.query(
    `INSERT INTO content_calendars (brand_id, month, year, posting_frequency, status)
     VALUES ($1, 9, 2026, 'daily', 'draft') RETURNING calendar_id`,
    [brandId],
  );
  const otherCalendarId = other.rows[0].calendar_id;
  await db.query(
    `INSERT INTO social_posts
       (brand_id, calendar_id, platform, post_content, image_url, scheduled_time, status)
     SELECT brand_id, $2, platform, post_content, image_url, scheduled_time, 'draft'
       FROM social_posts WHERE post_id = $1`,
    [eligibleId, otherCalendarId],
  );
  const otherPreview = await callPreview(userId, { calendarId: otherCalendarId });
  assert.notEqual(otherPreview.payload.digest, changed.payload.preview.digest);
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
  // 026-C1-PM1 (Condition 1): the echo is complete, durable, readable audit
  // evidence of the activation that ACTUALLY occurred.
  assert.equal(consent.approver, `owner:${userId}`);
  assert.ok(consent.confirmedAt, "confirmedAt must be persisted");
  assert.ok(!Number.isNaN(Date.parse(consent.confirmedAt)), "confirmedAt must be a real timestamp");
  assert.equal(typeof consent.excludedUnboundCount, "number");
  // The destination summary covers ONLY platforms with an activated post —
  // it never implies an excluded/unbound destination was activated. This
  // calendar activated facebook posts only.
  assert.deepEqual(consent.destinationSummary, { facebook: "page-777" });
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
    confirmDigest: computeActivationDigest({
      calendarId,
      eligible: [],
      excludedStale: [],
      excludedUnbound: [],
    }),
  });
  assert.equal(resume.statusCode, 200);
  assert.equal(resume.payload.activatedCount, 0);
});

test("draft-precondition edit fails after activation while legacy edits preserve behavior", async () => {
  await db.query("UPDATE social_accounts SET connection_status = 'connected' WHERE brand_id = $1", [brandId]);
  const postId = await insertDraftPost(3 * 60 * 60 * 1000, "facebook", "original");
  const preview = await callPreview(userId, { calendarId });
  const activated = await callActivate(userId, { calendarId, confirmDigest: preview.payload.digest });
  assert.equal(activated.statusCode, 200);

  const guarded = mockRes();
  await contentCalendarController.updatePost(
    {
      user: { userId },
      params: { postId },
      body: { postContent: "must not land", expectedStatus: "draft" },
    },
    guarded,
  );
  assert.equal(guarded.statusCode, 409);
  const unchanged = await db.query("SELECT post_content, status FROM social_posts WHERE post_id = $1", [postId]);
  assert.equal(unchanged.rows[0].post_content, "original");
  assert.equal(unchanged.rows[0].status, "scheduled");

  const legacy = mockRes();
  await contentCalendarController.updatePost(
    { user: { userId }, params: { postId }, body: { postContent: "legacy edit" } },
    legacy,
  );
  assert.equal(legacy.statusCode, 200);
  assert.equal(legacy.payload.post.post_content, "legacy edit");
});

test("another user's calendar is a 404 for both preview and activate", async () => {
  const p = await callPreview(otherUserId, { calendarId });
  assert.equal(p.statusCode, 404);
  const a = await callActivate(otherUserId, { calendarId, confirmDigest: "x" });
  assert.equal(a.statusCode, 404);
});

test("updatePost rejects empty content", async () => {
  const postId = await insertDraftPost(4 * 60 * 60 * 1000, "facebook", "keep me");
  const res = await callUpdate(userId, postId, {
    postContent: "   ",
    expectedStatus: "draft",
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error, "postContent is required");
  const saved = await db.query("SELECT post_content FROM social_posts WHERE post_id = $1", [postId]);
  assert.equal(saved.rows[0].post_content, "keep me");
});

test("updatePost denies a cross-tenant postId with 404", async () => {
  const postId = await insertDraftPost(5 * 60 * 60 * 1000, "facebook", "owner only");
  const res = await callUpdate(otherUserId, postId, {
    postContent: "foreign edit",
    expectedStatus: "draft",
  });
  assert.equal(res.statusCode, 404);
  const saved = await db.query("SELECT post_content FROM social_posts WHERE post_id = $1", [postId]);
  assert.equal(saved.rows[0].post_content, "owner only");
});

test("updatePost preserves image_url and video_url byte-for-byte", async () => {
  const postId = await insertDraftPost(6 * 60 * 60 * 1000, "facebook", "before media save");
  const imageUrl = "/uploads/images/ABC_def-123.png?signature=%2B%2F%3D";
  const videoUrl = "https://cdn.example.test/Videos/Clip.MP4?token=Aa%2F9%3D";
  await db.query(
    "UPDATE social_posts SET image_url = $1, video_url = $2 WHERE post_id = $3",
    [imageUrl, videoUrl, postId],
  );

  const res = await callUpdate(userId, postId, {
    postContent: "after media save",
    expectedStatus: "draft",
  });
  assert.equal(res.statusCode, 200);
  const saved = await db.query(
    "SELECT post_content, image_url, video_url FROM social_posts WHERE post_id = $1",
    [postId],
  );
  assert.equal(saved.rows[0].post_content, "after media save");
  assert.equal(saved.rows[0].image_url, imageUrl);
  assert.equal(saved.rows[0].video_url, videoUrl);
});

test("updatePost changes exactly one row and leaves a sibling draft byte-identical", async () => {
  const postId = await insertDraftPost(7 * 60 * 60 * 1000, "facebook", "target before");
  const siblingId = await insertDraftPost(8 * 60 * 60 * 1000, "facebook", "sibling before");
  const ids = [postId, siblingId];
  const beforeRows = await db.query(
    `SELECT post_id, xmin::text AS row_version, to_jsonb(social_posts) AS row
       FROM social_posts
      WHERE post_id = ANY($1::uuid[])
      ORDER BY post_id`,
    [ids],
  );

  const res = await callUpdate(userId, postId, {
    postContent: "target after",
    expectedStatus: "draft",
  });
  assert.equal(res.statusCode, 200);

  const afterRows = await db.query(
    `SELECT post_id, xmin::text AS row_version, to_jsonb(social_posts) AS row
       FROM social_posts
      WHERE post_id = ANY($1::uuid[])
      ORDER BY post_id`,
    [ids],
  );
  const beforeById = Object.fromEntries(beforeRows.rows.map((row) => [row.post_id, row]));
  const afterById = Object.fromEntries(afterRows.rows.map((row) => [row.post_id, row]));
  const changedIds = ids.filter(
    (id) => JSON.stringify(beforeById[id]) !== JSON.stringify(afterById[id]),
  );
  assert.deepEqual(changedIds, [postId]);
  assert.deepEqual(afterById[siblingId], beforeById[siblingId]);
  assert.notEqual(afterById[postId].row_version, beforeById[postId].row_version);
  assert.equal(afterById[postId].row.post_content, "target after");
});

test("updatePost creates no task, external-action, proof, or provider-connection rows", async () => {
  const postId = await insertDraftPost(9 * 60 * 60 * 1000, "facebook", "side-effect before");
  const counts = async () => {
    const { rows } = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM agent_tasks
           WHERE brand_id = $1 OR user_id = $2) AS task_count,
         (SELECT COUNT(*)::int FROM external_actions
           WHERE brand_id = $1 OR user_id = $2) AS external_action_count,
         (SELECT COUNT(*)::int FROM external_proofs
           WHERE brand_id = $1 OR user_id = $2) AS provider_proof_count,
         (SELECT COUNT(*)::int FROM api_integrations
           WHERE user_id = $2) AS api_integration_count,
         (SELECT COUNT(*)::int FROM social_accounts
           WHERE brand_id = $1) AS social_account_count`,
      [brandId, userId],
    );
    return rows[0];
  };
  const beforeCounts = await counts();
  const res = await callUpdate(userId, postId, {
    postContent: "side-effect after",
    expectedStatus: "draft",
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(await counts(), beforeCounts);
});
