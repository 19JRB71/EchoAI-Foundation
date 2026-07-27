/**
 * Echo Self-Review tests.
 *
 * - weekStartOf: always the Monday of the containing ISO week.
 * - parseAiReport: strict validation — bad JSON / missing summary / no valid
 *   recommendations all throw; impact normalizes; list caps at the max.
 * - gatherEvidence: read-only, never throws, honest readErrors array.
 * - runWeeklySelfReview: atomic weekly claim — completed weeks are never
 *   regenerated, running weeks are never doubled, failed weeks only rerun
 *   when explicitly asked (manual), and a rerun replaces the old items.
 * - generateReport: AI failure → honest 'failed' report WITH the gathered
 *   evidence persisted; success → status-guarded finalize + ranked items;
 *   out-of-band status change → no clobber.
 */
const test = require("node:test");
const assert = require("node:assert");

require("./dbGuard");
const db = require("../config/db");
const anthropicModule = require("../config/anthropic");
const selfReview = require("../utils/selfReview");
const {
  weekStartOf,
  parseAiReport,
  gatherEvidence,
  generateReport,
  runWeeklySelfReview,
  MAX_RECOMMENDATIONS,
} = selfReview;

const originalCreate = anthropicModule.anthropic.messages.create;

function stubAi(impl) {
  anthropicModule.anthropic.messages.create = async (params) => impl(params);
}
function restoreAi() {
  anthropicModule.anthropic.messages.create = originalCreate;
}

function aiJson(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj) }] };
}

const GOOD_REPORT = {
  summary: "A quiet week with a couple of SMS delivery problems.",
  recommendations: [
    {
      title: "Improve SMS error surfacing",
      recommendation: "Show permanent SMS failures more prominently.",
      evidence: "3 failed SMS, 2 permanent",
      impact: "high",
    },
    {
      title: "Investigate email probe",
      recommendation: "The email failure probe returned nothing this week.",
      evidence: "0 email failures recorded",
      impact: "weird-value",
    },
  ],
};

async function deleteWeek(weekStart) {
  await db.query("DELETE FROM self_review_reports WHERE week_start = $1", [weekStart]);
}

test.afterEach(() => restoreAi());
test.after(async () => {
  restoreAi();
  await deleteWeek(weekStartOf());
  await db.pool.end();
});

// ---------------------------------------------------------------------------
// weekStartOf
// ---------------------------------------------------------------------------

test("weekStartOf returns the Monday of the containing week", () => {
  assert.strictEqual(weekStartOf(new Date("2026-07-06T10:00:00Z")), "2026-07-06"); // Monday
  assert.strictEqual(weekStartOf(new Date("2026-07-09T23:59:00Z")), "2026-07-06"); // Thursday
  assert.strictEqual(weekStartOf(new Date("2026-07-12T00:00:00Z")), "2026-07-06"); // Sunday
  assert.strictEqual(weekStartOf(new Date("2026-07-13T00:00:00Z")), "2026-07-13"); // next Monday
});

// ---------------------------------------------------------------------------
// parseAiReport
// ---------------------------------------------------------------------------

test("parseAiReport accepts a valid report and normalizes impact", () => {
  const parsed = parseAiReport(JSON.stringify(GOOD_REPORT));
  assert.strictEqual(parsed.summary, GOOD_REPORT.summary);
  assert.strictEqual(parsed.items.length, 2);
  assert.strictEqual(parsed.items[0].rank, 1);
  assert.strictEqual(parsed.items[0].impact, "high");
  assert.strictEqual(parsed.items[1].impact, "medium"); // invalid value normalized
});

test("parseAiReport rejects garbage, missing summary, and empty recommendations", () => {
  assert.throws(() => parseAiReport("not json at all"), /no JSON/);
  assert.throws(() => parseAiReport("{ definitely broken"), /no JSON|unparseable/);
  assert.throws(
    () => parseAiReport(JSON.stringify({ recommendations: [{ title: "x", recommendation: "y" }] })),
    /missing summary/
  );
  assert.throws(
    () => parseAiReport(JSON.stringify({ summary: "ok", recommendations: [] })),
    /no valid recommendations/
  );
  assert.throws(
    () =>
      parseAiReport(
        JSON.stringify({ summary: "ok", recommendations: [{ title: "", recommendation: "" }] })
      ),
    /no valid recommendations/
  );
});

test("parseAiReport caps the list at MAX_RECOMMENDATIONS", () => {
  const many = Array.from({ length: MAX_RECOMMENDATIONS + 5 }, (_, i) => ({
    title: `Rec ${i}`,
    recommendation: "do it",
    impact: "low",
  }));
  const parsed = parseAiReport(JSON.stringify({ summary: "s", recommendations: many }));
  assert.strictEqual(parsed.items.length, MAX_RECOMMENDATIONS);
  assert.strictEqual(parsed.items[MAX_RECOMMENDATIONS - 1].rank, MAX_RECOMMENDATIONS);
});

