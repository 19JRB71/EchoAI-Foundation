const test = require("node:test");
const assert = require("node:assert");

// Mission Control V2 aggregation — logic tests with db.query stubbed, so they
// verify the honesty rules (no fabricated deltas, null score without goals),
// the KPI summation, attention normalization, and that every query binds
// exactly the parameters its SQL declares.

const db = require("../config/db");
const mc = require("../controllers/missionControlV2Controller");

function highestPlaceholder(sql) {
  let max = 0;
  for (const m of sql.matchAll(/\$(\d+)/g)) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
}

function stubDb(handler) {
  const original = db.query;
  db.query = handler;
  return () => {
    db.query = original;
  };
}

test("letterGrade maps scores to honest grades and null stays null", () => {
  assert.equal(mc.letterGrade(null), null);
  assert.equal(mc.letterGrade(98), "A+");
  assert.equal(mc.letterGrade(93), "A");
  assert.equal(mc.letterGrade(90), "A-");
  assert.equal(mc.letterGrade(85), "B");
  assert.equal(mc.letterGrade(75), "C");
  assert.equal(mc.letterGrade(65), "D");
  assert.equal(mc.letterGrade(12), "F");
});

test("delta is null without a real baseline — never a fabricated percentage", () => {
  assert.equal(mc.delta(5, 0), null);
  assert.equal(mc.delta(5, null), null);
  assert.equal(mc.delta(0, 0), null);
  assert.equal(mc.delta(10, 5), 100);
  assert.equal(mc.delta(5, 10), -50);
  assert.equal(mc.delta(7, 7), 0);
});

test("computeKpis sums real per-day counts and binds params correctly", async () => {
  const captured = [];
  const restore = stubDb(async (sql, params) => {
    captured.push({ sql, params });
    // Every count query returns 2 today / 1 yesterday based on the date bucket.
    const isToday = sql.includes("CURRENT_DATE") && !sql.includes("CURRENT_DATE - 1");
    return { rows: [{ n: isToday ? 2 : 1 }] };
  });
  try {
    const kpis = await mc.computeKpis("00000000-0000-0000-0000-000000000001");
    const byKey = Object.fromEntries(kpis.map((k) => [k.key, k]));

    // 8 real action sources x 2/day → tasksCompleted 16 today, 8 yesterday.
    assert.equal(byKey.tasksCompleted.today, 16);
    assert.equal(byKey.tasksCompleted.yesterday, 8);
    assert.equal(byKey.tasksCompleted.deltaPct, 100);
    assert.equal(byKey.appointmentsBooked.today, 2);
    assert.equal(byKey.callsAnswered.deltaPct, 100);
    assert.ok(byKey.leadsFollowedUp);

    for (const { sql, params } of captured) {
      assert.equal(
        params.length,
        highestPlaceholder(sql),
        `param count mismatch for: ${sql.slice(0, 80)}`,
      );
      assert.ok(!sql.includes("__DAY__"), "date bucket must be substituted");
    }
  } finally {
    restore();
  }
});

test("computeKpis returns [] without a brand — reserved space, not zeros", async () => {
  const restore = stubDb(async () => {
    throw new Error("must not query without a brand");
  });
  try {
    assert.deepEqual(await mc.computeKpis(null), []);
  } finally {
    restore();
  }
});

test("computeZorechoScore is null (not 0) when no goals exist", async () => {
  const restore = stubDb(async (sql) => {
    if (sql.includes("FROM brands")) return { rows: [] };
    return { rows: [] };
  });
  try {
    const s = await mc.computeZorechoScore("00000000-0000-0000-0000-000000000002", null);
    assert.equal(s.score, null);
    assert.equal(s.grade, null);
    assert.equal(s.label, null);
    assert.deepEqual(s.history, []);
  } finally {
    restore();
  }
});

test("computeActivityFeed merges real events newest-first and drops null timestamps", async () => {
  const now = Date.now();
  const restore = stubDb(async (sql) => {
    if (sql.includes("FROM social_posts")) {
      return { rows: [{ platform: "facebook", ts: new Date(now - 60000) }] };
    }
    if (sql.includes("FROM leads")) {
      return { rows: [{ lead_name: "Jane", source: "chatbot", ts: new Date(now - 5000) }] };
    }
    if (sql.includes("FROM calls")) {
      return { rows: [{ direction: "inbound", outcome: "booked", ts: null }] };
    }
    return { rows: [] };
  });
  try {
    const feed = await mc.computeActivityFeed("u1", "b1");
    assert.equal(feed.length, 2, "null-timestamp events must be dropped");
    assert.equal(feed[0].agentId, "pulse", "newest event first");
    assert.equal(feed[1].agentId, "nova");
    assert.match(feed[0].text, /new lead/);
  } finally {
    restore();
  }
});

test("buildAttention normalizes real signals with severity-based priority", () => {
  const items = mc.buildAttention({
    agents: [
      { id: "atlas", name: "Atlas", status: "attention", currentTask: "Needs Facebook connected to run ads", section: "adstudio" },
      { id: "nova", name: "Nova", status: "active", currentTask: "ok", section: "social" },
    ],
    failedPosts: [
      { postId: "p1", platform: "facebook", reason: "Token expired", failedAt: "2026-07-12T10:00:00Z" },
    ],
    goalAlerts: [
      { alertId: "g1", kind: "at_risk", label: "New leads", percentToGoal: 40, muted: false, createdAt: "2026-07-12T09:00:00Z" },
      { alertId: "g2", kind: "at_risk", label: "Muted goal", percentToGoal: 10, muted: true, createdAt: "2026-07-12T09:00:00Z" },
      { alertId: "g3", kind: "hit", label: "Calls", percentToGoal: 100, muted: false, createdAt: "2026-07-12T09:00:00Z" },
    ],
    sageUrgent: [{ feed_id: "s1", summary: "Competitor launched aggressive campaign", ts: "2026-07-12T08:00:00Z" }],
  });

  const types = items.map((i) => i.type);
  assert.deepEqual(types, ["failed_post", "agent", "goal", "sage"]);
  assert.equal(items[0].priority, "high");
  assert.equal(items[1].priority, "high");
  assert.match(items[1].text, /Atlas/);
  assert.equal(items.filter((i) => i.type === "goal").length, 1, "muted and hit goals excluded");
  assert.equal(items[2].priority, "medium");
});
