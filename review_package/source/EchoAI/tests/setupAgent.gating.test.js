// Task: prove Enterprise onboarding unlocks its exclusive setup steps (and that
// lower tiers skip them gracefully). Pure unit tests over the tier-gate decision —
// no database or AI required.

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { ACTIONS, isActionAllowed } = require("../controllers/setupAgentController");
const { FEATURES } = require("../config/tiers");
const { db } = require("./helpers");

after(async () => {
  await db.pool.end();
});

// The "exclusive" setup steps are the ones gated behind a paid feature; baseline
// steps (no feature) run on every plan.
const gated = ACTIONS.filter((a) => a.feature);
const baseline = ACTIONS.filter((a) => !a.feature);

test("there are exclusive (gated) setup steps to unlock", () => {
  assert.ok(gated.length > 0, "expected at least one tier-gated setup step");
});

test("Enterprise unlocks every exclusive setup step", () => {
  for (const a of gated) {
    assert.equal(
      isActionAllowed(a, "enterprise", "user"),
      true,
      `Enterprise should unlock "${a.key}" (needs ${FEATURES[a.feature].tier})`,
    );
  }
});

test("Starter does NOT unlock the exclusive setup steps (skipped gracefully)", () => {
  for (const a of gated) {
    assert.equal(
      isActionAllowed(a, "starter", "user"),
      false,
      `Starter should not unlock "${a.key}"`,
    );
  }
});

test("baseline setup steps run on every plan", () => {
  for (const a of baseline) {
    assert.equal(isActionAllowed(a, "free", "user"), true, `${a.key} should always run`);
    assert.equal(isActionAllowed(a, "starter", "user"), true, `${a.key} should always run`);
  }
});

test("admins bypass every gate", () => {
  for (const a of ACTIONS) {
    assert.equal(isActionAllowed(a, "free", "admin"), true, `admin should bypass gate for ${a.key}`);
  }
});

test("an action with an unknown feature key fails closed (never unlocks)", () => {
  const bogus = { key: "bogus", label: "Bogus", feature: "does_not_exist" };
  assert.equal(
    isActionAllowed(bogus, "enterprise", "user"),
    false,
    "an unknown feature key must never unlock a gated action",
  );
  // admins still bypass everything, even a misconfigured action
  assert.equal(isActionAllowed(bogus, "free", "admin"), true);
});
