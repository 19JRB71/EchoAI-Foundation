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
// End-to-end DST correctness for "optimal" calendars generated & persisted for
// brands OUTSIDE the US. The America/New_York suite
// (contentCalendarDstCalendar.test.js) proves the whole-calendar read-back for a
// single UTC-behind northern-hemisphere zone. Customers can set ANY IANA zone on
// their brand (availability_schedules.timezone), which exercises classes the US
// suite never touches:
//
//   1. UTC-AHEAD zones where an early-morning local post maps to the *previous*
//      UTC calendar day (the stored UTC date differs from the local date).
//   2. SOUTHERN-HEMISPHERE DST, which switches in Oct/Apr (opposite season to the
//      US) and in the OPPOSITE direction within a given month.
//   3. HALF-HOUR offset zones (Australia/Adelaide UTC+10:30/+9:30, Asia/Kolkata
//      UTC+5:30) where a whole-hour rounding bug would surface.
//
// Getting these wrong would silently post hours off — or on the wrong day — for
// those customers. This suite persists real rows and reads them back, asserting
// each renders to the intended 08:00 / 12:00 / 18:00 local wall time across the
// boundary, and exercises the publisher's due predicate for a non-US zone.
//
// Australia DST 2026: fall-back Sun Apr 5 (AEDT UTC+11 -> AEST UTC+10),
// spring-forward Sun Oct 4 (AEST UTC+10 -> AEDT UTC+11). South Australia
// (Adelaide) switches the same days at UTC+10:30 <-> UTC+9:30. Asia/Kolkata is a
// fixed UTC+5:30 with no DST.
// ---------------------------------------------------------------------------

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