// ---------------------------------------------------------------------------
// gatherEvidence
// ---------------------------------------------------------------------------

test("gatherEvidence is read-only, never throws, and reports readErrors honestly", async () => {
  const evidence = await gatherEvidence();
  assert.ok(Array.isArray(evidence.readErrors));
  assert.ok(Array.isArray(evidence.failedSocialPosts));
  assert.ok(Array.isArray(evidence.featureSuggestions));
  assert.ok(evidence.gatheredAt);
  assert.strictEqual(evidence.windowDays, selfReview.EVIDENCE_WINDOW_DAYS);
  // Against the real test schema every probe should read cleanly.
  assert.deepStrictEqual(evidence.readErrors, []);
});

// ---------------------------------------------------------------------------
// runWeeklySelfReview — atomic weekly claim
// ---------------------------------------------------------------------------

test("a completed week is never regenerated", async () => {
  const week = weekStartOf();
  await deleteWeek(week);
  await db.query(
    `INSERT INTO self_review_reports (week_start, status, summary, completed_at)
     VALUES ($1, 'completed', 'done already', NOW())`,
    [week]
  );
  try {
    let aiCalls = 0;
    stubAi(() => {
      aiCalls += 1;
      return aiJson(GOOD_REPORT);
    });
    const result = await runWeeklySelfReview({ rerunFailed: true });
    assert.strictEqual(result.status, "already_completed");
    assert.strictEqual(aiCalls, 0);
  } finally {
    await deleteWeek(week);
  }
});

test("a running week is not doubled", async () => {
  const week = weekStartOf();
  await deleteWeek(week);
  await db.query(`INSERT INTO self_review_reports (week_start) VALUES ($1)`, [week]);
  try {
    const result = await runWeeklySelfReview({ rerunFailed: true });
    assert.strictEqual(result.status, "already_running");
  } finally {
    await deleteWeek(week);
  }
});

test("a failed week reruns only when explicitly asked, replacing old items", async () => {
  const week = weekStartOf();
  await deleteWeek(week);
  const ins = await db.query(
    `INSERT INTO self_review_reports (week_start, status, error)
     VALUES ($1, 'failed', 'AI study failed: boom') RETURNING report_id`,
    [week]
  );
  const reportId = ins.rows[0].report_id;
  await db.query(
    `INSERT INTO self_review_items (report_id, rank, title, recommendation)
     VALUES ($1, 1, 'stale item', 'from the failed run')`,
    [reportId]
  );
  try {
    // Cron path (no rerun flag): leaves the failed report alone.
    const cronResult = await runWeeklySelfReview();
    assert.strictEqual(cronResult.status, "failed");
    const stale = await db.query(
      `SELECT COUNT(*)::int AS n FROM self_review_items WHERE report_id = $1`,
      [reportId]
    );
    assert.strictEqual(stale.rows[0].n, 1);

    // Manual rerun: resets, regenerates, replaces the items.
    stubAi(() => aiJson(GOOD_REPORT));
    const result = await runWeeklySelfReview({ rerunFailed: true });
    assert.strictEqual(result.status, "completed");
    assert.strictEqual(result.reportId, reportId);
    const row = (
      await db.query(`SELECT status, summary, error FROM self_review_reports WHERE report_id = $1`, [
        reportId,
      ])
    ).rows[0];
    assert.strictEqual(row.status, "completed");
    assert.strictEqual(row.summary, GOOD_REPORT.summary);
    assert.strictEqual(row.error, null);
    const items = (
      await db.query(
        `SELECT rank, title, impact FROM self_review_items WHERE report_id = $1 ORDER BY rank`,
        [reportId]
      )
    ).rows;
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].title, "Improve SMS error surfacing");
    assert.strictEqual(items[0].impact, "high");
  } finally {
    await deleteWeek(week);
  }
});

