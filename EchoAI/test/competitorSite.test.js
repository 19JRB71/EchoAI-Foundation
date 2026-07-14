const { test } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// Competitor Website Analysis (Scout, Enterprise): two pure units.
//   1. normalizeCompetitorUrl — validates + normalizes owner-entered URLs and
//      rejects private/internal hosts (so the per-(brand,url) dedup key is stable
//      and we never monitor a non-public address).
//   2. normalizeChanges — the change-detection output validator: only known
//      change types survive, blank summaries are dropped, and the list is capped.
// ---------------------------------------------------------------------------

const { normalizeCompetitorUrl } = require("../utils/competitorSiteUrl");
const { normalizeChanges } = require("../prompts/competitorSitePrompt");
const {
  buildDigestFromRows,
  buildHeadline,
} = require("../controllers/competitorSiteController");

test("bare hostnames get https and a normalized origin", () => {
  assert.strictEqual(normalizeCompetitorUrl("competitor.com"), "https://competitor.com");
  assert.strictEqual(
    normalizeCompetitorUrl("Competitor.com/Pricing/"),
    "https://competitor.com/Pricing",
  );
});

test("http is upgraded to https and default port + fragment stripped", () => {
  assert.strictEqual(
    normalizeCompetitorUrl("http://competitor.com:443/plans#top"),
    "https://competitor.com/plans",
  );
});

test("query strings are preserved", () => {
  assert.strictEqual(
    normalizeCompetitorUrl("https://competitor.com/p?ref=abc"),
    "https://competitor.com/p?ref=abc",
  );
});

test("private / internal / loopback hosts are rejected", () => {
  for (const bad of [
    "localhost",
    "http://127.0.0.1",
    "http://10.0.0.5/admin",
    "http://192.168.1.1",
    "http://172.16.0.9",
    "http://intranet",
    "http://box.internal",
    "http://[::1]",
  ]) {
    assert.throws(() => normalizeCompetitorUrl(bad), (e) => e.badUrl === true, `should reject ${bad}`);
  }
});

test("empty / non-http(s) input is rejected", () => {
  assert.throws(() => normalizeCompetitorUrl(""), (e) => e.badUrl === true);
  assert.throws(() => normalizeCompetitorUrl("ftp://competitor.com"), (e) => e.badUrl === true);
});

test("IPv6-mapped IPv4 private/loopback hosts are rejected (SSRF bypass guard)", () => {
  for (const bad of [
    "http://[::ffff:127.0.0.1]", // mapped loopback, dotted
    "http://[::ffff:7f00:1]", // mapped loopback, hex tail
    "http://[::ffff:10.0.0.5]", // mapped 10/8
    "http://[::ffff:192.168.1.1]", // mapped 192.168/16
    "http://[::ffff:169.254.1.1]", // mapped link-local
    "http://[::127.0.0.1]", // deprecated IPv4-compatible loopback
  ]) {
    assert.throws(() => normalizeCompetitorUrl(bad), (e) => e.badUrl === true, `should reject ${bad}`);
  }
});

test("normalizeChanges keeps valid changes and coerces unknown types to messaging", () => {
  const out = normalizeChanges([
    { type: "pricing", summary: "Raised the Pro plan to $99", detail: "was $79" },
    { type: "weird", summary: "Homepage tagline changed" },
    { type: "offer", summary: "   " }, // blank summary → dropped
    { summary: "" }, // dropped
    null, // dropped
  ]);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out[0], {
    type: "pricing",
    summary: "Raised the Pro plan to $99",
    detail: "was $79",
  });
  assert.strictEqual(out[1].type, "messaging");
  assert.strictEqual(out[1].detail, null);
});

test("normalizeChanges caps the list at 8 and tolerates non-arrays", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    type: "messaging",
    summary: `change ${i}`,
  }));
  assert.strictEqual(normalizeChanges(many).length, 8);
  assert.deepStrictEqual(normalizeChanges(null), []);
  assert.deepStrictEqual(normalizeChanges(undefined), []);
});

