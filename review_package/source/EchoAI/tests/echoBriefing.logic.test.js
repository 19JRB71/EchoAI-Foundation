// The weekly/daily briefings are spoken to the owner, so the deterministic pieces
// that shape what Echo says must be pinned: (a) normalizeList coerces the many
// shapes intelligence data arrives in (JSON string, array of strings, array of
// objects with different keys) into clean spoken strings and never throws;
// (b) hasActivity correctly distinguishes a live account from an empty one;
// (c) the weekly template speaks ONLY real gathered figures — the empty-week path
// never states counts, and the active path attributes/pluralizes correctly and
// includes the derived opportunities/risks. These are the AI-less fallbacks, so
// they must be correct on their own. Pure module — no DB, no AI, no network.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeList,
  hasActivity,
  templateWeekly,
} = require("../utils/echoBriefing");

// ---- normalizeList ----------------------------------------------------------

test("normalizeList passes through a clean array of strings", () => {
  assert.deepEqual(normalizeList(["a", "b"]), ["a", "b"]);
});

test("normalizeList parses a JSON-string array", () => {
  assert.deepEqual(normalizeList('["x","y"]'), ["x", "y"]);
});

test("normalizeList extracts text from objects by known keys", () => {
  const input = [
    { recommendation: "raise budget" },
    { opportunity: "retarget warm leads" },
    { title: "fix landing page" },
    { text: "call back the hot lead" },
    { summary: "trim wasted spend" },
    { trend: "rising CPL" },
  ];
  assert.deepEqual(normalizeList(input), [
    "raise budget",
    "retarget warm leads",
    "fix landing page",
    "call back the hot lead",
    "trim wasted spend",
    "rising CPL",
  ]);
});

test("normalizeList drops objects with no recognizable field", () => {
  assert.deepEqual(normalizeList([{ nope: 1 }, "keep", null, 42]), ["keep"]);
});

test("normalizeList on a non-JSON string returns it as a single clamped item", () => {
  assert.deepEqual(normalizeList("just a note"), ["just a note"]);
});

test("normalizeList returns [] for a non-array, non-string value", () => {
  assert.deepEqual(normalizeList({ a: 1 }), []);
  assert.deepEqual(normalizeList(null), []);
  assert.deepEqual(normalizeList(undefined), []);
});

test("normalizeList clamps very long strings to 200 chars", () => {
  const long = "z".repeat(500);
  const out = normalizeList([long]);
  assert.equal(out.length, 1);
  assert.equal(out[0].length, 200);
});

// ---- hasActivity ------------------------------------------------------------

test("hasActivity is false for an empty data object", () => {
  assert.equal(hasActivity({}), false);
  assert.equal(
    hasActivity({ newLeads: [], campaigns: [], followUpsCompleted: 0 }),
    false,
  );
});

test("hasActivity is true when any activity signal is present", () => {
  assert.equal(hasActivity({ newLeads: [{ id: 1 }] }), true);
  assert.equal(hasActivity({ todaysAppointments: [{ id: 1 }] }), true);
  assert.equal(hasActivity({ followUpsCompleted: 3 }), true);
  assert.equal(hasActivity({ campaigns: [{ id: 1 }] }), true);
  assert.equal(hasActivity({ sentinelFixes: [{ id: 1 }] }), true);
  assert.equal(hasActivity({ pendingApprovals: 2 }), true);
  assert.equal(hasActivity({ competitorNote: "a competitor moved" }), true);
});

// ---- templateWeekly ---------------------------------------------------------

test("empty week: warm welcome, no invented counts, prompts Facebook connect", () => {
  const text = templateWeekly("Sam", {
    isEmpty: true,
    facebookConnected: false,
  });
  assert.match(text, /Sam/);
  assert.match(text, /weekly strategy briefing/i);
  assert.match(text, /quiet week/i);
  assert.match(text, /Facebook/);
  // Must never state numeric counts on an empty week.
  assert.ok(!/\d/.test(text));
});

test("empty week with Facebook already connected omits the connect nudge", () => {
  const text = templateWeekly("Sam", {
    isEmpty: true,
    facebookConnected: true,
  });
  assert.ok(!/Facebook/.test(text));
});

test("active week: speaks real figures, pluralizes, ranks opps and risks", () => {
  const text = templateWeekly("Dana", {
    isEmpty: false,
    facebookConnected: true,
    newLeadsCount: 1,
    appointmentsCompleted: 2,
    followUpsCompleted: 0,
    sentinelFixes: 3,
    opportunities: ["double down on the winning campaign", "retarget warm leads"],
    risks: ["one campaign's cost per lead is climbing"],
  });
  assert.match(text, /Dana/);
  // Singular/plural agreement from the real counts.
  assert.match(text, /1 new lead\b/);
  assert.match(text, /2 appointments/);
  assert.match(text, /Sentinel fixed 3 issues/);
  // 0 follow-ups must not be spoken.
  assert.ok(!/follow-up/.test(text));
  // Opportunities + risks are rendered as an ordered spoken list.
  assert.match(text, /top opportunities/i);
  assert.match(text, /First,/);
  assert.match(text, /Second,/);
  assert.match(text, /Keep an eye on/i);
  assert.match(text, /Which one do you want to tackle first\?/);
});

test("active week caps opportunities and risks at three each", () => {
  const text = templateWeekly("Lee", {
    isEmpty: false,
    newLeadsCount: 5,
    opportunities: ["o1", "o2", "o3", "o4", "o5"],
    risks: ["r1", "r2", "r3", "r4"],
  });
  // Only three ordinals should appear (First/Second/Third), never a fourth.
  assert.ok(!/Fourth,/.test(text));
});