test("rerun reset is atomic: a failure mid-reset rolls back both the flip and the item delete", async () => {
  const week = weekStartOf();
  await deleteWeek(week);
  const ins = await db.query(
    `INSERT INTO self_review_reports (week_start, status, error)
     VALUES ($1, 'failed', 'AI study failed: boom') RETURNING report_id`,
    [week]
  );
  const reportId = ins.rows[0].report_id;
  await db.query(
    `INSERT INTO self_review_items (report_id, rank, title, recommendation)
     VALUES ($1, 1, 'stale item', 'from the failed run')`,
    [reportId]
  );
  const originalConnect = db.pool.connect.bind(db.pool);
  try {
    // First transaction (the rerun reset) gets a client whose DELETE throws —
    // simulating a crash between the status flip and the item cleanup.
    let sabotaged = false;
    db.pool.connect = (cb) => {
      // pool.query() uses the callback form internally — pass it through
      // untouched so ordinary db.query calls keep working.
      if (typeof cb === "function") return originalConnect(cb);
      return originalConnect().then((client) => {
        if (sabotaged) return client;
        sabotaged = true;
        const realQuery = client.query.bind(client);
        const realRelease = client.release.bind(client);
        client.query = async (text, params) => {
          if (typeof text === "string" && text.includes("DELETE FROM self_review_items")) {
            throw new Error("simulated crash mid-reset");
          }
          return realQuery(text, params);
        };
        // Un-patch before the client returns to the pool — a pooled client
        // with an async-only query wrapper drops pg's internal callbacks
        // and deadlocks every later pool.query on this connection.
        client.release = (...args) => {
          client.query = realQuery;
          client.release = realRelease;
          return realRelease(...args);
        };
        return client;
      });
    };
    await assert.rejects(
      () => runWeeklySelfReview({ rerunFailed: true }),
      /simulated crash mid-reset/
    );
    const row = (
      await db.query(`SELECT status, error FROM self_review_reports WHERE report_id = $1`, [
        reportId,
      ])
    ).rows[0];
    assert.strictEqual(row.status, "failed", "status flip rolled back — week not wedged");
    assert.match(row.error, /boom/);
    const items = await db.query(
      `SELECT COUNT(*)::int AS n FROM self_review_items WHERE report_id = $1`,
      [reportId]
    );
    assert.strictEqual(items.rows[0].n, 1, "stale items untouched by the rolled-back reset");
  } finally {
    db.pool.connect = originalConnect;
    await deleteWeek(week);
  }
});

test("a fresh week is claimed and completed end-to-end", async () => {
  const week = weekStartOf();
  await deleteWeek(week);
  try {
    stubAi(() => aiJson(GOOD_REPORT));
    const result = await runWeeklySelfReview();
    assert.strictEqual(result.status, "completed");
    const row = (
      await db.query(
        `SELECT status, summary, evidence FROM self_review_reports WHERE report_id = $1`,
        [result.reportId]
      )
    ).rows[0];
    assert.strictEqual(row.status, "completed");
    assert.ok(row.evidence, "evidence persisted");
    assert.ok(Array.isArray(row.evidence.readErrors));
  } finally {
    await deleteWeek(week);
  }
});

// ---------------------------------------------------------------------------
// generateReport — honesty + status guards
// ---------------------------------------------------------------------------

test("AI failure marks the report failed but keeps the gathered evidence", async () => {
  const week = weekStartOf();
  await deleteWeek(week);
  const ins = await db.query(
    `INSERT INTO self_review_reports (week_start) VALUES ($1) RETURNING report_id`,
    [week]
  );
  const reportId = ins.rows[0].report_id;
  try {
    stubAi(() => {
      const err = new Error("invalid x-api-key");
      err.status = 401;
      throw err;
    });
    const result = await generateReport(reportId);
    assert.strictEqual(result.status, "failed");
    const row = (
      await db.query(
        `SELECT status, error, evidence, summary FROM self_review_reports WHERE report_id = $1`,
        [reportId]
      )
    ).rows[0];
    assert.strictEqual(row.status, "failed");
    assert.match(row.error, /AI study failed/);
    assert.ok(row.evidence, "evidence persisted before the AI call");
    assert.strictEqual(row.summary, null);
  } finally {
    await deleteWeek(week);
  }
});

test("generateReport never clobbers a report changed out-of-band", async () => {
  const week = weekStartOf();
  await deleteWeek(week);
  const ins = await db.query(
    `INSERT INTO self_review_reports (week_start, status, summary, completed_at)
     VALUES ($1, 'completed', 'already done', NOW()) RETURNING report_id`,
    [week]
  );
  const reportId = ins.rows[0].report_id;
  try {
    stubAi(() => aiJson(GOOD_REPORT));
    const result = await generateReport(reportId);
    assert.strictEqual(result.status, "failed");
    assert.match(result.error, /out-of-band/);
    const row = (
      await db.query(`SELECT status, summary FROM self_review_reports WHERE report_id = $1`, [
        reportId,
      ])
    ).rows[0];
    assert.strictEqual(row.status, "completed");
    assert.strictEqual(row.summary, "already done");
    const items = await db.query(
      `SELECT COUNT(*)::int AS n FROM self_review_items WHERE report_id = $1`,
      [reportId]
    );
    assert.strictEqual(items.rows[0].n, 0, "no items written when finalize misses");
  } finally {
    await deleteWeek(week);
  }
});
