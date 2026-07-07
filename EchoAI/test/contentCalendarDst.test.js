const { test, before, after } = require("node:test");
const assert = require("node:assert");

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef";

const { zonedWallTimeToUtc } = require("../utils/timezone");
const { computeSlots, scheduledTimeFor } = require("../controllers/contentCalendarController");

// ---------------------------------------------------------------------------
// Daylight-Saving-Time end-to-end scheduling & publishing.
//
// The auto-poster publishes a post when its stored UTC `scheduled_time` is
// `<= NOW()` (see socialController.publishDuePosts). So the ONLY thing that
// keeps posts going out at the intended *local* wall-clock time across a DST
// change is that we store the correct UTC instant for that wall time. These
// tests pin US DST 2026: spring-forward Sun Mar 8 (EST→EDT), fall-back Sun
// Nov 1 (EDT→EST).
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

test("08:00 local maps to 13:00Z in EST (winter) and 12:00Z in EDT (summer)", () => {
  const est = zonedWallTimeToUtc(2026, 3, 7, 8, 0, ZONE); // day before spring-forward
  const edt = zonedWallTimeToUtc(2026, 7, 15, 8, 0, ZONE); // mid-summer
  assert.equal(est.getUTCHours(), 13, "EST 08:00 -> 13:00Z");
  assert.equal(edt.getUTCHours(), 12, "EDT 08:00 -> 12:00Z");
});

test("spring-forward day: 08:00 is already EDT (12:00Z), one hour off the prior day", () => {
  const before = zonedWallTimeToUtc(2026, 3, 7, 8, 0, ZONE); // EST -> 13:00Z
  const onDst = zonedWallTimeToUtc(2026, 3, 8, 8, 0, ZONE); // EDT -> 12:00Z
  assert.equal(before.getUTCHours(), 13);
  assert.equal(onDst.getUTCHours(), 12);
  // A daily 08:00 post the day after spring-forward is only 23h later in UTC,
  // because the local day lost an hour — proof scheduling tracks wall time.
  assert.equal((onDst - before) / 3600000, 23);
});

test("fall-back day: 08:00 is back on EST (13:00Z), 25h after the prior day's post", () => {
  const before = zonedWallTimeToUtc(2026, 10, 31, 8, 0, ZONE); // EDT -> 12:00Z
  const onDst = zonedWallTimeToUtc(2026, 11, 1, 8, 0, ZONE); // EST -> 13:00Z
  assert.equal(before.getUTCHours(), 12);
  assert.equal(onDst.getUTCHours(), 13);
  // The local day gained an hour, so consecutive 08:00 posts are 25h apart.
  assert.equal((onDst - before) / 3600000, 25);
});

test("stored UTC instants render back to the intended local wall time across DST", () => {
  const cases = [
    { y: 2026, m: 3, d: 7, hh: 8, mm: 0 }, // EST
    { y: 2026, m: 3, d: 8, hh: 8, mm: 0 }, // spring-forward, EDT
    { y: 2026, m: 3, d: 8, hh: 18, mm: 0 }, // evening window on DST day
    { y: 2026, m: 10, d: 31, hh: 12, mm: 0 }, // EDT
    { y: 2026, m: 11, d: 1, hh: 8, mm: 0 }, // fall-back, EST
    { y: 2026, m: 11, d: 1, hh: 18, mm: 0 }, // evening after fall-back
  ];
  for (const c of cases) {
    const utc = zonedWallTimeToUtc(c.y, c.m, c.d, c.hh, c.mm, ZONE);
    const expected = `${c.y}-${String(c.m).padStart(2, "0")}-${String(c.d).padStart(2, "0")} ${String(c.hh).padStart(2, "0")}:${String(c.mm).padStart(2, "0")}`;
    assert.equal(
      wallTimeInZone(utc, ZONE),
      expected,
      `post scheduled for ${expected} local must render back to that wall time`
    );
  }
});

test("publish-due check fires exactly at the intended local instant, not the UTC-offset guess", () => {
  // A post scheduled for 08:00 local on the fall-back day is stored as 13:00Z
  // (EST). A naive "always EDT (12:00Z)" guess would fire it an hour early.
  const scheduled = zonedWallTimeToUtc(2026, 11, 1, 8, 0, ZONE);
  const oneMinuteBefore = new Date(scheduled.getTime() - 60000);
  const atInstant = new Date(scheduled.getTime());
  const naiveEdtGuess = zonedWallTimeToUtc(2026, 11, 1, 8, 0, "Etc/GMT+4"); // fixed -4

  // Publisher condition is `scheduled_time <= NOW()`.
  assert.ok(!(scheduled <= oneMinuteBefore), "not due one minute early");
  assert.ok(scheduled <= atInstant, "due exactly at the local instant");
  assert.ok(
    scheduled.getTime() !== naiveEdtGuess.getTime(),
    "must not collapse to a fixed UTC offset across DST"
  );
});

test("scheduledTimeFor renders back to the requested wall time regardless of DST", () => {
  // scheduledTimeFor anchors day 1 to 'today'; whatever local date that is, the
  // stored instant must render back to 08:00 in the brand zone.
  const utc = scheduledTimeFor(1, "08:00", ZONE);
  const wall = wallTimeInZone(utc, ZONE);
  assert.match(wall, / 08:00$/, `expected 08:00 local, got ${wall}`);
});

