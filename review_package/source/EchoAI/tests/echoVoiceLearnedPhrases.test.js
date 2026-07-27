// Learned speech patterns API: GET/POST /api/echo-voice/learned-phrases.
// Verifies real persistence (upsert + hit bump), owner scoping, and strict
// validation (phrase bounds + action allowlist) — the endpoints Echo's
// client-side speech-pattern learning relies on.
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const db = require("../config/db");
const controller = require("../controllers/echoVoiceController");

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function makeUser() {
  const email = `learned-${randomUUID()}@test.local`;
  const r = await db.query(
    `INSERT INTO users (email, password_hash)
     VALUES ($1, 'x') RETURNING user_id`,
    [email]
  );
  return r.rows[0].user_id;
}

test("save + list learned phrases: upsert bumps hits, list is owner-scoped", async () => {
  const userA = await makeUser();
  const userB = await makeUser();
  try {
    // Save a phrase twice → one row, hits bumped.
    for (let i = 0; i < 2; i += 1) {
      const res = makeRes();
      await controller.saveLearnedPhrase(
        { user: { userId: userA }, body: { phrase: "Squash it!", action: "stop" } },
        res
      );
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    }
    const row = await db.query(
      "SELECT phrase, action, hits FROM voice_learned_phrases WHERE user_id = $1",
      [userA]
    );
    assert.equal(row.rowCount, 1);
    assert.equal(row.rows[0].phrase, "squash it"); // normalized
    assert.equal(row.rows[0].action, "stop");
    assert.equal(row.rows[0].hits, 2);

    // Listing as another user returns nothing (owner-scoped).
    const resB = makeRes();
    await controller.getLearnedPhrases({ user: { userId: userB } }, resB);
    assert.equal(resB.statusCode, 200);
    assert.deepEqual(resB.body.phrases, []);

    // Listing as the owner returns the mapping.
    const resA = makeRes();
    await controller.getLearnedPhrases({ user: { userId: userA } }, resA);
    assert.equal(resA.statusCode, 200);
    assert.deepEqual(resA.body.phrases, [{ phrase: "squash it", action: "stop" }]);
  } finally {
    await db.query("DELETE FROM voice_learned_phrases WHERE user_id = ANY($1)", [
      [userA, userB],
    ]);
    await db.query("DELETE FROM users WHERE user_id = ANY($1)", [[userA, userB]]);
  }
});

test("saveLearnedPhrase rejects bad input with 400 (never persists)", async () => {
  const userId = await makeUser();
  const bad = [
    { phrase: "", action: "stop" },
    { phrase: "x", action: "stop" }, // too short
    { phrase: "one two three four five six seven", action: "stop" }, // >6 words
    { phrase: "squash it", action: "rm -rf" }, // action not in allowlist
    { phrase: "squash it", action: "" },
  ];
  try {
    for (const body of bad) {
      const res = makeRes();
      await controller.saveLearnedPhrase({ user: { userId }, body }, res);
      assert.equal(res.statusCode, 400, JSON.stringify(body));
    }
    const rows = await db.query(
      "SELECT 1 FROM voice_learned_phrases WHERE user_id = $1",
      [userId]
    );
    assert.equal(rows.rowCount, 0);
  } finally {
    await db.query("DELETE FROM users WHERE user_id = $1", [userId]);
  }
});
