// Sage feed content-key dedup — the "same finding posted two or three times"
// fix. The content key must normalize case/punctuation so a re-found story
// with a fresh signal_key still collapses onto the existing row, and it must
// match the SQL backfill normalization in models/101_sage_feed_dismiss.sql:
//   md5(trim(regexp_replace(lower(summary), '[^a-z0-9]+', ' ', 'g')))
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");

process.env.NODE_ENV = "test";

const {
  _contentKeyOfForTests: contentKeyOf,
} = require("../controllers/sageController.js");

test("identical summaries produce identical keys", () => {
  const a = contentKeyOf("Florida law now prohibits HOAs from restricting storage.");
  const b = contentKeyOf("Florida law now prohibits HOAs from restricting storage.");
  assert.strictEqual(a, b);
});

test("case and punctuation variants collapse to the same key", () => {
  const a = contentKeyOf("The 2026 Atlantic hurricane season is shaping up!");
  const b = contentKeyOf("the 2026 atlantic  hurricane-season is shaping up");
  assert.strictEqual(a, b);
});

test("different findings produce different keys", () => {
  const a = contentKeyOf("Florida Building Code updated hurricane standards.");
  const b = contentKeyOf("New FL statute prohibits HOA storage restrictions.");
  assert.notStrictEqual(a, b);
});

test("matches the SQL backfill normalization exactly", () => {
  const summary = "  The 2025 Florida Building Code — updated! (FL Statute 553.80)  ";
  // Mirror of: md5(trim(regexp_replace(lower(summary), '[^a-z0-9]+', ' ', 'g')))
  const sqlEquivalent = crypto
    .createHash("md5")
    .update(summary.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
    .digest("hex");
  assert.strictEqual(contentKeyOf(summary), sqlEquivalent);
});

test("empty / null summaries do not throw and are stable", () => {
  assert.strictEqual(contentKeyOf(""), contentKeyOf(null));
  assert.strictEqual(contentKeyOf(undefined), contentKeyOf("   "));
});
