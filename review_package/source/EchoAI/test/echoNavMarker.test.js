// [[NAVIGATE: target]] marker resolution — the navigation-truthfulness fix.
// Echo may only claim to take the owner somewhere when a VALID marker is
// present (the client then performs the real navigation); an unknown target
// must never leave "taking you there" text behind.
const test = require("node:test");
const assert = require("node:assert");

process.env.NODE_ENV = "test";

const {
  _resolveNavMarkerForTests: resolveNavMarker,
  _navTargetKeysForTests: NAV_TARGET_KEYS,
} = require("../controllers/echoCompanionController.js");

test("valid target: marker stripped, text kept, navigateTo set", () => {
  const r = resolveNavMarker("Taking you to Atlas now, Sir. [[NAVIGATE: dept:atlas]]");
  assert.strictEqual(r.navigateTo, "dept:atlas");
  assert.strictEqual(r.reply, "Taking you to Atlas now, Sir.");
  assert.ok(!r.reply.includes("[["));
});

test("valid target with empty visible reply gets a confirmation", () => {
  const r = resolveNavMarker("[[NAVIGATE: leads]]");
  assert.strictEqual(r.navigateTo, "leads");
  assert.strictEqual(r.reply, "Taking you there now.");
});

test("target is case/whitespace normalized", () => {
  const r = resolveNavMarker("On my way. [[NAVIGATE:  Dept:Atlas ]]");
  assert.strictEqual(r.navigateTo, "dept:atlas");
});

test("UNKNOWN target: no navigateTo AND no false navigation claim survives", () => {
  const r = resolveNavMarker("Taking you to the moon now! [[NAVIGATE: moonbase]]");
  assert.strictEqual(r.navigateTo, null);
  assert.ok(!/taking you|opening|heading (to|over)/i.test(r.reply), `false claim leaked: "${r.reply}"`);
  assert.ok(!r.reply.includes("[["));
  assert.ok(r.reply.length > 0);
});

test("no marker: reply passes through untouched", () => {
  const r = resolveNavMarker("Your leads look great today, Sir.");
  assert.strictEqual(r.navigateTo, null);
  assert.strictEqual(r.reply, "Your leads look great today, Sir.");
});

test("allowlist contains the core section, dept, and action keys", () => {
  for (const key of ["missioncontrol", "leads", "campaigns", "googleseo", "echoemail", "dept:atlas", "dept:sage", "action:facebook"]) {
    assert.ok(NAV_TARGET_KEYS.has(key), `missing nav key: ${key}`);
  }
});
