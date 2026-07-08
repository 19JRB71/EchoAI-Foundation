const test = require("node:test");
const assert = require("node:assert");

// Regression test: metric SQL that only references $1 (the "latest" rate
// metrics such as ctr) must not be sent a second bind parameter — Postgres
// rejects the query with "bind message supplies 2 parameters, but prepared
// statement requires 1". This broke /api/goals/* in production for any brand
// with a ctr goal. We stub db.query to capture every (sql, params) pair and
// assert the param count always matches the highest placeholder in the SQL.

const db = require("../config/db");
const { measureMetric } = require("../utils/goalMetrics");
const { GOAL_METRICS } = require("../config/goals");

function highestPlaceholder(sql) {
  let max = 0;
  for (const m of sql.matchAll(/\$(\d+)/g)) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
}

test("measureMetric binds exactly as many params as each metric's SQL uses", async () => {
  const captured = [];
  const original = db.query;
  db.query = async (sql, params) => {
    captured.push({ sql, params });
    return { rows: [] };
  };
  try {
    for (const key of Object.keys(GOAL_METRICS)) {
      await measureMetric("00000000-0000-0000-0000-000000000000", key);
    }
  } finally {
    db.query = original;
  }

  assert.ok(captured.length > 0, "expected at least one metric query");
  for (const { sql, params } of captured) {
    const needed = highestPlaceholder(sql);
    assert.strictEqual(
      params.length,
      needed,
      `SQL uses $1..$${needed} but got ${params.length} params:\n${sql}`,
    );
  }
});
