const { test, before, after, mock } = require("node:test");
const assert = require("node:assert");

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";

const db = require("../config/db");
const pushController = require("../controllers/pushController");
const mobilePushController = require("../controllers/mobilePushController");
const {
  computeSlots,
  scheduledTimeFor,
  getBrandTimezone,
} = require("../controllers/contentCalendarController");
const { publishDuePosts } = require("../controllers/socialController");
const { zonedWallTimeToUtc } = require("../utils/timezone");

// ---------------------------------------------------------------------------
// End-to-end DST correctness for a *generated & persisted* "optimal" calendar.
//
// The "optimal" schedule posts at 08:00 / 12:00 / 18:00 in the business owner's
// timezone, converted to an absolute UTC instant that the publisher compares
// against NOW() (socialController.publishDuePosts: `scheduled_time <= NOW()`).
// The unit suites cover the slot logic and single conversions; this suite proves
// that a WHOLE generated calendar whose 30-day span crosses a DST boundary keeps
// every persisted `scheduled_time` on the intended local wall clock — so no post
// silently goes out an hour early/late for the weeks around a spring-forward or
// fall-back.
//
// US DST 2026: spring-forward Sun Mar 8 (EST→EDT), fall-back Sun Nov 1 (EDT→EST).
// Real "now" is mid-2026, so the March calendar is entirely in the past (its
// posts are due) and the November calendar is entirely in the future (not due).
// ---------------------------------------------------------------------------

const ZONE = "America/New_York";

/** Renders a UTC Date as "YYYY-MM-DD HH:MM" wall-clock in the given timezone. */
function wallTimeInZone(date, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}`;
}

/**
 * Generates the "optimal" facebook calendar (3 windows/day for 30 days) as if
 * "today" were `anchorIso`, by faking the clock ONLY around the pure slot/time
 * computation. Returns [{ day, time, scheduled(Date) }].
 */
function buildOptimalCalendar(anchorIso, timezone) {
  mock.timers.enable({ apis: ["Date"], now: Date.parse(anchorIso) });
  try {
    return computeSlots("optimal", ["facebook"]).map((s) => ({
      day: s.day,
      time: s.time,
      scheduled: scheduledTimeFor(s.day, s.time, timezone),
    }));
  } finally {
    mock.timers.reset();
  }
}

/**
 * The intended local wall date for a slot: the UTC calendar date of the anchor
 * (server TZ is UTC in CI) plus (day - 1). scheduledTimeFor anchors day 1 to the
 * server-local date of "today", so this mirrors it deterministically.
 */
function localDateForDay(anchor, day) {
  const dt = new Date(Date.UTC(anchor.y, anchor.m - 1, anchor.d));
  dt.setUTCDate(dt.getUTCDate() + (day - 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

const SPRING_ANCHOR = { y: 2026, m: 3, d: 1 }; // day 8 == Mar 8 spring-forward
const FALL_ANCHOR = { y: 2026, m: 10, d: 20 }; // day 13 == Nov 1 fall-back

const state = {
  userId: null,
  brandId: null,
  springCalId: null,
  fallCalId: null,
  spring: [], // [{ day, time, scheduled }]
  fall: [],
};
let restorePush = () => {};

before(async () => {
  const origPush = pushController.sendPushToUser;
  const origMobile = mobilePushController.sendToUser;
  pushController.sendPushToUser = async () => ({ sent: 0, failed: 0 });
  mobilePushController.sendToUser = async () => ({ sent: 0, failed: 0, skipped: true });
  restorePush = () => {
    pushController.sendPushToUser = origPush;
    mobilePushController.sendToUser = origMobile;
  };

  const email = `dst-cal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const u = await db.query(
    `INSERT INTO users (email, password_hash, role, subscription_tier)
     VALUES ($1, 'not-a-real-hash', 'user'::user_role, 'pro'::subscription_tier)
     RETURNING user_id`,
    [email]
  );
  state.userId = u.rows[0].user_id;
  await db.query(
    `INSERT INTO subscriptions (user_id, subscription_tier, payment_status, is_locked)
     VALUES ($1, 'pro'::subscription_tier, 'active', FALSE)`,
    [state.userId]
  );
  const b = await db.query(
    `INSERT INTO brands (user_id, brand_name, is_demo)
     VALUES ($1, 'DST Calendar Co', FALSE) RETURNING brand_id`,
    [state.userId]
  );
  state.brandId = b.rows[0].brand_id;

  // The brand's timezone lives on availability_schedules; getBrandTimezone reads
  // it and drives every post's wall-clock -> UTC conversion.
  await db.query(
    `INSERT INTO availability_schedules (brand_id, timezone) VALUES ($1, $2)`,
    [state.brandId, ZONE]
  );

  state.spring = buildOptimalCalendar("2026-03-01T12:00:00Z", ZONE);
  state.fall = buildOptimalCalendar("2026-10-20T12:00:00Z", ZONE);

  async function persistCalendar(anchor, slots) {
    const cal = await db.query(
      `INSERT INTO content_calendars (brand_id, month, year, posting_frequency, status)
       VALUES ($1, $2, $3, 'optimal', 'active'::content_calendar_status)
       RETURNING calendar_id`,
      [state.brandId, anchor.m, anchor.y]
    );
    const calendarId = cal.rows[0].calendar_id;
    for (const s of slots) {
      await db.query(
        `INSERT INTO social_posts
           (brand_id, calendar_id, platform, post_content, scheduled_time, status)
         VALUES ($1, $2, 'facebook'::social_platform, 'DST calendar post', $3,
                 'scheduled'::social_post_status)`,
        [state.brandId, calendarId, s.scheduled.toISOString()]
      );
    }
    return calendarId;
  }

  state.springCalId = await persistCalendar(SPRING_ANCHOR, state.spring);
  state.fallCalId = await persistCalendar(FALL_ANCHOR, state.fall);
});

