const { test } = require("node:test");
const assert = require("node:assert");

// echoSuggestions requires the same db singleton; we swap db.query with a stub
// per-test so these are pure unit tests (no real rows). The stub matches on SQL
// substrings so the order of internal queries doesn't make the test brittle.
const db = require("../config/db");
const suggestions = require("../utils/echoSuggestions");

function withStub(handler, fn) {
  const original = db.query;
  db.query = handler;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      db.query = original;
    });
}

const UID = "00000000-0000-0000-0000-000000000001";

test("computeSuggestions surfaces gaps for channels the owner doesn't use", async () => {
  await withStub(
    async (sql) => {
      if (/FROM brands/i.test(sql)) return { rows: [{ brand_id: "b1" }] };
      if (/FROM echo_suggestions/i.test(sql)) return { rows: [] }; // nothing suppressed
      // Every channel probe returns no rows -> every channel is a gap.
      return { rows: [] };
    },
    async () => {
      const out = await suggestions.computeSuggestions(UID);
      assert.strictEqual(out.length, suggestions.MAX_SUGGESTIONS);
      assert.ok(out.every((s) => s.key && s.channel && s.section && s.reason));
    },
  );
});

test("computeSuggestions returns [] when the owner has no real brands", async () => {
  await withStub(
    async (sql) => {
      if (/FROM brands/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    async () => {
      const out = await suggestions.computeSuggestions(UID);
      assert.deepStrictEqual(out, []);
    },
  );
});

test("computeSuggestions suppresses recently shown / declined / accepted keys", async () => {
  await withStub(
    async (sql) => {
      if (/FROM brands/i.test(sql)) return { rows: [{ brand_id: "b1" }] };
      if (/FROM echo_suggestions/i.test(sql)) {
        // All catalog keys are suppressed -> nothing left to suggest.
        return { rows: suggestions.CATALOG.map((c) => ({ suggestion_key: c.key })) };
      }
      return { rows: [] };
    },
    async () => {
      const out = await suggestions.computeSuggestions(UID);
      assert.deepStrictEqual(out, []);
    },
  );
});

test("computeSuggestions fails CLOSED: a probe error never fabricates a gap", async () => {
  await withStub(
    async (sql) => {
      if (/FROM brands/i.test(sql)) return { rows: [{ brand_id: "b1" }] };
      if (/FROM echo_suggestions/i.test(sql)) return { rows: [] };
      // Every usage probe throws -> no channel can be confirmed as a gap.
      throw new Error("db down");
    },
    async () => {
      const out = await suggestions.computeSuggestions(UID);
      assert.deepStrictEqual(out, []);
    },
  );
});

test("computeSuggestions skips channels the owner already uses", async () => {
  const firstKey = suggestions.CATALOG[0].key;
  await withStub(
    async (sql, params) => {
      if (/FROM brands/i.test(sql)) return { rows: [{ brand_id: "b1" }] };
      if (/FROM echo_suggestions/i.test(sql)) return { rows: [] };
      // The first catalog channel is "in use" (returns a row); others are gaps.
      const usedTable = suggestions.CATALOG[0];
      void params;
      if (usedTable.key === "chatbot" && /chatbot_config/i.test(sql)) {
        return { rows: [{ x: 1 }] };
      }
      return { rows: [] };
    },
    async () => {
      const out = await suggestions.computeSuggestions(UID);
      assert.ok(
        !out.some((s) => s.key === firstKey),
        "channel already in use must not be suggested",
      );
    },
  );
});

test("recordDecision rejects an invalid decision value", async () => {
  await assert.rejects(
    () => suggestions.recordDecision(UID, "email", "maybe"),
    /Invalid decision/,
  );
});

test("recordDecision rejects an unknown suggestion key", async () => {
  await assert.rejects(
    () => suggestions.recordDecision(UID, "not_a_real_key", "declined"),
    /Unknown suggestion key/,
  );
});

test("isValidKey only accepts catalog keys", () => {
  assert.strictEqual(suggestions.isValidKey("email"), true);
  assert.strictEqual(suggestions.isValidKey("chatbot"), true);
  assert.strictEqual(suggestions.isValidKey("bogus"), false);
});
