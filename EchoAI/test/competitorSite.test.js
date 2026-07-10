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
