// Competitor Ad Spy (Scout, Enterprise). Two layers:
//   1) Pure helpers (no DB): ad normalization, Hermes classification parsing,
//      report/counter validation, ISO-week bucketing — the honesty + shape rules.
//   2) DB-backed engine: upsert brand-new-ad detection (xmax=0) is exact-once per
//      (brand, ad_archive_id), and the owner alert CAS fires exactly once even
//      under a repeat call (never double-alerts).
// Runs against the isolated test DB via the app's own db module.

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { db, createTestUser, deleteUser } = require("./helpers");

const {
  normalizeAd,
  reachedCountries,
  pageNameMatchesCompetitor,
} = require("../utils/competitorAdLibrary");
const { parseClassification } = require("../utils/competitorAdBrain");
const {
  validateReport,
  validateCounter,
} = require("../prompts/competitorAdReportPrompt");
const controller = require("../controllers/competitorAdSpyController");

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
     VALUES ($1, $2, $3) RETURNING brand_id, user_id, is_demo`,
    [userId, overrides.name || "Test Co", overrides.is_demo || false],
  );
  const brand = rows[0];
  brands.push(brand.brand_id);
  return brand;
}

after(async () => {
  for (const id of brands) {
    await db.query(`DELETE FROM competitor_ads WHERE brand_id = $1`, [id]);
    await db.query(`DELETE FROM competitor_ad_reports WHERE brand_id = $1`, [id]);
    await db.query(`DELETE FROM brands WHERE brand_id = $1`, [id]);
  }
  for (const id of users) await deleteUser(id);
  await db.pool.end();
});

/* ------------------------------- pure helpers ------------------------------ */

test("normalizeAd keeps real ads and drops empty shells", () => {
  const competitor = { competitor_id: 7, name: "Rival LLC" };

  const real = normalizeAd(
    {
      id: "123",
      ad_creative_bodies: ["Save 50% today"],
      ad_creative_link_titles: ["Half Off Everything"],
      ad_creative_link_captions: ["Shop Now"],
      publisher_platforms: ["facebook", "instagram", 5],
      ad_delivery_start_time: "2026-06-01T00:00:00+0000",
      ad_snapshot_url: "https://facebook.com/ads/library/?id=123",
      page_name: "Rival Page",
    },
    competitor,
  );
  assert.equal(real.adArchiveId, "123");
  assert.equal(real.competitorId, 7);
  assert.equal(real.competitorName, "Rival LLC");
  assert.equal(real.headline, "Half Off Everything");
  assert.equal(real.body, "Save 50% today");
  assert.equal(real.cta, "Shop Now");
  assert.equal(real.deliveryStart, "2026-06-01"); // sliced to a DATE
  assert.deepEqual(real.platforms, ["facebook", "instagram"]); // non-strings dropped

  // No id → nothing.
  assert.equal(normalizeAd({ ad_creative_bodies: ["x"] }, competitor), null);
  // No copy AND no headline → an empty shell, tells us nothing real.
  assert.equal(
    normalizeAd({ id: "9", ad_creative_link_captions: ["Learn More"] }, competitor),
    null,
  );
});

test("reachedCountries returns a 2-letter code or defaults to US (never invents)", () => {
  assert.deepEqual(reachedCountries({ country: "gb" }), ["GB"]);
  assert.deepEqual(reachedCountries({ country_code: "CA" }), ["CA"]);
  assert.deepEqual(reachedCountries({}), ["US"]);
  assert.deepEqual(reachedCountries({ country: "United Kingdom" }), ["US"]); // not a code → default
});

test("parseClassification tolerates fences/prose and clamps invalid levels to none", () => {
  const map = parseClassification(
    'Here you go:\n```json\n{"ads":[' +
      '{"adArchiveId":"1","threatLevel":"aggressive","angle":"deep discount","reason":"Undercuts price"},' +
      '{"adArchiveId":2,"threatLevel":"WATCH","angle":"brand"},' +
      '{"adArchiveId":"3","threatLevel":"nonsense"},' +
      '{"threatLevel":"aggressive"}' + // no id → skipped
      "]}\n```",
  );
  assert.equal(map["1"].threatLevel, "aggressive");
  assert.equal(map["1"].reason, "Undercuts price");
  assert.equal(map["2"].threatLevel, "watch"); // numeric id coerced, level lowercased
  assert.equal(map["3"].threatLevel, "none"); // invalid → none
  assert.equal(Object.keys(map).length, 3); // id-less entry dropped
});