after(async () => {
  try {
    if (state.userId) {
      await db.query(`DELETE FROM users WHERE user_id = $1`, [state.userId]);
    }
  } finally {
    restorePush();
  }
});

test("getBrandTimezone returns the brand's configured IANA zone", async () => {
  assert.equal(await getBrandTimezone(state.brandId), ZONE);
});

/** Reads persisted posts for a calendar, joined back to their intended slot. */
async function loadPersisted(calendarId, slots) {
  const r = await db.query(
    `SELECT scheduled_time FROM social_posts
     WHERE calendar_id = $1 ORDER BY scheduled_time ASC`,
    [calendarId]
  );
  // Both are ordered chronologically, so they line up 1:1 with the sorted slots.
  const sortedSlots = [...slots].sort(
    (a, b) => a.scheduled.getTime() - b.scheduled.getTime()
  );
  assert.equal(r.rows.length, sortedSlots.length, "row count matches slot count");
  return r.rows.map((row, i) => ({
    scheduled: row.scheduled_time,
    day: sortedSlots[i].day,
    time: sortedSlots[i].time,
  }));
}

test("spring-forward calendar: every persisted instant renders to the intended local wall time", async () => {
  const rows = await loadPersisted(state.springCalId, state.spring);

  const dates = new Set();
  for (const row of rows) {
    const expected = `${localDateForDay(SPRING_ANCHOR, row.day)} ${row.time}`;
    assert.equal(
      wallTimeInZone(row.scheduled, ZONE),
      expected,
      `post for ${expected} local must persist as that exact wall time`
    );
    dates.add(localDateForDay(SPRING_ANCHOR, row.day));
  }
  // The 30-day span really does straddle the Mar 8 spring-forward boundary.
  assert.ok(dates.has("2026-03-07"), "calendar includes a pre-DST day");
  assert.ok(dates.has("2026-03-08"), "calendar includes the spring-forward day");
});

