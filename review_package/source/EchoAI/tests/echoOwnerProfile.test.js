// Task: prove the two owner-profile write semantics are distinct and correct:
//   - setOwnerProfileRow (manual owner edit) is AUTHORITATIVE: an empty string
//     CLEARS the stored column, so the owner can correct what Echo "knows".
//   - mergeOwnerProfileRow (AI-learned) only overwrites with non-empty values,
//     so Echo never blanks a field it simply didn't mention this turn.
// Runs against the isolated test DB via the app's own db module.

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { db, createTestUser, deleteUser } = require("./helpers");
const echoContext = require("../utils/echoContext");

const users = [];
async function freshUser() {
  const id = await createTestUser();
  users.push(id);
  return id;
}

after(async () => {
  for (const id of users) await deleteUser(id);
  await db.pool.end();
});

test("setOwnerProfileRow clears a previously set field when given an empty string", async () => {
  const userId = await freshUser();

  await echoContext.setOwnerProfileRow(userId, {
    goals: "hit $50k MRR",
    values: "integrity",
    riskTolerance: "cautious",
  });

  let row = await echoContext.getOwnerProfileRow(userId);
  assert.equal(row.goals, "hit $50k MRR");
  assert.equal(row.core_values, "integrity");
  assert.equal(row.risk_tolerance, "cautious");

  // Owner corrects the record: clears goals, keeps values, changes risk.
  await echoContext.setOwnerProfileRow(userId, {
    goals: "",
    values: "integrity",
    riskTolerance: "bold",
  });

  row = await echoContext.getOwnerProfileRow(userId);
  assert.equal(row.goals, null, "empty string must CLEAR goals to NULL");
  assert.equal(row.core_values, "integrity");
  assert.equal(row.risk_tolerance, "bold");
});

test("mergeOwnerProfileRow (AI-learned) never blanks an existing field with empties", async () => {
  const userId = await freshUser();

  await echoContext.setOwnerProfileRow(userId, {
    goals: "grow the team",
    values: "customer-first",
  });

  // Echo "learned" only a new preference this turn; it did not mention goals.
  await echoContext.mergeOwnerProfileRow(userId, {
    preferences: "prefers short updates",
    goals: "", // absent-this-turn must NOT wipe the stored goal
  });

  const row = await echoContext.getOwnerProfileRow(userId);
  assert.equal(row.goals, "grow the team", "AI merge must preserve unmentioned fields");
  assert.equal(row.core_values, "customer-first");
  assert.equal(row.preferences, "prefers short updates");
});
