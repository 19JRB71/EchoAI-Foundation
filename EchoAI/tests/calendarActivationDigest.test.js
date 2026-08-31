// 026-C1 Stage 2 — unit tests for the pure activation artifact/digest module.
// No DB: classifyDrafts/computeActivationDigest/summarizeArtifact are pure.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  ACTIVATION_LEAD_MS,
  ACTIVATION_DIGEST_DOMAIN,
  ACTIVATION_DIGEST_VERSION,
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
  return {
    post_id: id,
    platform,
    scheduled_time: time,
    post_content: `content ${id}`,
    image_url: null,
    video_url: null,
  };
}

function artifact(calendarId, eligible, excludedStale = [], excludedUnbound = []) {
  return { calendarId, eligible, excludedStale, excludedUnbound };
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
  assert.equal(eligible[0].postContent, "content a");
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
  assert.ok(excludedUnbound.every((e) => e.reason === "unbound"));
  assert.equal(excludedStale.length, 0);
});

test("digest is order-independent and deterministic", () => {
  const a = {
    postId: "a", scheduledTime: FUTURE, platform: "facebook", destination: "page-123",
    postContent: "A | arbitrary\ncontent", imageUrl: null, videoUrl: "video-a",
  };
  const b = {
    postId: "b", scheduledTime: FUTURE, platform: "facebook", destination: "page-123",
    postContent: "B", imageUrl: "image-b", videoUrl: null,
  };
  const exclusions = {
    excludedStale: [{ postId: "s", reason: "stale" }],
    excludedUnbound: [{ postId: "u", reason: "unbound" }],
  };
  const first = computeActivationDigest(artifact("calendar-1", [a, b], exclusions.excludedStale, exclusions.excludedUnbound));
  const reordered = computeActivationDigest(
    artifact("calendar-1", [b, a], [...exclusions.excludedStale].reverse(), [...exclusions.excludedUnbound].reverse()),
  );
  assert.equal(first, reordered);
  assert.equal(ACTIVATION_DIGEST_DOMAIN, "echoai.calendar-activation");
  assert.equal(ACTIVATION_DIGEST_VERSION, 2);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test("digest changes for calendar identity and every eligible authorization field", () => {
  const base = {
    postId: "a", scheduledTime: FUTURE, platform: "facebook", destination: "page-123",
    postContent: "copy", imageUrl: "image", videoUrl: "video",
  };
  const digest = (calendarId, row) => computeActivationDigest(artifact(calendarId, [row]));
  const d0 = digest("calendar-1", base);
  assert.notEqual(d0, digest("calendar-2", base));
  for (const [field, value] of [
    ["postId", "b"],
    ["scheduledTime", NEAR],
    ["platform", "instagram"],
    ["destination", "page-999"],
    ["postContent", "edited copy"],
    ["imageUrl", "other-image"],
    ["videoUrl", "other-video"],
  ]) {
    assert.notEqual(d0, digest("calendar-1", { ...base, [field]: value }), field);
  }
});

test("exact exclusion membership and reason are digest-bound", () => {
  const empty = artifact("calendar-1", []);
  const d0 = computeActivationDigest(empty);
  assert.notEqual(
    d0,
    computeActivationDigest(artifact("calendar-1", [], [{ postId: "s", reason: "stale" }])),
  );
  assert.notEqual(
    d0,
    computeActivationDigest(artifact("calendar-1", [], [], [{ postId: "u", reason: "unbound" }])),
  );
  assert.notEqual(
    computeActivationDigest(artifact("calendar-1", [], [{ postId: "x", reason: "stale" }])),
    computeActivationDigest(artifact("calendar-1", [], [], [{ postId: "x", reason: "unbound" }])),
  );
});

test("operational fields are excluded and the empty artifact is calendar-bound and stable", () => {
  const base = {
    postId: "a", scheduledTime: FUTURE, platform: "facebook", destination: "page-123",
    postContent: "copy", imageUrl: null, videoUrl: null,
  };
  const d0 = computeActivationDigest(artifact("calendar-1", [base]));
  assert.equal(
    d0,
    computeActivationDigest(artifact("calendar-1", [{
      ...base,
      status: "publishing",
      publishAttempts: 99,
      externalPostId: "provider-1",
      engagementMetrics: { clicks: 3 },
      createdAt: "yesterday",
    }])),
  );
  assert.equal(computeActivationDigest(artifact("calendar-1", [])), computeActivationDigest(artifact("calendar-1", [])));
  assert.notEqual(computeActivationDigest(artifact("calendar-1", [])), computeActivationDigest(artifact("calendar-2", [])));
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
  const art = summarizeArtifact({ calendarId: "calendar-1", ...classified });
  assert.equal(art.eligibleCount, 2);
  assert.equal(art.firstScheduledTime, FUTURE);
  assert.equal(art.lastScheduledTime, later);
  assert.deepEqual(art.platforms, ["facebook"]);
  assert.deepEqual(art.destinations, { facebook: "page-123" });
  assert.equal(art.excludedStaleCount, 1);
  assert.equal(art.excludedUnboundCount, 1);
  assert.equal(
    art.digest,
    computeActivationDigest({
      calendarId: "calendar-1",
      eligible: art.eligible,
      excludedStale: art.excludedStale,
      excludedUnbound: art.excludedUnbound,
    }),
  );
  // The full eligible set rides along for the activation transaction.
  assert.deepEqual(art.eligible.map((e) => e.postId).sort(), ["a", "b"]);
});
