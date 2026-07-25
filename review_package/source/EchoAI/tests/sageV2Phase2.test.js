// Sage V2 Phase 2 — canonical intel store, redaction, job queue, input-hash
// skip gates, data-quality sentry. All four flags default OFF; these tests
// flip them via process.env (aiControls checks env after DB overrides) and
// always restore afterwards.
require("./dbGuard");

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const db = require("../config/db");

const intelStore = require("../utils/intelStore");
const { redactText, redactItemFields } = require("../utils/intelRedaction");
const inputHash = require("../utils/inputHash");
const jobQueue = require("../utils/jobQueue");
const { gateJob } = require("../utils/skipGates");
const sentry = require("../utils/dataQualitySentry");

function withFlag(name, value, fn) {
  return async () => {
    const prev = process.env[name];
    process.env[name] = value;
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env[name];
      else process.env[name] = prev;
    }
  };
}

async function createBrand() {
  const email = `sagev2-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const u = await db.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING user_id",
    [email],
  );
  const b = await db.query(
    "INSERT INTO brands (user_id, brand_name) VALUES ($1, 'SageV2 Test Brand') RETURNING brand_id",
    [u.rows[0].user_id],
  );
  return { userId: u.rows[0].user_id, brandId: b.rows[0].brand_id };
}

async function deleteUser(userId) {
  await db.query("DELETE FROM users WHERE user_id = $1", [userId]);
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------
test("redactText strips emails and phone numbers but keeps prices/years", () => {
  const r = redactText(
    "Contact jane.doe@example.com or +1 (555) 123-4567; deal worth $12,000 closes in 2026.",
  );
  assert.ok(!r.text.includes("jane.doe@example.com"));
  assert.ok(!r.text.includes("555"));
  assert.ok(r.text.includes("[email removed]"));
  assert.ok(r.text.includes("[phone removed]"));
  assert.ok(r.text.includes("$12,000"));
  assert.ok(r.text.includes("2026"));
  assert.strictEqual(r.redacted, true);
});

test("redactItemFields cleans summary/why_it_matters/source_title only", () => {
  const { item, redacted } = redactItemFields({
    summary: "Lead reachable at bob@corp.io",
    why_it_matters: "Call 555-123-4567 today",
    source_title: "clean title",
    url: "https://x.test/a@b.com-not-touched",
  });
  assert.strictEqual(redacted, true);
  assert.ok(item.summary.includes("[email removed]"));
  assert.ok(item.why_it_matters.includes("[phone removed]"));
  assert.strictEqual(item.source_title, "clean title");
  assert.strictEqual(item.url, "https://x.test/a@b.com-not-touched");
});

// ---------------------------------------------------------------------------
// Intel store flag routing
// ---------------------------------------------------------------------------
test(
  "feedTarget returns the legacy feed with the flag off",
  withFlag("SAGE_V2_INTEL_STORE", "false", async () => {
    const t = await intelStore.feedTarget();
    assert.strictEqual(t.table, "sage_intelligence_feed");
    assert.strictEqual(t.idCol, "feed_id");
  }),
);

test(
  "feedTarget returns sage_intel_items with the flag on (and backfills)",
  withFlag("SAGE_V2_INTEL_STORE", "true", async () => {
    intelStore._resetBackfillForTests();
    const t = await intelStore.feedTarget();
    assert.strictEqual(t.table, "sage_intel_items");
    assert.strictEqual(t.idCol, "item_id");
  }),
);

test(
  "saveIntelItem redacts, dedups by signal_key, and honors dismissed-stays-dismissed",
  withFlag("SAGE_V2_INTEL_STORE", "true", async () => {
    const { userId, brandId } = await createBrand();
    try {
      const sig = `test:signal:${crypto.randomUUID()}`;
      await intelStore.saveIntelItem(brandId, {
        source_type: "trend",
        summary: `Ping me at owner@leak.com about the new pricing ${crypto.randomUUID()}`,
        why_it_matters: "matters",
        signal_key: sig,
        urgent: false,
      });
      let r = await db.query(
        "SELECT * FROM sage_intel_items WHERE brand_id = $1 AND signal_key = $2",
        [brandId, sig],
      );
      assert.strictEqual(r.rows.length, 1);
      assert.ok(r.rows[0].summary.includes("[email removed]"), "summary must be redacted at write");
      assert.strictEqual(r.rows[0].confidence, "reported");

      // Same signal_key again => update in place, still one row.
      await intelStore.saveIntelItem(brandId, {
        source_type: "trend",
        summary: `Updated finding ${crypto.randomUUID()}`,
        why_it_matters: "still matters",
        signal_key: sig,
        urgent: true,
        confidence: "verified",
      });
      r = await db.query(
        "SELECT * FROM sage_intel_items WHERE brand_id = $1 AND signal_key = $2",
        [brandId, sig],
      );
      assert.strictEqual(r.rows.length, 1);
      assert.strictEqual(r.rows[0].urgent, true);
      assert.strictEqual(r.rows[0].confidence, "verified");

      // Dismiss, then re-save: must NOT resurrect.
      const itemId = r.rows[0].item_id;
      const dismissed = await intelStore.dismissItem(brandId, itemId);
      assert.strictEqual(dismissed, true);
      await intelStore.saveIntelItem(brandId, {
        source_type: "trend",
        summary: "resurrection attempt",
        why_it_matters: "no",
        signal_key: sig,
      });
      r = await db.query("SELECT dismissed_at, summary FROM sage_intel_items WHERE item_id = $1", [
        itemId,
      ]);
      assert.ok(r.rows[0].dismissed_at, "stays dismissed");
      assert.notStrictEqual(r.rows[0].summary, "resurrection attempt");
    } finally {
      await deleteUser(userId);
    }
  }),
);

// ---------------------------------------------------------------------------
// Input hashing
// ---------------------------------------------------------------------------
test("stableStringify is key-order independent", () => {
  const a = inputHash.computeInputHash({ x: 1, y: [{ b: 2, a: 1 }] });
  const b = inputHash.computeInputHash({ y: [{ a: 1, b: 2 }], x: 1 });
  assert.strictEqual(a, b);
  const c = inputHash.computeInputHash({ x: 2, y: [{ a: 1, b: 2 }] });
  assert.notStrictEqual(a, c);
});

test(
  "shouldRun says gate_off (run) when the flag is off",
  withFlag("SAGE_V2_SKIP_GATES", "false", async () => {
    const d = await inputHash.shouldRun("test-job", null, { a: 1 });
    assert.deepStrictEqual({ run: d.run, reason: d.reason }, { run: true, reason: "gate_off" });
  }),
);

test(
  "shouldRun: first_run -> unchanged skip -> changed run; failed runs don't gate",
  withFlag("SAGE_V2_SKIP_GATES", "true", async () => {
    const jobType = `test-job-${crypto.randomUUID()}`;
    try {
      const first = await inputHash.shouldRun(jobType, null, { a: 1 });
      assert.strictEqual(first.reason, "first_run");
      await inputHash.recordRun(jobType, null, first.hash, "done");

      const again = await inputHash.shouldRun(jobType, null, { a: 1 });
      assert.deepStrictEqual({ run: again.run, reason: again.reason }, { run: false, reason: "unchanged" });

      const changed = await inputHash.shouldRun(jobType, null, { a: 2 });
      assert.deepStrictEqual({ run: changed.run, reason: changed.reason }, { run: true, reason: "changed" });

      // A failed run must not suppress the next attempt.
      await inputHash.recordRun(jobType, null, changed.hash, "failed");
      const after = await inputHash.shouldRun(jobType, null, { a: 2 });
      assert.strictEqual(after.run, true);
    } finally {
      await db.query("DELETE FROM sage_job_hashes WHERE job_type = $1", [jobType]);
    }
  }),
);

test(
  "gateJob is a no-op passthrough with the flag off",
  withFlag("SAGE_V2_SKIP_GATES", "false", async () => {
    const { userId, brandId } = await createBrand();
    try {
      const gate = await gateJob("sage-deep-research", brandId);
      assert.strictEqual(gate.run, true);
      await gate.done(); // must not write anything
      const r = await db.query(
        "SELECT 1 FROM sage_job_hashes WHERE job_type = 'sage-deep-research' AND brand_id = $1",
        [brandId],
      );
      assert.strictEqual(r.rows.length, 0);
    } finally {
      await deleteUser(userId);
    }
  }),
);

test(
  "gateJob skips a second run with unchanged inputs, reruns after a brand change",
  withFlag("SAGE_V2_SKIP_GATES", "true", async () => {
    const { userId, brandId } = await createBrand();
    try {
      const g1 = await gateJob("competitor-scan", brandId);
      assert.strictEqual(g1.run, true);
      await g1.done();

      const g2 = await gateJob("competitor-scan", brandId);
      assert.strictEqual(g2.run, false);
      await g2.skip();
      const h = await db.query(
        "SELECT last_status FROM sage_job_hashes WHERE job_type = 'competitor-scan' AND brand_id = $1",
        [brandId],
      );
      assert.strictEqual(h.rows[0].last_status, "skipped_unchanged");

      await db.query("UPDATE brands SET voice_description = 'now different' WHERE brand_id = $1", [
        brandId,
      ]);
      const g3 = await gateJob("competitor-scan", brandId);
      assert.strictEqual(g3.run, true);
      assert.strictEqual(g3.reason, "changed");
    } finally {
      await deleteUser(userId);
    }
  }),
);

test(
  "weekly-analytics skip still delivers the report: latestStoredAnalytics serves the stored row",
  withFlag("SAGE_V2_SKIP_GATES", "true", async () => {
    const scheduler = require("../utils/scheduler");
    const { userId, brandId } = await createBrand();
    try {
      // Brand with no analytics history: fallback is honestly null (nothing to report).
      assert.strictEqual(await scheduler.latestStoredAnalytics(brandId), null);

      // Store two weekly rows; the fallback must return the most recent one.
      await db.query(
        `INSERT INTO analytics (brand_id, week_date, total_spend, total_leads)
         VALUES ($1, '2026-07-06', 100, 5), ($1, '2026-07-13', 250, 9)`,
        [brandId],
      );
      const reused = await scheduler.latestStoredAnalytics(brandId);
      assert.ok(reused, "stored analytics row is reused for the weekly report");
      assert.strictEqual(new Date(reused.week_date).toISOString().slice(0, 10), "2026-07-13");
      assert.strictEqual(Number(reused.total_leads), 9);

      // And the gate itself skips on unchanged inputs — the combination the
      // scheduler relies on: gate.run=false → report built from the reused row.
      const g1 = await gateJob("weekly-analytics", brandId);
      assert.strictEqual(g1.run, true, "first run always runs");
      await g1.done();
      const g2 = await gateJob("weekly-analytics", brandId);
      assert.strictEqual(g2.run, false, "unchanged inputs skip the AI/aggregation cost");
      await g2.skip();
    } finally {
      await deleteUser(userId);
    }
  }),
);

test("gateJob fails open for unknown job types", async () => {
  const gate = await gateJob("job-that-does-not-exist", null);
  assert.strictEqual(gate.run, true);
});

// ---------------------------------------------------------------------------
// Job queue
// ---------------------------------------------------------------------------
test("enqueue is idempotent per (type, brand, run_key); claim/finish lifecycle", async () => {
  const { userId, brandId } = await createBrand();
  const jobType = `test-queue-${crypto.randomUUID()}`;
  try {
    assert.strictEqual(await jobQueue.enqueue(jobType, brandId, "rk1"), true);
    assert.strictEqual(await jobQueue.enqueue(jobType, brandId, "rk1"), false, "dup is a no-op");
    assert.strictEqual(await jobQueue.enqueue(jobType, null, "rk1"), true, "global row distinct");

    const job = await jobQueue.claimNext(jobType);
    assert.ok(job);
    let r = await db.query("SELECT status, claimed_at FROM sage_job_queue WHERE job_id = $1", [
      job.job_id,
    ]);
    assert.strictEqual(r.rows[0].status, "running");
    assert.ok(r.rows[0].claimed_at);

    await jobQueue.finish(job.job_id, "done", { inputHash: "abc" });
    r = await db.query("SELECT status, input_hash FROM sage_job_queue WHERE job_id = $1", [
      job.job_id,
    ]);
    assert.strictEqual(r.rows[0].status, "done");
    assert.strictEqual(r.rows[0].input_hash, "abc");

    // finish is status-guarded: a second call can't overwrite a terminal row.
    await jobQueue.finish(job.job_id, "failed", { error: "late" });
    r = await db.query("SELECT status FROM sage_job_queue WHERE job_id = $1", [job.job_id]);
    assert.strictEqual(r.rows[0].status, "done");
  } finally {
    await db.query("DELETE FROM sage_job_queue WHERE job_type = $1", [jobType]);
    await deleteUser(userId);
  }
});

test("drain processes queued jobs, marks handler errors failed, continues", async () => {
  const { userId, brandId } = await createBrand();
  const jobType = `test-drain-${crypto.randomUUID()}`;
  try {
    await jobQueue.enqueue(jobType, brandId, "a");
    await jobQueue.enqueue(jobType, null, "b");
    await jobQueue.enqueue(jobType, null, "c");

    let calls = 0;
    const processed = await jobQueue.drain(jobType, async (job) => {
      calls += 1;
      if (job.run_key === "b") throw new Error("boom");
      if (job.run_key === "c") return { skipped: true, inputHash: "h-c" };
      return { inputHash: "h-a" };
    });
    assert.strictEqual(processed, 3);
    assert.strictEqual(calls, 3);

    const r = await db.query(
      "SELECT run_key, status, error, input_hash FROM sage_job_queue WHERE job_type = $1 ORDER BY run_key",
      [jobType],
    );
    const byKey = Object.fromEntries(r.rows.map((x) => [x.run_key, x]));
    assert.strictEqual(byKey.a.status, "done");
    assert.strictEqual(byKey.b.status, "failed");
    assert.ok(byKey.b.error.includes("boom"));
    assert.strictEqual(byKey.c.status, "skipped_unchanged");
    assert.strictEqual(byKey.c.input_hash, "h-c");
  } finally {
    await db.query("DELETE FROM sage_job_queue WHERE job_type = $1", [jobType]);
    await deleteUser(userId);
  }
});

test("rescueStaleClaims fails stale running rows and never re-queues them", async () => {
  const jobType = `test-rescue-${crypto.randomUUID()}`;
  try {
    await jobQueue.enqueue(jobType, null, "stale");
    const job = await jobQueue.claimNext(jobType);
    await db.query("UPDATE sage_job_queue SET claimed_at = NOW() - INTERVAL '45 minutes' WHERE job_id = $1", [
      job.job_id,
    ]);
    const rescued = await jobQueue.rescueStaleClaims();
    assert.ok(rescued.some((r) => r.job_id === job.job_id));
    const r = await db.query("SELECT status, error FROM sage_job_queue WHERE job_id = $1", [
      job.job_id,
    ]);
    assert.strictEqual(r.rows[0].status, "failed");
    assert.ok(/not retried/i.test(r.rows[0].error));
    assert.strictEqual(await jobQueue.claimNext(jobType), null, "nothing left to claim");
  } finally {
    await db.query("DELETE FROM sage_job_queue WHERE job_type = $1", [jobType]);
  }
});

// ---------------------------------------------------------------------------
// Data-quality sentry
// ---------------------------------------------------------------------------
test("runNightlySentry no-ops entirely with the flag off", withFlag("SAGE_V2_DQ_SENTRY", "false", async () => {
  const before = await db.query("SELECT COUNT(*)::int AS n FROM sage_data_quality_flags");
  await sentry.runNightlySentry();
  const after = await db.query("SELECT COUNT(*)::int AS n FROM sage_data_quality_flags");
  assert.strictEqual(after.rows[0].n, before.rows[0].n);
}));

test("conflicting_items flags urgency disagreements and sets conflict_of", async () => {
  const { userId, brandId } = await createBrand();
  try {
    const fam = `conflict:test:${crypto.randomUUID().slice(0, 8)}`;
    const a = await db.query(
      `INSERT INTO sage_intel_items (brand_id, summary, why_it_matters, signal_key, urgent, created_at)
       VALUES ($1, 's1', 'w1', $2, false, NOW() - INTERVAL '1 hour') RETURNING item_id`,
      [brandId, `${fam}:2026-07-16`],
    );
    const b = await db.query(
      `INSERT INTO sage_intel_items (brand_id, summary, why_it_matters, signal_key, urgent)
       VALUES ($1, 's2', 'w2', $2, true) RETURNING item_id`,
      [brandId, `${fam}:2026-07-17`],
    );
    await sentry.sweepConflictingItems();

    const newer = await db.query("SELECT conflict_of FROM sage_intel_items WHERE item_id = $1", [
      b.rows[0].item_id,
    ]);
    assert.strictEqual(newer.rows[0].conflict_of, a.rows[0].item_id);
    const flags = await db.query(
      `SELECT * FROM sage_data_quality_flags
        WHERE brand_id = $1 AND rule_id = 'conflicting_items' AND status = 'open'`,
      [brandId],
    );
    assert.strictEqual(flags.rows.length, 1, "one open flag despite pairs");

    // Re-run: dedup keeps it at one open flag.
    await sentry.sweepConflictingItems();
    const flags2 = await db.query(
      `SELECT COUNT(*)::int AS n FROM sage_data_quality_flags
        WHERE brand_id = $1 AND rule_id = 'conflicting_items' AND status = 'open'`,
      [brandId],
    );
    assert.strictEqual(flags2.rows[0].n, 1);

    // Dismiss one side; the healed sweep resolves the flag.
    await db.query("UPDATE sage_intel_items SET dismissed_at = NOW() WHERE item_id = $1", [
      b.rows[0].item_id,
    ]);
    await sentry.resolveHealedFlags();
    const healed = await db.query(
      `SELECT status FROM sage_data_quality_flags
        WHERE brand_id = $1 AND rule_id = 'conflicting_items'`,
      [brandId],
    );
    assert.strictEqual(healed.rows[0].status, "resolved");
  } finally {
    await deleteUser(userId);
  }
});

test("coverage_gap_analytics flags active campaigns without recent analytics, then heals", async () => {
  const { userId, brandId } = await createBrand();
  try {
    await db.query(
      `INSERT INTO campaigns (brand_id, user_id, campaign_name, status) VALUES ($1, $2, 'C', 'active')`,
      [brandId, userId],
    );
    await sentry.sweepAnalyticsCoverageGaps();
    let flags = await db.query(
      `SELECT status FROM sage_data_quality_flags
        WHERE brand_id = $1 AND rule_id = 'coverage_gap_analytics'`,
      [brandId],
    );
    assert.strictEqual(flags.rows.length, 1);
    assert.strictEqual(flags.rows[0].status, "open");

    await db.query(
      `INSERT INTO analytics (brand_id, week_date, total_spend, total_leads) VALUES ($1, CURRENT_DATE, 0, 0)`,
      [brandId],
    );
    await sentry.resolveHealedFlags();
    flags = await db.query(
      `SELECT status FROM sage_data_quality_flags
        WHERE brand_id = $1 AND rule_id = 'coverage_gap_analytics'`,
      [brandId],
    );
    assert.strictEqual(flags.rows[0].status, "resolved");
  } finally {
    await deleteUser(userId);
  }
});
