// Competitor Website change alerts (Scout, Enterprise) — at-most-once guarantee.
//
// recordAndAlertChange() must alert the owner EXACTLY ONCE per (site, change),
// even when sweeps overlap or a prior run crashed after inserting the change row
// but before alerting. Two guards enforce this together:
//   - the unique (site_id, change_key) index dedups the change row, and
//   - a CAS on owner_alerted_at claims the single alert atomically and recovers
//     an un-alerted row left behind by a crash.
// These paths were only covered by reasoning + pure-unit tests; this DB-backed
// suite drives the real SQL against the isolated test DB so a future refactor
// can't silently reintroduce double-alerts or dropped alerts.
//
// We assert on TWO independent signals: the owner_alerted_at CAS marker (the
// authoritative guard) AND the real alert side-effects (push fan-out), which we
// spy on because they're called via property access on the push controllers.

const { test, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { db, createTestUser, deleteUser } = require("./helpers");

// Spy on the alert fan-out BEFORE requiring the controller. Both push senders are
// invoked via `pushController.sendPushToUser(...)` / `mobilePushController.sendToUser(...)`
// (property access at call time), so replacing the exported functions here is
// observed by the controller. (The voice enqueue is destructured at import and
// gated by per-user settings, so push is the reliable "did the alert path run?"
// probe.) The controller swallows their promises (.catch), so returning a
// resolved promise keeps the best-effort contract intact.
const pushController = require("../controllers/pushController");
const mobilePushController = require("../controllers/mobilePushController");

let webPushCalls = 0;
let mobilePushCalls = 0;
pushController.sendPushToUser = async () => {
  webPushCalls += 1;
};
mobilePushController.sendToUser = async () => {
  mobilePushCalls += 1;
};

const controller = require("../controllers/competitorSiteController");

const users = [];
const brands = [];

async function freshUser() {
  const id = await createTestUser();
  users.push(id);
  return id;
}

async function freshBrand(userId, overrides = {}) {
  const { rows } = await db.query(
    `INSERT INTO brands (user_id, brand_name, is_demo)
     VALUES ($1, $2, $3) RETURNING brand_id, user_id, brand_name, is_demo`,
    [userId, overrides.name || "Test Co", overrides.is_demo || false],
  );
  const brand = rows[0];
  brands.push(brand.brand_id);
  return brand;
}

async function freshSite(brandId) {
  const { rows } = await db.query(
    `INSERT INTO competitor_websites (brand_id, url, label, status)
     VALUES ($1, $2, $3, 'analyzed')
     RETURNING site_id, brand_id, url, label`,
    [brandId, `https://rival-${Date.now()}-${Math.random().toString(36).slice(2)}.example.test`, "Rival"],
  );
  return rows[0];
}

const CHANGE = {
  type: "pricing",
  summary: "Rival dropped their starter plan to $9/mo.",
  detail: "Was $19/mo, now $9/mo.",
};

async function alertMarker(siteId) {
  const { rows } = await db.query(
    `SELECT change_id, owner_alerted_at
       FROM competitor_website_changes
      WHERE site_id = $1
      ORDER BY detected_at ASC`,
    [siteId],
  );
  return rows;
}

beforeEach(() => {
  webPushCalls = 0;
  mobilePushCalls = 0;
});

after(async () => {
  for (const id of brands) {
    await db.query(
      `DELETE FROM competitor_website_changes WHERE brand_id = $1`,
      [id],
    );
    await db.query(`DELETE FROM competitor_websites WHERE brand_id = $1`, [id]);
    await db.query(`DELETE FROM brands WHERE brand_id = $1`, [id]);
  }
  for (const id of users) await deleteUser(id);
  await db.pool.end();
});

test("recordAndAlertChange alerts exactly once across overlapping/repeat sweeps", async () => {
  const userId = await freshUser();
  const brand = await freshBrand(userId);
  const site = await freshSite(brand.brand_id);

  await controller.recordAndAlertChange(brand, site, CHANGE);

  let rows = await alertMarker(site.site_id);
  assert.equal(rows.length, 1, "exactly one change row is recorded");
  const firstAlertAt = rows[0].owner_alerted_at;
  assert.ok(firstAlertAt, "owner_alerted_at is stamped on the first alert");
  assert.equal(webPushCalls, 1, "web push fan-out runs exactly once");
  assert.equal(mobilePushCalls, 1, "mobile push fan-out runs exactly once");

  // A second, overlapping sweep detects the SAME change: the unique key no-ops
  // the insert and the CAS (owner_alerted_at IS NULL) fails — so no second alert.
  await controller.recordAndAlertChange(brand, site, CHANGE);

  rows = await alertMarker(site.site_id);
  assert.equal(rows.length, 1, "no duplicate change row for the same (site, change)");
  assert.equal(
    rows[0].owner_alerted_at.getTime(),
    firstAlertAt.getTime(),
    "owner_alerted_at is not re-stamped (no double alert)",
  );
  assert.equal(webPushCalls, 1, "web push does not fire a second time");
  assert.equal(mobilePushCalls, 1, "mobile push does not fire a second time");
});

test("recordAndAlertChange recovers a crash-before-alert row and alerts once", async () => {
  const userId = await freshUser();
  const brand = await freshBrand(userId);
  const site = await freshSite(brand.brand_id);

  // Simulate a prior run that inserted the change row but crashed BEFORE alerting:
  // the row exists with owner_alerted_at still NULL. Use the exact change_key the
  // controller computes so its INSERT ... ON CONFLICT DO NOTHING no-ops and it
  // must re-fetch this row to recover it.
  const { signalKey } = (() => {
    // Mirror the controller's change_key derivation without exporting it.
    const k = (s) =>
      String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120);
    return { signalKey: k };
  })();
  const changeKey = `${CHANGE.type}:${signalKey(CHANGE.summary)}`;
  await db.query(
    `INSERT INTO competitor_website_changes
       (site_id, brand_id, change_type, summary, details, change_key)
     VALUES ($1, $2, $3, $4, '{}'::jsonb, $5)`,
    [site.site_id, brand.brand_id, CHANGE.type, CHANGE.summary, changeKey],
  );

  let rows = await alertMarker(site.site_id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].owner_alerted_at, null, "precondition: un-alerted row exists");

  await controller.recordAndAlertChange(brand, site, CHANGE);

  rows = await alertMarker(site.site_id);
  assert.equal(rows.length, 1, "the recovered run reuses the existing row (no duplicate)");
  assert.ok(rows[0].owner_alerted_at, "the un-alerted row is recovered and alerted");
  assert.equal(webPushCalls, 1, "the recovered alert fires the push fan-out exactly once");
  assert.equal(mobilePushCalls, 1, "the recovered alert fires the mobile push exactly once");

  // And a subsequent sweep still won't re-alert the now-claimed row.
  await controller.recordAndAlertChange(brand, site, CHANGE);
  assert.equal(webPushCalls, 1, "no re-alert after recovery");
});

test("demo brands record the change but never alert the owner", async () => {
  const userId = await freshUser();
  const brand = await freshBrand(userId, { is_demo: true });
  const site = await freshSite(brand.brand_id);

  await controller.recordAndAlertChange(brand, site, CHANGE);

  const rows = await alertMarker(site.site_id);
  assert.equal(rows.length, 1, "the change is still recorded for the demo brand");
  assert.equal(rows[0].owner_alerted_at, null, "a demo brand is never marked alerted");
  assert.equal(webPushCalls, 0, "no web push for a demo brand");
  assert.equal(mobilePushCalls, 0, "no mobile push for a demo brand");
});