// ---------------------------------------------------------------------------
// Weekly digest roll-up (pure aggregation, no DB / no AI):
//   - buildHeadline turns per-type distinct-competitor counts into one honest
//     plain-English sentence (singular/plural, natural comma+and joining).
//   - buildDigestFromRows counts DISTINCT competitors per change type, groups
//     changes per site, and never fabricates — an empty feed yields zeros + "".
// ---------------------------------------------------------------------------

test("buildHeadline pluralizes and joins clauses naturally", () => {
  assert.strictEqual(
    buildHeadline([{ type: "pricing", competitors: 1 }]),
    "1 competitor changed pricing this week.",
  );
  assert.strictEqual(
    buildHeadline([
      { type: "pricing", competitors: 3 },
      { type: "offer", competitors: 1 },
    ]),
    "3 competitors changed pricing and 1 competitor launched or changed an offer this week.",
  );
  assert.strictEqual(
    buildHeadline([
      { type: "pricing", competitors: 2 },
      { type: "messaging", competitors: 1 },
      { type: "redesign", competitors: 1 },
    ]),
    "2 competitors changed pricing, 1 competitor shifted messaging and 1 competitor redesigned their site this week.",
  );
  assert.strictEqual(buildHeadline([]), "");
});

test("buildDigestFromRows counts distinct competitors per type and groups by site", () => {
  const rows = [
    {
      change_id: "c1",
      change_type: "pricing",
      summary: "Raised Pro to $99",
      details: { detail: "was $79" },
      detected_at: "2026-07-08T10:00:00Z",
      site_id: "s1",
      label: "Acme",
      url: "https://acme.com",
    },
    {
      change_id: "c2",
      change_type: "pricing",
      summary: "New starter tier",
      details: {},
      detected_at: "2026-07-07T10:00:00Z",
      site_id: "s2",
      label: null,
      url: "https://beta.com",
    },
    {
      // same site s1 changes pricing again — must NOT double-count the competitor
      change_id: "c3",
      change_type: "pricing",
      summary: "Annual discount added",
      details: {},
      detected_at: "2026-07-06T10:00:00Z",
      site_id: "s1",
      label: "Acme",
      url: "https://acme.com",
    },
    {
      change_id: "c4",
      change_type: "offer",
      summary: "Summer sale",
      details: {},
      detected_at: "2026-07-05T10:00:00Z",
      site_id: "s2",
      label: null,
      url: "https://beta.com",
    },
  ];

  const digest = buildDigestFromRows(rows, 7);
  assert.strictEqual(digest.periodDays, 7);
  assert.strictEqual(digest.totalChanges, 4);
  assert.strictEqual(digest.sitesChanged, 2);

  // pricing: 2 distinct competitors (s1, s2); offer: 1 (s2). Ordered most-first.
  assert.deepStrictEqual(digest.byType, [
    { type: "pricing", competitors: 2 },
    { type: "offer", competitors: 1 },
  ]);
  assert.strictEqual(
    digest.headline,
    "2 competitors changed pricing and 1 competitor launched or changed an offer this week.",
  );

  // Grouped per site, changes carried through with mapped detail.
  assert.strictEqual(digest.sites.length, 2);
  const s1 = digest.sites.find((s) => s.siteId === "s1");
  assert.strictEqual(s1.label, "Acme");
  assert.strictEqual(s1.changes.length, 2);
  assert.strictEqual(s1.changes[0].detail, "was $79");
});

test("buildDigestFromRows is honest on an empty week", () => {
  const digest = buildDigestFromRows([], 7);
  assert.strictEqual(digest.totalChanges, 0);
  assert.strictEqual(digest.sitesChanged, 0);
  assert.deepStrictEqual(digest.byType, []);
  assert.deepStrictEqual(digest.sites, []);
  assert.strictEqual(digest.headline, "");
});
