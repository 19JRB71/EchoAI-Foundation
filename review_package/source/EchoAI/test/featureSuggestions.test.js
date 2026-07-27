const { test } = require("node:test");
const assert = require("node:assert");

const db = require("../config/db");
const suggestions = require("../utils/featureSuggestions");

// ---------------------------------------------------------------------------
// logFeatureSuggestion: mocked-db unit tests. The AI classifier is stubbed via
// the module.exports seam; db.query is replaced with a scripted fake so the
// tests verify the SQL flow (match → increment, no match → insert w/ conflict
// backstop, verbatim request always recorded) without touching Postgres.
// ---------------------------------------------------------------------------

function makeFakeDb() {
  const state = { increments: [], inserts: [], requests: [] };
  async function query(sql, params = []) {
    if (/UPDATE feature_suggestions/i.test(sql) && /request_count \+ 1/i.test(sql) && /WHERE suggestion_id/i.test(sql)) {
      state.increments.push(params[0]);
      return { rows: [{ suggestion_id: params[0] }] };
    }
    if (/INSERT INTO feature_suggestions/i.test(sql)) {
      assert.match(sql, /ON CONFLICT/i, "insert must carry the concurrent-create backstop");
      state.inserts.push({ title: params[0], description: params[1] });
      return { rows: [{ suggestion_id: "new-id" }] };
    }
    if (/INSERT INTO feature_suggestion_requests/i.test(sql)) {
      state.requests.push({ suggestionId: params[0], userId: params[1], text: params[2] });
      return { rows: [] };
    }
    throw new Error(`fake db: unexpected query: ${sql.slice(0, 80)}`);
  }
  return { query, state };
}

test("logFeatureSuggestion: AI match increments the existing suggestion and records the verbatim ask", async () => {
  const fake = makeFakeDb();
  const origQuery = db.query;
  const origClassify = suggestions.classifyRequest;
  db.query = fake.query;
  suggestions.classifyRequest = async () => ({ suggestionId: "existing-1", title: "TikTok posting" });
  try {
    const id = await suggestions.logFeatureSuggestion("user-1", "Can you post my videos to TikTok?", "post to TikTok");
    assert.strictEqual(id, "existing-1");
    assert.deepStrictEqual(fake.state.increments, ["existing-1"]);
    assert.strictEqual(fake.state.inserts.length, 0);
    assert.strictEqual(fake.state.requests.length, 1);
    assert.strictEqual(fake.state.requests[0].text, "Can you post my videos to TikTok?");
    assert.strictEqual(fake.state.requests[0].userId, "user-1");
  } finally {
    db.query = origQuery;
    suggestions.classifyRequest = origClassify;
  }
});

test("logFeatureSuggestion: no AI match creates a new suggestion via the conflict-safe insert", async () => {
  const fake = makeFakeDb();
  const origQuery = db.query;
  const origClassify = suggestions.classifyRequest;
  db.query = fake.query;
  suggestions.classifyRequest = async () => ({ suggestionId: null, title: "QuickBooks integration" });
  try {
    const id = await suggestions.logFeatureSuggestion("user-2", "Sync my invoices with QuickBooks");
    assert.strictEqual(id, "new-id");
    assert.strictEqual(fake.state.increments.length, 0);
    assert.strictEqual(fake.state.inserts.length, 1);
    assert.strictEqual(fake.state.inserts[0].title, "QuickBooks integration");
    assert.strictEqual(fake.state.requests[0].suggestionId, "new-id");
  } finally {
    db.query = origQuery;
    suggestions.classifyRequest = origClassify;
  }
});

test("logFeatureSuggestion: classifier failure propagates (caller must not falsely confirm)", async () => {
  const origClassify = suggestions.classifyRequest;
  suggestions.classifyRequest = async () => {
    throw new Error("AI down");
  };
  try {
    await assert.rejects(
      () => suggestions.logFeatureSuggestion("user-3", "Book me a flight"),
      /AI down/,
    );
  } finally {
    suggestions.classifyRequest = origClassify;
  }
});

test("logFeatureSuggestion: empty request text is rejected", async () => {
  await assert.rejects(() => suggestions.logFeatureSuggestion("user-4", "   "), /Empty feature request/);
});

// ---------------------------------------------------------------------------
// The [[FEATURE_REQUEST: ...]] marker contract used by echoCompanionController:
// the marker must parse out of a reply and strip cleanly.
// ---------------------------------------------------------------------------

test("feature-request marker: parses and strips from an Echo reply", () => {
  const reply =
    "Sir, that's not something I can do just yet — but I think it's a great idea.\n[[FEATURE_REQUEST: post videos to TikTok]]";
  const m = reply.match(/\[\[FEATURE_REQUEST:\s*([\s\S]*?)\]\]/);
  assert.ok(m);
  assert.strictEqual(m[1].trim(), "post videos to TikTok");
  const stripped = reply.replace(/\s*\[\[FEATURE_REQUEST:[\s\S]*?\]\]\s*/g, " ").trim();
  assert.strictEqual(
    stripped,
    "Sir, that's not something I can do just yet — but I think it's a great idea.",
  );
});