test("parseClassification returns null on garbage (caller falls back to none)", () => {
  assert.equal(parseClassification("not json"), null);
  assert.equal(parseClassification(""), null);
  assert.equal(parseClassification('{"nope":1}'), null);
});

test("validateReport requires a summary and >=1 recommendation, caps at 3", () => {
  const clean = validateReport({
    summary: "Competitors leaned on discounts this week.",
    topAds: [
      { competitor: "Rival", headline: "50% off", whyWorking: "urgency" },
      { junk: true },
    ],
    gaps: [{ gap: "No video ads", opportunity: "Run a demo reel" }, {}],
    recommendations: [
      { title: "A", detail: "x" },
      { title: "B", detail: "y" },
      { title: "C", detail: "z" },
      { title: "D", detail: "w" },
    ],
  });
  assert.equal(clean.topAds.length, 1); // shapeless entry filtered
  assert.equal(clean.gaps.length, 1);
  assert.equal(clean.recommendations.length, 3); // capped

  assert.throws(() => validateReport({ topAds: [] }), /missing summary|not an object/i);
  assert.throws(
    () => validateReport({ summary: "hi", recommendations: [] }),
    /no valid recommendations/i,
  );
});

test("validateCounter requires headline + primary text", () => {
  const c = validateCounter({
    angle: "value",
    headline: "We beat any price",
    primaryText: "Same service, better rate.",
    cta: "Get a quote",
    rationale: "counters their discount",
  });
  assert.equal(c.headline, "We beat any price");
  assert.equal(c.primaryText, "Same service, better rate.");

  assert.throws(() => validateCounter({ headline: "x" }), /missing headline or primary/i);
  assert.throws(() => validateCounter(null), /not an object/i);
});

test("pageNameMatchesCompetitor keeps the competitor's own ads, drops strangers", () => {
  // Same brand, tolerant of LLC/Inc/punctuation/case noise.
  assert.equal(pageNameMatchesCompetitor("Rival LLC", "Rival"), true);
  assert.equal(pageNameMatchesCompetitor("Acme Plumbing Co.", "Acme Plumbing"), true);
  assert.equal(pageNameMatchesCompetitor("Bob's HVAC", "Bobs HVAC Inc"), true);
  // A coincidental one-word term match to an unrelated advertiser is rejected.
  assert.equal(pageNameMatchesCompetitor("Acme Plumbing", "Downtown Diner"), false);
  assert.equal(pageNameMatchesCompetitor("Rival LLC", "Rivalry Sports Bar"), false);
  // Missing data never matches (no attribution without evidence).
  assert.equal(pageNameMatchesCompetitor("Rival", ""), false);
  assert.equal(pageNameMatchesCompetitor("", "Rival"), false);
});

test("weekDateFor buckets any weekday to that ISO week's Monday (UTC)", () => {
  // 2026-07-10 is a Friday → Monday is 2026-07-06.
  assert.equal(controller.weekDateFor(new Date("2026-07-10T15:00:00Z")), "2026-07-06");
  // A Monday maps to itself.
  assert.equal(controller.weekDateFor(new Date("2026-07-06T00:00:00Z")), "2026-07-06");
  // A Sunday belongs to the week that started the prior Monday.
  assert.equal(controller.weekDateFor(new Date("2026-07-12T23:00:00Z")), "2026-07-06");
});

/* ------------------------------ DB-backed engine --------------------------- */

test("upsertAds detects brand-new ads exactly once per (brand, ad_archive_id)", async () => {
  const userId = await freshUser();
  const brand = await freshBrand(userId);

  const ad = {
    adArchiveId: "AD-100",
    competitorId: null,
    competitorName: "Rival LLC",
    pageName: "Rival",
    headline: "Zero down",
    body: "No money down financing",
    cta: "Apply",
    snapshotUrl: "https://facebook.com/ads/library/?id=AD-100",
    platforms: ["facebook"],
    deliveryStart: "2026-07-01",
  };

  const firstRun = await controller.upsertAds(brand, [ad]);
  assert.equal(firstRun.length, 1, "first insert is reported as new");
  assert.equal(firstRun[0].adArchiveId, "AD-100");

  // Re-running with the same archive id updates in place, reports 0 new.
  const secondRun = await controller.upsertAds(brand, [{ ...ad, headline: "Zero down!" }]);
  assert.equal(secondRun.length, 0, "same ad is not re-reported as new");

  const { rows } = await db.query(
    `SELECT headline FROM competitor_ads WHERE brand_id = $1 AND ad_archive_id = 'AD-100'`,
    [brand.brand_id],
  );
  assert.equal(rows.length, 1); // unique(brand_id, ad_archive_id) held
  assert.equal(rows[0].headline, "Zero down!"); // updated in place
});

