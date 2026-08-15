/**
 * Prompt 035 Stage 2 — Section L: timing instrumentation math.
 *
 * The four figures (surface-open, focused-open, input-engaged, inferred-idle)
 * must be computed with honest interval math and NEVER truncated: idle time
 * is classified and reported, not erased. System waits are paired
 * start/end intervals, merged per kind. All DB access is stubbed — this file
 * tests the arithmetic contract, not Postgres.
 *
 * Run with:  node --test test/p035.timing.test.js
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const db = require("../config/db");
const timing = require("../utils/onboardingTiming");

const T0 = Date.parse("2026-08-15T10:00:00Z");
const iso = (offsetS) => new Date(T0 + offsetS * 1000).toISOString();
const ev = (kind, offsetS, meta) => ({ event_kind: kind, at: iso(offsetS), meta: meta || null });

function withDb(rowsByCall, fn) {
  const original = db.query;
  let call = 0;
  db.query = async () => ({ rows: rowsByCall[Math.min(call++, rowsByCall.length - 1)] });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      db.query = original;
    });
}

test("interval helpers merge, intersect, and subtract correctly", () => {
  assert.deepEqual(timing._mergeIntervals([[0, 10], [5, 20], [30, 40]]), [[0, 20], [30, 40]]);
  assert.deepEqual(timing._intersect([[0, 20]], [[10, 30]]), [[10, 20]]);
  assert.deepEqual(timing._subtract([[0, 20]], [[5, 10]]), [[0, 5], [10, 20]]);
});

test("unterminated intervals close at last observed event — never extended", () => {
  const events = [
    { event_kind: "surface_shown", t: 0 },
    { event_kind: "activity", t: 5000 },
  ];
  const pairs = timing._pairIntervals(events, "surface_shown", "surface_hidden", 5000);
  assert.deepEqual(pairs, [[0, 5000]]);
});

test("timing.fourFiguresNoTruncation — a 10-minute session reports ALL time, classified", async () => {
  // Surface open 0..600s; focused 0..600s; activity at 30s and 90s
  // (engagement window 60s each → engaged 30..150s = 120s); everything else
  // inside focus is inferred idle (480s). Nothing truncated:
  // engaged + idle must equal focused exactly.
  const events = [
    ev("surface_shown", 0),
    ev("focus", 0),
    ev("activity", 30),
    ev("activity", 90),
    ev("system_wait_start", 100, { waitKind: "research" }),
    ev("system_wait_end", 220, { waitKind: "research" }),
    ev("milestone", 590, { name: "campaign_ready" }),
    ev("surface_hidden", 600),
  ];
  await withDb(
    [events, [{ created_at: new Date(T0 - 60_000).toISOString() }]],
    async () => {
      const s = await timing.computeSummary("u1");
      assert.equal(s.surfaceOpenMs, 600_000);
      assert.equal(s.focusedOpenMs, 600_000);
      assert.equal(s.inputEngagedMs, 120_000);
      assert.equal(s.inferredIdleMs, 480_000);
      // No truncation: the classification is a partition of focused time.
      assert.equal(s.inputEngagedMs + s.inferredIdleMs, s.focusedOpenMs);
      assert.equal(s.systemWaits.researchMs, 120_000);
      assert.equal(s.systemWaits.company_truthMs, 0);
      assert.equal(s.systemWaits.oauthMs, 0);
      // Wall clock = signup (T0-60s) → campaign_ready milestone (T0+590s).
      assert.equal(s.wallClockMs, 650_000);
      // Assumptions are DISCLOSED in the payload itself.
      assert.equal(s.assumptions.engagementWindowSeconds, timing.ENGAGE_WINDOW_S);
      assert.match(s.assumptions.truncation, /never truncated/);
      assert.match(s.assumptions.unterminatedIntervalRule, /last observed event/);
    },
  );
});

test("blurred-but-open time counts as surface-open, not focused", async () => {
  const events = [
    ev("surface_shown", 0),
    ev("focus", 0),
    ev("blur", 100),
    ev("focus", 300),
    ev("surface_hidden", 400),
  ];
  await withDb([events, [{ created_at: iso(0) }]], async () => {
    const s = await timing.computeSummary("u1");
    assert.equal(s.surfaceOpenMs, 400_000);
    assert.equal(s.focusedOpenMs, 200_000); // 0-100 + 300-400
    assert.equal(s.wallClockMs, null); // no milestone → honest null, never fabricated
  });
});

test("recordEvents rejects unknown kinds and oversized batches", async () => {
  await assert.rejects(
    () => timing.recordEvents("u1", [{ kind: "made_up", at: iso(0) }]),
    /kind/i,
  );
  const big = Array.from({ length: 101 }, () => ({ kind: "activity", at: iso(0) }));
  await assert.rejects(() => timing.recordEvents("u1", big), /100|batch/i);
});
