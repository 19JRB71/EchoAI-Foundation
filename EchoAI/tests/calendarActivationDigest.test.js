// 026-C1 Stage 2 — unit tests for the pure activation artifact/digest module.
// No DB: classifyDrafts/computeActivationDigest/summarizeArtifact are pure.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  ACTIVATION_LEAD_MS,
  classifyDrafts,
  computeActivationDigest,
  summarizeArtifact,
} = require("../utils/calendarActivationDigest");

const NOW = new Date("2026-08-15T12:00:00.000Z");
const FUTURE = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(); // +1h
const NEAR = new Date(NOW.getTime() + 2 * 60 * 1000).toISOString(); // +2min (< lead)
const PAST = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(); // -1h

const FB_BINDING = { platform: "facebook", destination: "page-123" };

function draft(id, time, platform = "facebook") {
  return { post_id: id, platform, scheduled_time: time };
}

test("future bound draft is eligible with its destination", () => {
  const { eligible, excludedStale, excludedUnbound } = classifyDrafts({
    drafts: [draft("a", FUTURE)],
    bindings: [FB_BINDING],
    now: NOW,
  });
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0].postId, "a");
  assert.equal(eligible[0].destination, "page-123");
  assert.equal(excludedStale.length, 0);
  assert.equal(excludedUnbound.length, 0);
});

test("past and inside-lead-window drafts are excluded as stale", () => {
  const { eligible, excludedStale } = classifyDrafts({
    drafts: [draft("p", PAST), draft("n", NEAR), draft("f", FUTURE)],
    bindings: [FB_BINDING],
    now: NOW,
  });
  assert.deepEqual(eligible.map((e) => e.postId), ["f"]);
  assert.deepEqual(excludedStale.map((e) => e.postId).sort(), ["n", "p"]);
  assert.ok(ACTIVATION_LEAD_MS >= 5 * 60 * 1000 - 1);
});

test("a draft on an unbound platform is excluded as unbound, and unbound wins over stale", () => {
  const { eligible, excludedStale, excludedUnbound } = classifyDrafts({
    drafts: [draft("u", FUTURE, "instagram"), draft("both", PAST, "instagram")],
    bindings: [FB_BINDING],
    now: NOW,
  });
  assert.equal(eligible.length, 0);
  // 'both' is past AND unbound: the missing destination is the truer reason.
  assert.deepEqual(excludedUnbound.map((e) => e.postId).sort(), ["both", "u"]);
  assert.equal(excludedStale.length, 0);
});

test("digest is order-independent and deterministic", () => {
  const a = { postId: "a", scheduledTime: FUTURE, platform: "facebook", destination: "page-123" };
  const b = { postId: "b", scheduledTime: FUTURE, platform: "facebook", destination: "page-123" };
  assert.equal(computeActivationDigest([a, b]), computeActivationDigest([b, a]));
  assert.match(computeActivationDigest([a, b]), /^[0-9a-f]{64}$/);
});

test("digest changes when any artifact component changes", () => {
  const base = { postId: "a", scheduledTime: FUTURE, platform: "facebook", destination: "page-123" };
  const d0 = computeActivationDigest([base]);
  assert.notEqual(d0, computeActivationDigest([{ ...base, scheduledTime: NEAR }]));
  assert.notEqual(d0, computeActivationDigest([{ ...base, destination: "page-999" }]));
  assert.notEqual(d0, computeActivationDigest([{ ...base, postId: "b" }]));
  assert.notEqual(d0, computeActivationDigest([]));
});

test("the empty artifact has a stable digest (no-draft calendars may re-activate)", () => {
  assert.equal(computeActivationDigest([]), computeActivationDigest([]));
});

test("summarizeArtifact reports truthful counts, range, destinations, and the eligible set", () => {
  const later = new Date(NOW.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const classified = classifyDrafts({
    drafts: [
      draft("a", FUTURE),
      draft("b", later),
      draft("stale", NEAR),
      draft("unbound", FUTURE, "instagram"),
    ],
    bindings: [FB_BINDING],
    now: NOW,
  });
  const art = summarizeArtifact(classified);
  assert.equal(art.eligibleCount, 2);
  assert.equal(art.firstScheduledTime, FUTURE);
  assert.equal(art.lastScheduledTime, later);
  assert.deepEqual(art.platforms, ["facebook"]);
  assert.deepEqual(art.destinations, { facebook: "page-123" });
  assert.equal(art.excludedStaleCount, 1);
  assert.equal(art.excludedUnboundCount, 1);
  assert.equal(art.digest, computeActivationDigest(art.eligible));
  // The full eligible set rides along for the activation transaction.
  assert.deepEqual(art.eligible.map((e) => e.postId).sort(), ["a", "b"]);
});