// Expected UTC hour per window: [before boundary, on/after boundary].
// Spring: EST (UTC-5) -> EDT (UTC-4), so every window loses an hour of UTC offset.
const SPRING_SHIFT = { "08:00": [13, 12], "12:00": [17, 16], "18:00": [23, 22] };
// Fall: EDT (UTC-4) -> EST (UTC-5), so every window gains an hour of UTC offset.
const FALL_SHIFT = { "08:00": [12, 13], "12:00": [16, 17], "18:00": [22, 23] };

test("spring-forward: all three windows shift EST -> EDT across Mar 8", async () => {
  const rows = await loadPersisted(state.springCalId, state.spring);
  for (const row of rows) {
    const date = localDateForDay(SPRING_ANCHOR, row.day);
    const [est, edt] = SPRING_SHIFT[row.time];
    const expected = date <= "2026-03-07" ? est : edt;
    assert.equal(
      row.scheduled.getUTCHours(),
      expected,
      `${row.time} local on ${date} -> ${expected}:00Z`
    );
  }
});

test("fall-back calendar: every persisted instant renders to the intended local wall time", async () => {
  const rows = await loadPersisted(state.fallCalId, state.fall);

  const dates = new Set();
  for (const row of rows) {
    const expected = `${localDateForDay(FALL_ANCHOR, row.day)} ${row.time}`;
    assert.equal(
      wallTimeInZone(row.scheduled, ZONE),
      expected,
      `post for ${expected} local must persist as that exact wall time`
    );
    dates.add(localDateForDay(FALL_ANCHOR, row.day));
  }
  assert.ok(dates.has("2026-10-31"), "calendar includes a pre-fall-back day");
  assert.ok(dates.has("2026-11-01"), "calendar includes the fall-back day");
});

test("fall-back: all three windows shift EDT -> EST across Nov 1", async () => {
  const rows = await loadPersisted(state.fallCalId, state.fall);
  for (const row of rows) {
    const date = localDateForDay(FALL_ANCHOR, row.day);
    const [edt, est] = FALL_SHIFT[row.time];
    const expected = date <= "2026-10-31" ? edt : est;
    assert.equal(
      row.scheduled.getUTCHours(),
      expected,
      `${row.time} local on ${date} -> ${expected}:00Z`
    );
  }
});

// ---------------------------------------------------------------------------
// The publisher's due predicate (`scheduled_time <= NOW()`) around the boundary.
// ---------------------------------------------------------------------------

test("due predicate (scheduled_time <= cutoff) selects exactly the posts at/before the cutoff", async () => {
  // Mirrors the publisher's `scheduled_time <= NOW()` selection, but with an
  // EXPLICIT cutoff instead of NOW() so the assertion is deterministic no matter
  // the real calendar date. The cutoff sits just after the spring-forward
  // boundary, so the expected count spans the DST transition.
  const sorted = [...state.spring].sort(
    (a, b) => a.scheduled.getTime() - b.scheduled.getTime()
  );
  const cutoff = sorted[Math.floor(sorted.length / 2)].scheduled;
  const expectedDue = sorted.filter(
    (s) => s.scheduled.getTime() <= cutoff.getTime()
  ).length;

  // NOTE: deliberately no `status = 'scheduled'` filter. Test files run in
  // parallel against one shared DB, and another suite's publisher sweep can
  // claim these (past-dated) posts and flip their status mid-run, which made
  // this count nondeterministic (observed 39/42 vs 46). The predicate under
  // test is the TIME comparison; scheduled_time is never mutated.
  const due = await db.query(
    `SELECT COUNT(*)::int AS n FROM social_posts
     WHERE calendar_id = $1 AND scheduled_time <= $2`,
    [state.springCalId, cutoff.toISOString()]
  );
  assert.equal(due.rows[0].n, expectedDue, "cutoff selects exactly the at/before set");

  // A cutoff before the whole calendar selects nothing; after it, everything.
  const before = new Date(sorted[0].scheduled.getTime() - 1000).toISOString();
  const after = new Date(
    sorted[sorted.length - 1].scheduled.getTime() + 1000
  ).toISOString();
  const none = await db.query(
    `SELECT COUNT(*)::int AS n FROM social_posts
     WHERE calendar_id = $1 AND scheduled_time <= $2`,
    [state.springCalId, before]
  );
  const all = await db.query(
    `SELECT COUNT(*)::int AS n FROM social_posts
     WHERE calendar_id = $1 AND scheduled_time <= $2`,
    [state.springCalId, after]
  );
  assert.equal(none.rows[0].n, 0, "nothing due before the first post");
  assert.equal(all.rows[0].n, state.spring.length, "everything due after the last post");
});