test("the feed stops surfacing an ad not re-seen within the live window", async () => {
  const userId = await freshUser();
  const brand = await freshBrand(userId);

  // One fresh ad (seen just now) and one stale ad (last seen 10 days ago). The
  // Ad Library never says an ad stopped — it just disappears — so a stale row is
  // treated as no longer live and must drop out of the feed.
  await db.query(
    `INSERT INTO competitor_ads
       (brand_id, competitor_name, ad_archive_id, headline, body_text, status, last_seen_at)
     VALUES ($1,'Rival LLC','AD-FRESH','Live now','Running today','active',NOW()),
            ($1,'Rival LLC','AD-STALE','Long gone','Stopped running','active',NOW() - INTERVAL '10 days')`,
    [brand.brand_id],
  );

  const req = { user: { userId }, params: { brandId: brand.brand_id } };
  let body = null;
  const res = { status: () => res, json: (b) => { body = b; return res; } };
  await controller.getFeed(req, res);

  const ids = (body.competitors || [])
    .flatMap((g) => g.ads)
    .map((a) => a.headline);
  assert.equal(body.totalAds, 1, "only the freshly-seen ad counts as live");
  assert.ok(ids.includes("Live now"));
  assert.ok(!ids.includes("Long gone"), "the stale ad is not surfaced as live");
});

test("escalateAggressiveAd alerts the owner exactly once (CAS on owner_alerted_at)", async () => {
  const userId = await freshUser();
  const brand = await freshBrand(userId);

  const { rows } = await db.query(
    `INSERT INTO competitor_ads
       (brand_id, competitor_name, ad_archive_id, headline, body_text, status, last_seen_at)
     VALUES ($1,'Rival LLC','AD-AGG','Beat any price','We will beat any quote','active',NOW())
     RETURNING ad_id, competitor_name`,
    [brand.brand_id],
  );
  const adRow = { ad_id: rows[0].ad_id, competitorName: rows[0].competitor_name };
  const classification = { threatLevel: "aggressive", reason: "Directly undercuts price." };

  // No Twilio config + (likely) no Facebook/voice creds in test — escalation must
  // never throw; it best-efforts each channel and always claims the CAS.
  await controller.escalateAggressiveAd(brand, adRow, classification);

  let check = await db.query(
    `SELECT owner_alerted_at FROM competitor_ads WHERE ad_id = $1`,
    [adRow.ad_id],
  );
  const firstAlertAt = check.rows[0].owner_alerted_at;
  assert.ok(firstAlertAt, "owner_alerted_at is stamped on first escalation");

  // Second escalation is a no-op: the CAS (owner_alerted_at IS NULL) fails.
  await controller.escalateAggressiveAd(brand, adRow, classification);
  check = await db.query(
    `SELECT owner_alerted_at FROM competitor_ads WHERE ad_id = $1`,
    [adRow.ad_id],
  );
  assert.equal(
    check.rows[0].owner_alerted_at.getTime(),
    firstAlertAt.getTime(),
    "second escalation does not re-stamp (no double alert)",
  );
});

// Guards against schema-column drift in the brand loaders. The scheduler passes a
// PARTIAL brand (no brand_name), so runCompetitorAdScanForBrand re-loads the full
// row via loadBrandRow — the exact SELECT that must only reference columns that
// exist on `brands`. A bad column here throws OUT of the scan (its own try/catch
// wraps only the fetch), so this asserts the loader query itself is well-formed.
test("scheduler scan re-loads a partial brand without a schema error", async () => {
  const userId = await freshUser();
  // Admin bypasses the Enterprise gate so the loader path actually runs.
  await db.query(`UPDATE users SET role = 'admin' WHERE user_id = $1`, [userId]);
  const brand = await freshBrand(userId, { name: "Loader Co" });

  // Only brand_id + user_id — forces loadBrandRow's DB SELECT (no in-memory row).
  const partial = { brand_id: brand.brand_id, user_id: userId };
  await assert.doesNotReject(
    () => controller.runCompetitorAdScanForBrand(partial),
    "loadBrandRow SELECT must reference only real brands columns",
  );
});
