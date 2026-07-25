const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeWebsiteUrl,
  normalizeFacebookPageUrl,
  isRefusalAnswer,
} = require("../utils/onlinePresence");

test("normalizeWebsiteUrl accepts full URLs and bare domains", () => {
  assert.deepEqual(normalizeWebsiteUrl("https://acme.com"), { ok: true, value: "https://acme.com/" });
  assert.deepEqual(normalizeWebsiteUrl("acme.com"), { ok: true, value: "https://acme.com/" });
  assert.deepEqual(normalizeWebsiteUrl("www.acme.com/shop"), {
    ok: true,
    value: "https://www.acme.com/shop",
  });
  assert.equal(normalizeWebsiteUrl("http://acme.com").value, "http://acme.com/");
});

test("normalizeWebsiteUrl: blank clears; garbage is rejected (never silently dropped)", () => {
  assert.deepEqual(normalizeWebsiteUrl(""), { ok: true, value: null });
  assert.deepEqual(normalizeWebsiteUrl("   "), { ok: true, value: null });
  assert.deepEqual(normalizeWebsiteUrl(null), { ok: true, value: null });
  assert.equal(normalizeWebsiteUrl("not a url").ok, false);
  assert.equal(normalizeWebsiteUrl("localhost").ok, false);
  assert.equal(normalizeWebsiteUrl("ftp://acme.com").ok, false);
  assert.equal(normalizeWebsiteUrl(42).ok, false);
});

test("normalizeFacebookPageUrl accepts facebook URLs, m./fb.com variants, and bare handles", () => {
  assert.equal(
    normalizeFacebookPageUrl("https://www.facebook.com/acmeshop").value,
    "https://www.facebook.com/acmeshop",
  );
  assert.equal(
    normalizeFacebookPageUrl("facebook.com/acmeshop/").value,
    "https://www.facebook.com/acmeshop",
  );
  assert.equal(
    normalizeFacebookPageUrl("m.facebook.com/acmeshop").value,
    "https://www.facebook.com/acmeshop",
  );
  assert.equal(
    normalizeFacebookPageUrl("fb.com/acmeshop").value,
    "https://www.facebook.com/acmeshop",
  );
  assert.equal(normalizeFacebookPageUrl("acmeshop").value, "https://www.facebook.com/acmeshop");
  assert.equal(normalizeFacebookPageUrl("@acmeshop").value, "https://www.facebook.com/acmeshop");
});

test("normalizeFacebookPageUrl: blank clears; non-facebook URLs and junk are rejected", () => {
  assert.deepEqual(normalizeFacebookPageUrl(""), { ok: true, value: null });
  assert.deepEqual(normalizeFacebookPageUrl(null), { ok: true, value: null });
  // A non-facebook domain must NOT be silently turned into a page handle.
  assert.equal(normalizeFacebookPageUrl("acme.com").ok, false);
  assert.equal(normalizeFacebookPageUrl("https://instagram.com/acme").ok, false);
  assert.equal(normalizeFacebookPageUrl("facebook.com/").ok, false);
  assert.equal(normalizeFacebookPageUrl("has spaces").ok, false);
});

test("isRefusalAnswer matches whole-word refusals only", () => {
  for (const yes of ["no", "  No.", "none", "nope", "N/A", "not yet", "we don't have one", "don't have one", "nothing"]) {
    assert.equal(isRefusalAnswer(yes), true, `expected refusal: ${yes}`);
  }
  // Real inputs that merely START with "no" must never be treated as refusals.
  for (const notRefusal of ["northsideplumbing.com", "nova-fitness", "nonstopfitness", "notarypro.com", "@nooksbakery"]) {
    assert.equal(isRefusalAnswer(notRefusal), false, `not a refusal: ${notRefusal}`);
  }
  assert.equal(isRefusalAnswer(null), false);
});