test("optimal slots feed the DST-safe conversion for every daily window", () => {
  // Sanity that the three daily windows survive the tz conversion distinctly on
  // a summer date (EDT): 08/12/18 local -> 12/16/22 Z.
  const slots = computeSlots("optimal", ["facebook"]);
  const times = [...new Set(slots.map((s) => s.time))].sort();
  assert.deepEqual(times, ["08:00", "12:00", "18:00"]);
  const utcHours = times
    .map((t) => {
      const [h, m] = t.split(":").map(Number);
      return zonedWallTimeToUtc(2026, 7, 15, h, m, ZONE).getUTCHours();
    })
    .sort((a, b) => a - b);
  assert.deepEqual(utcHours, [12, 16, 22]);
});

// ---------------------------------------------------------------------------
// True end-to-end publish across DST: real (isolated) DB rows scheduled via the
// DST-aware conversion, run through the REAL due publisher (publishDuePosts),
// asserting exactly which posts get picked up. dbGuard redirects DATABASE_URL to
// the isolated test database; push senders are stubbed so no alert hits the
// network. There are no connected social accounts, so a claimed post fails at
// the publish step (loadConnectedAccount throws) — but reaching 'failed' proves
// the row was selected as due and ran the real publisher path.
// ---------------------------------------------------------------------------

const db = require("../config/db");
const pushController = require("../controllers/pushController");
const mobilePushController = require("../controllers/mobilePushController");
const { publishDuePosts } = require("../controllers/socialController");

const e2e = { userId: null, brandId: null, estId: null, edtId: null, futureId: null };
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

  const email = `dst-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const u = await db.query(
    `INSERT INTO users (email, password_hash, role, subscription_tier)
     VALUES ($1, 'not-a-real-hash', 'user'::user_role, 'pro'::subscription_tier)
     RETURNING user_id`,
    [email]
  );
  e2e.userId = u.rows[0].user_id;
  await db.query(
    `INSERT INTO subscriptions (user_id, subscription_tier, payment_status, is_locked)
     VALUES ($1, 'pro'::subscription_tier, 'active', FALSE)`,
    [e2e.userId]
  );
  const b = await db.query(
    `INSERT INTO brands (user_id, brand_name, is_demo)
     VALUES ($1, 'DST E2E Co', FALSE) RETURNING brand_id`,
    [e2e.userId]
  );
  e2e.brandId = b.rows[0].brand_id;

  const pastYear = new Date().getUTCFullYear() - 1; // definitely due
  const futureYear = new Date().getUTCFullYear() + 1; // definitely not due
  const estInstant = zonedWallTimeToUtc(pastYear, 1, 15, 8, 0, ZONE); // winter EST
  const edtInstant = zonedWallTimeToUtc(pastYear, 7, 15, 8, 0, ZONE); // summer EDT
  const futureInstant = zonedWallTimeToUtc(futureYear, 7, 15, 8, 0, ZONE);

  async function seedPost(when) {
    const r = await db.query(
      `INSERT INTO social_posts (brand_id, platform, post_content, scheduled_time, status)
       VALUES ($1, 'facebook'::social_platform, 'DST post', $2, 'scheduled'::social_post_status)
       RETURNING post_id`,
      [e2e.brandId, when.toISOString()]
    );
    return r.rows[0].post_id;
  }
  e2e.estId = await seedPost(estInstant);
  e2e.edtId = await seedPost(edtInstant);
  e2e.futureId = await seedPost(futureInstant);
});

after(async () => {
  try {
    if (e2e.userId) {
      await db.query(`DELETE FROM users WHERE user_id = $1`, [e2e.userId]);
    }
  } finally {
    restorePush();
  }
});

test("E2E: DST-scheduled past posts are published (attempted) and future ones are left scheduled", async () => {
  // Global summary counts can include rows from other test files sharing the
  // isolated DB, so we only sanity-check that our two past posts were among the
  // claimed set; the authoritative signal is the per-post status below.
  const summary = await publishDuePosts();
  assert.ok(summary.due >= 2, "at least our two past DST posts were claimed as due");

  const rows = await db.query(
    `SELECT post_id, status, scheduled_time,
            EXTRACT(HOUR FROM scheduled_time AT TIME ZONE 'UTC')::int AS utc_hour
     FROM social_posts WHERE post_id = ANY($1::uuid[])`,
    [[e2e.estId, e2e.edtId, e2e.futureId]]
  );
  const byId = Object.fromEntries(rows.rows.map((r) => [r.post_id, r]));

  // Both past posts were selected by `scheduled_time <= NOW()` and ran through
  // the real publisher (no account -> flipped to 'failed').
  assert.strictEqual(byId[e2e.estId].status, "failed", "winter/EST post published (attempted)");
  assert.strictEqual(byId[e2e.edtId].status, "failed", "summer/EDT post published (attempted)");
  // The future post's local instant hasn't arrived, so it stays scheduled.
  assert.strictEqual(byId[e2e.futureId].status, "scheduled", "future post not yet due");

  // And the stored instants honor DST: 08:00 local is 13:00Z in EST, 12:00Z in EDT.
  assert.strictEqual(byId[e2e.estId].utc_hour, 13, "EST 08:00 stored as 13:00Z");
  assert.strictEqual(byId[e2e.edtId].utc_hour, 12, "EDT 08:00 stored as 12:00Z");
});