/** "YYYY-MM-DD" calendar date of a UTC instant, in UTC. */
function utcDateStr(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Generates the "optimal" facebook calendar (3 windows/day for 30 days) as if
 * "today" were `anchorIso`, faking the clock ONLY around the pure slot/time
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

/**
 * The zone's actual UTC offset (in hours, may be fractional) for a persisted
 * row, derived from the data: how far the intended local wall clock sits ahead
 * of the stored UTC instant. Proves the DST offset actually flips across a
 * boundary without hard-coding which side of it a date falls on.
 */
function offsetHoursFor(anchor, row) {
  const local = localDateForDay(anchor, row.day);
  const [h, m] = row.time.split(":").map(Number);
  const [y, mo, d] = local.split("-").map(Number);
  const localAsUtc = Date.UTC(y, mo - 1, d, h, m, 0);
  return (localAsUtc - row.scheduled.getTime()) / 3600000;
}

// Southern-hemisphere DST anchors whose 30-day span straddles the boundary.
// Sydney/Adelaide switch Apr 5 (fall-back) and Oct 4 (spring-forward) 2026.
const SYD_SPRING = { y: 2026, m: 9, d: 25 }; // day 10 == Oct 4 spring-forward
const SYD_FALL = { y: 2026, m: 3, d: 25 }; // day 12 == Apr 5 fall-back
const ADL_SPRING = { y: 2026, m: 9, d: 25 };
const KOL_ANCHOR = { y: 2026, m: 6, d: 1 }; // fixed +5:30, no DST

const SYDNEY = "Australia/Sydney";
const ADELAIDE = "Australia/Adelaide";
const KOLKATA = "Asia/Kolkata";

const state = {
  userId: null,
  brands: {}, // tz -> brandId
  cals: {}, // key -> { calendarId, slots, anchor, tz }
};
let restorePush = () => {};

async function makeBrand(userId, name, tz) {
  const b = await db.query(
    `INSERT INTO brands (user_id, brand_name, is_demo)
     VALUES ($1, $2, FALSE) RETURNING brand_id`,
    [userId, name]
  );
  const brandId = b.rows[0].brand_id;
  await db.query(
    `INSERT INTO availability_schedules (brand_id, timezone) VALUES ($1, $2)`,
    [brandId, tz]
  );
  return brandId;
}

async function persistCalendar(brandId, anchor, slots) {
  const cal = await db.query(
    `INSERT INTO content_calendars (brand_id, month, year, posting_frequency, status)
     VALUES ($1, $2, $3, 'optimal', 'active'::content_calendar_status)
     RETURNING calendar_id`,
    [brandId, anchor.m, anchor.y]
  );
  const calendarId = cal.rows[0].calendar_id;
  for (const s of slots) {
    await db.query(
      `INSERT INTO social_posts
         (brand_id, calendar_id, platform, post_content, scheduled_time, status)
       VALUES ($1, $2, 'facebook'::social_platform, 'Intl DST calendar post', $3,
               'scheduled'::social_post_status)`,
      [brandId, calendarId, s.scheduled.toISOString()]
    );
  }
  return calendarId;
}

before(async () => {
  const origPush = pushController.sendPushToUser;
  const origMobile = mobilePushController.sendToUser;
  pushController.sendPushToUser = async () => ({ sent: 0, failed: 0 });
  mobilePushController.sendToUser = async () => ({ sent: 0, failed: 0, skipped: true });
  restorePush = () => {
    pushController.sendPushToUser = origPush;
    mobilePushController.sendToUser = origMobile;
  };

  const email = `dst-intl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

  state.brands[SYDNEY] = await makeBrand(state.userId, "Sydney Co", SYDNEY);
  state.brands[ADELAIDE] = await makeBrand(state.userId, "Adelaide Co", ADELAIDE);
  state.brands[KOLKATA] = await makeBrand(state.userId, "Kolkata Co", KOLKATA);

  const defs = {
    sydSpring: { tz: SYDNEY, anchor: SYD_SPRING, iso: "2026-09-25T12:00:00Z" },
    sydFall: { tz: SYDNEY, anchor: SYD_FALL, iso: "2026-03-25T12:00:00Z" },
    adlSpring: { tz: ADELAIDE, anchor: ADL_SPRING, iso: "2026-09-25T12:00:00Z" },
    kolkata: { tz: KOLKATA, anchor: KOL_ANCHOR, iso: "2026-06-01T12:00:00Z" },
  };
  for (const [key, d] of Object.entries(defs)) {
    const slots = buildOptimalCalendar(d.iso, d.tz);
    const calendarId = await persistCalendar(state.brands[d.tz], d.anchor, slots);
    state.cals[key] = { calendarId, slots, anchor: d.anchor, tz: d.tz };
  }
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

/** Reads persisted posts for a calendar, joined back to their intended slot. */
async function loadPersisted(cal) {
  const r = await db.query(
    `SELECT scheduled_time FROM social_posts
     WHERE calendar_id = $1 ORDER BY scheduled_time ASC`,
    [cal.calendarId]
  );
  const sortedSlots = [...cal.slots].sort(
    (a, b) => a.scheduled.getTime() - b.scheduled.getTime()
  );
  assert.equal(r.rows.length, sortedSlots.length, "row count matches slot count");
  return r.rows.map((row, i) => ({
    scheduled: row.scheduled_time,
    day: sortedSlots[i].day,
    time: sortedSlots[i].time,
  }));
}

test("getBrandTimezone returns each brand's configured non-US IANA zone", async () => {
  assert.equal(await getBrandTimezone(state.brands[SYDNEY]), SYDNEY);
  assert.equal(await getBrandTimezone(state.brands[ADELAIDE]), ADELAIDE);
  assert.equal(await getBrandTimezone(state.brands[KOLKATA]), KOLKATA);
});

test("Kolkata (fixed UTC+5:30): every persisted instant renders to the intended local wall time", async () => {
  const cal = state.cals.kolkata;
  const rows = await loadPersisted(cal);
  for (const row of rows) {
    const expected = `${localDateForDay(cal.anchor, row.day)} ${row.time}`;
    assert.equal(
      wallTimeInZone(row.scheduled, KOLKATA),
      expected,
      `Kolkata post for ${expected} local must persist as that exact wall time`
    );
    // Half-hour offset must survive: no window lands on a whole-hour UTC minute.
    assert.equal(row.scheduled.getUTCMinutes(), 30, "UTC+5:30 keeps the :30 minute");
    // Every window (08/12/18) is still same UTC day for Kolkata (hour > 5.5).
    assert.equal(
      utcDateStr(row.scheduled),
      localDateForDay(cal.anchor, row.day),
      "Kolkata windows stay on the same UTC calendar day"
    );
  }
});

test("Australia/Sydney: an 08:00 local post rolls BACK to the previous UTC calendar day", async () => {
  const cal = state.cals.sydSpring;
  const rows = await loadPersisted(cal);
  const rolled = rows.filter((row) => {
    return utcDateStr(row.scheduled) < localDateForDay(cal.anchor, row.day);
  });
  // Sydney is UTC+10/+11, so every 08:00 slot maps to the prior UTC day.
  const morning = rows.filter((r) => r.time === "08:00");
  assert.ok(morning.length > 0, "calendar has 08:00 slots");
  assert.equal(
    rolled.length,
    morning.length,
    "each 08:00 Sydney slot stores on the previous UTC date"
  );
  // And it STILL renders back to 08:00 local despite the UTC date differing.
  for (const row of morning) {
    assert.equal(
      wallTimeInZone(row.scheduled, SYDNEY),
      `${localDateForDay(cal.anchor, row.day)} 08:00`,
      "08:00 Sydney survives the UTC day rollback"
    );
  }
});

test("Australia/Sydney spring-forward: whole calendar renders to intended local wall time across Oct 4", async () => {
  const cal = state.cals.sydSpring;
  const rows = await loadPersisted(cal);
  const dates = new Set();
  const offsets = new Set();
  for (const row of rows) {
    const expected = `${localDateForDay(cal.anchor, row.day)} ${row.time}`;
    assert.equal(
      wallTimeInZone(row.scheduled, SYDNEY),
      expected,
      `Sydney post for ${expected} local must persist as that exact wall time`
    );
    dates.add(localDateForDay(cal.anchor, row.day));
    offsets.add(offsetHoursFor(cal.anchor, row));
  }
  assert.ok(dates.has("2026-10-03"), "span includes a pre-spring-forward day");
  assert.ok(dates.has("2026-10-04"), "span includes the spring-forward day");
  // AEST (+10) before Oct 4, AEDT (+11) on/after — both must appear.
  assert.deepEqual([...offsets].sort((a, b) => a - b), [10, 11], "offset flips 10 -> 11");
});

test("Australia/Sydney fall-back: whole calendar renders to intended local wall time across Apr 5", async () => {
  const cal = state.cals.sydFall;
  const rows = await loadPersisted(cal);
  const dates = new Set();
  const offsets = new Set();
  for (const row of rows) {
    const expected = `${localDateForDay(cal.anchor, row.day)} ${row.time}`;
    assert.equal(
      wallTimeInZone(row.scheduled, SYDNEY),
      expected,
      `Sydney post for ${expected} local must persist as that exact wall time`
    );
    dates.add(localDateForDay(cal.anchor, row.day));
    offsets.add(offsetHoursFor(cal.anchor, row));
  }
  assert.ok(dates.has("2026-04-04"), "span includes a pre-fall-back day");
  assert.ok(dates.has("2026-04-05"), "span includes the fall-back day");
  // AEDT (+11) before Apr 5, AEST (+10) on/after — opposite direction to spring.
  assert.deepEqual([...offsets].sort((a, b) => a - b), [10, 11], "offset flips 11 -> 10");
});

test("Australia/Adelaide (half-hour offset) survives spring-forward across Oct 4", async () => {
  const cal = state.cals.adlSpring;
  const rows = await loadPersisted(cal);
  const offsets = new Set();
  for (const row of rows) {
    const expected = `${localDateForDay(cal.anchor, row.day)} ${row.time}`;
    assert.equal(
      wallTimeInZone(row.scheduled, ADELAIDE),
      expected,
      `Adelaide post for ${expected} local must persist as that exact wall time`
    );
    // Half-hour offset must be preserved on both sides of the boundary.
    assert.equal(row.scheduled.getUTCMinutes(), 30, "UTC+9:30/+10:30 keeps the :30 minute");
    offsets.add(offsetHoursFor(cal.anchor, row));
  }
  // ACST (+9:30) before Oct 4, ACDT (+10:30) on/after.
  assert.deepEqual([...offsets].sort((a, b) => a - b), [9.5, 10.5], "offset flips 9.5 -> 10.5");
});

// ---------------------------------------------------------------------------
// Publisher due predicate (scheduled_time <= NOW()) for a non-US zone.
// ---------------------------------------------------------------------------

test("due predicate (scheduled_time <= cutoff) selects exactly the at/before posts for a Sydney calendar", async () => {
  const cal = state.cals.sydSpring;
  const sorted = [...cal.slots].sort(
    (a, b) => a.scheduled.getTime() - b.scheduled.getTime()
  );
  const cutoff = sorted[Math.floor(sorted.length / 2)].scheduled;
  const expectedDue = sorted.filter(
    (s) => s.scheduled.getTime() <= cutoff.getTime()
  ).length;

  const due = await db.query(
    `SELECT COUNT(*)::int AS n FROM social_posts
     WHERE calendar_id = $1 AND status = 'scheduled' AND scheduled_time <= $2`,
    [cal.calendarId, cutoff.toISOString()]
  );
  assert.equal(due.rows[0].n, expectedDue, "cutoff selects exactly the at/before set");

  const before = new Date(sorted[0].scheduled.getTime() - 1000).toISOString();
  const after = new Date(
    sorted[sorted.length - 1].scheduled.getTime() + 1000
  ).toISOString();
  const none = await db.query(
    `SELECT COUNT(*)::int AS n FROM social_posts
     WHERE calendar_id = $1 AND scheduled_time <= $2`,
    [cal.calendarId, before]
  );
  const all = await db.query(
    `SELECT COUNT(*)::int AS n FROM social_posts
     WHERE calendar_id = $1 AND scheduled_time <= $2`,
    [cal.calendarId, after]
  );
  assert.equal(none.rows[0].n, 0, "nothing due before the first Sydney post");
  assert.equal(all.rows[0].n, cal.slots.length, "everything due after the last Sydney post");
});

test("due predicate discriminates consecutive 08:00 Sydney posts straddling spring-forward", async () => {
  // Oct 3 08:00 stores at AEST (+10) => prev UTC day 22:00Z; Oct 4 08:00 stores
  // at AEDT (+11) => prev UTC day 21:00Z. The local day GAINED an hour of offset,
  // so the two instants are only 23h apart — a cutoff between them must include
  // Oct 3 and exclude Oct 4, proving the `<=` ordering tracks the DST-adjusted
  // instants across a UTC-day rollback (a fixed-offset guess would mis-order).
  const cal = state.cals.sydSpring;
  const oct3 = cal.slots.find(
    (s) => s.time === "08:00" && localDateForDay(cal.anchor, s.day) === "2026-10-03"
  );
  const oct4 = cal.slots.find(
    (s) => s.time === "08:00" && localDateForDay(cal.anchor, s.day) === "2026-10-04"
  );
  assert.ok(oct3 && oct4, "both boundary posts exist");
  assert.equal(oct3.scheduled.getUTCHours(), 22);
  assert.equal(oct4.scheduled.getUTCHours(), 21);
  assert.equal((oct4.scheduled - oct3.scheduled) / 3600000, 23, "spring-forward day is 23h later");

  const cutoff = new Date(oct3.scheduled.getTime() + 60000).toISOString();
  const included = await db.query(
    `SELECT scheduled_time FROM social_posts
     WHERE calendar_id = $1 AND scheduled_time <= $2 AND scheduled_time >= $3`,
    [cal.calendarId, cutoff, oct3.scheduled.toISOString()]
  );
  assert.equal(included.rows.length, 1, "only the Oct 3 08:00 post is <= the cutoff");
  assert.equal(included.rows[0].scheduled_time.getTime(), oct3.scheduled.getTime());
});

test("the real publisher (scheduled_time <= NOW()) never fires a not-yet-due Sydney DST post", async () => {
  // Run the ACTUAL publisher against a Sydney-scheduled post several years in the
  // FUTURE (relative to real "now"), so this stays valid no matter today's date,
  // and confirm it leaves the post scheduled — proving the due predicate is
  // correct end-to-end for a UTC-ahead, southern-hemisphere DST zone.
  const futureYear = new Date().getUTCFullYear() + 3;
  const futureInstant = zonedWallTimeToUtc(futureYear, 1, 15, 8, 0, SYDNEY); // summer AEDT
  const cal = await db.query(
    `INSERT INTO content_calendars (brand_id, month, year, posting_frequency, status)
     VALUES ($1, 1, $2, 'optimal', 'active'::content_calendar_status)
     RETURNING calendar_id`,
    [state.brands[SYDNEY], futureYear]
  );
  const post = await db.query(
    `INSERT INTO social_posts
       (brand_id, calendar_id, platform, post_content, scheduled_time, status)
     VALUES ($1, $2, 'facebook'::social_platform, 'future Sydney DST post', $3,
             'scheduled'::social_post_status)
     RETURNING post_id`,
    [state.brands[SYDNEY], cal.rows[0].calendar_id, futureInstant.toISOString()]
  );
  const postId = post.rows[0].post_id;

  const summary = await publishDuePosts();
  assert.equal(typeof summary.due, "number");

  const after = await db.query(
    `SELECT status FROM social_posts WHERE post_id = $1`,
    [postId]
  );
  assert.equal(after.rows[0].status, "scheduled", "future Sydney DST post left scheduled");
});