test("due predicate discriminates consecutive 08:00 posts straddling spring-forward", async () => {
  // Mar 7 08:00 stores as 13:00Z (EST); Mar 8 08:00 stores as 12:00Z (EDT) — the
  // local day lost an hour. A cutoff between them must include Mar 7 and exclude
  // Mar 8, proving the `<=` selection tracks the DST-adjusted instants (a naive
  // fixed-offset guess would have mis-ordered them).
  const mar7 = state.spring.find(
    (s) => s.time === "08:00" && localDateForDay(SPRING_ANCHOR, s.day) === "2026-03-07"
  );
  const mar8 = state.spring.find(
    (s) => s.time === "08:00" && localDateForDay(SPRING_ANCHOR, s.day) === "2026-03-08"
  );
  assert.ok(mar7 && mar8, "both boundary posts exist");
  assert.equal(mar7.scheduled.getUTCHours(), 13);
  assert.equal(mar8.scheduled.getUTCHours(), 12);
  // 08:00 on the day after spring-forward is only 23h later, not 24h.
  assert.equal((mar8.scheduled - mar7.scheduled) / 3600000, 23);

  const cutoff = new Date(mar7.scheduled.getTime() + 60000).toISOString(); // 1 min past Mar 7 08:00
  const included = await db.query(
    `SELECT scheduled_time FROM social_posts
     WHERE calendar_id = $1 AND scheduled_time <= $2 AND scheduled_time >= $3`,
    [state.springCalId, cutoff, mar7.scheduled.toISOString()]
  );
  assert.equal(included.rows.length, 1, "only the Mar 7 08:00 post is <= the cutoff");
  assert.equal(included.rows[0].scheduled_time.getTime(), mar7.scheduled.getTime());
});

test("the real publisher (scheduled_time <= NOW()) never fires a not-yet-due DST post", async () => {
  // Seed a dedicated, DST-scheduled post several years in the FUTURE relative to
  // real "now" so this stays valid no matter the current date, then run the
  // actual publisher and confirm it leaves the post scheduled (not fired early).
  const futureYear = new Date().getUTCFullYear() + 3;
  const futureInstant = zonedWallTimeToUtc(futureYear, 7, 15, 8, 0, ZONE); // summer EDT
  const cal = await db.query(
    `INSERT INTO content_calendars (brand_id, month, year, posting_frequency, status)
     VALUES ($1, 7, $2, 'optimal', 'active'::content_calendar_status)
     RETURNING calendar_id`,
    [state.brandId, futureYear]
  );
  const post = await db.query(
    `INSERT INTO social_posts
       (brand_id, calendar_id, platform, post_content, scheduled_time, status)
     VALUES ($1, $2, 'facebook'::social_platform, 'future DST post', $3,
             'scheduled'::social_post_status)
     RETURNING post_id`,
    [state.brandId, cal.rows[0].calendar_id, futureInstant.toISOString()]
  );
  const postId = post.rows[0].post_id;

  const summary = await publishDuePosts();
  assert.equal(typeof summary.due, "number");

  const after = await db.query(
    `SELECT status FROM social_posts WHERE post_id = $1`,
    [postId]
  );
  assert.equal(after.rows[0].status, "scheduled", "future DST post left scheduled");
});
