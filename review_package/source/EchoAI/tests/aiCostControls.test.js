// Launch-sprint AI cost controls: emergency switches, environment policy,
// central usage ledger, hard budgets, and scheduler gating.
//
// What must hold (per the approved launch spec):
//   - development NEVER spends prod AI credits unless DEVELOPMENT_AI_ENABLED
//     is explicitly on (dbGuard turns it on for stubbed test suites),
//   - the emergency shutoff (AI_ENABLED=false) blocks every paid call with an
//     honest 503 — never mocked output,
//   - admin DB overrides beat env vars beat defaults, and take effect without
//     a redeploy,
//   - every paid call is recorded in ai_usage_log and budgets read from it,
//   - budget thresholds alert once per scope/period/level; 90% pauses only
//     background AI; 100% pauses everything in that scope,
//   - scheduled AI jobs are skipped (not errored) when gated off, while
//     operational jobs always run inside a background AI context.

const { test, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

require("./dbGuard");
const db = require("../config/db");
const controls = require("../config/aiControls");
const { assertAiAllowed, resolveMeta } = require("../utils/aiGate");
const usage = require("../utils/aiUsage");
const { checkBudget, checkRateLimit, _resetRateLimitForTests } = require("../utils/aiBudget");
const { runWithAiContext } = require("../utils/aiContext");
const scheduler = require("../utils/scheduler");

// Env keys the tests flip; snapshot + restore so ordering never leaks state.
const ENV_KEYS = [
  "AI_ENABLED",
  "USER_AI_ENABLED",
  "BACKGROUND_AI_ENABLED",
  "ANTHROPIC_CONTENT_ENABLED",
  "DEVELOPMENT_AI_ENABLED",
  "AI_MAX_CALLS_PER_MINUTE",
  "AI_BUDGET_GLOBAL_DAILY_USD",
  "AI_BUDGET_BACKGROUND_DAILY_USD",
];
const savedEnv = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

async function cleanTables() {
  await db.query("DELETE FROM ai_usage_log");
  await db.query("DELETE FROM ai_budget_alerts");
  await db.query("DELETE FROM ai_settings");
}

beforeEach(async () => {
  restoreEnv();
  controls._resetCacheForTests();
  usage._resetSpendCacheForTests();
  _resetRateLimitForTests();
  await cleanTables();
});

after(async () => {
  restoreEnv();
  await cleanTables();
  await db.pool.end();
});

// --- Control resolution: DB override > env var > default --------------------

test("switch resolution: default, env var, then admin DB override wins", async () => {
  // Launch defaults.
  assert.equal(await controls.getSwitch("SAGE_URGENT_ENABLED"), false);
  assert.equal(await controls.getSwitch("WEEKLY_AI_STACK_ENABLED"), false);
  assert.equal(await controls.getSwitch("AUTONOMOUS_GROWTH_ENABLED"), false);
  assert.equal(await controls.getSwitch("AI_ENABLED"), true);

  // Env var beats default.
  process.env.AI_ENABLED = "false";
  controls._resetCacheForTests();
  assert.equal(await controls.getSwitch("AI_ENABLED"), false);

  // Admin DB override beats the env var — this is what makes the emergency
  // switches work without a redeploy.
  await controls.setControl("AI_ENABLED", true, null);
  assert.equal(await controls.getSwitch("AI_ENABLED"), true);

  // Clearing the override returns control to the env var.
  await controls.clearControl("AI_ENABLED");
  assert.equal(await controls.getSwitch("AI_ENABLED"), false);
});

test("setControl validates keys and values", async () => {
  await assert.rejects(() => controls.setControl("NOT_A_REAL_KEY", true), /Unknown AI control/);
  await assert.rejects(() => controls.setControl("AI_ENABLED", "banana"), /must be true or false/);
  await assert.rejects(
    () => controls.setControl("AI_BUDGET_GLOBAL_DAILY_USD", -5),
    /non-negative number/,
  );
  const saved = await controls.setControl("AI_BUDGET_GLOBAL_DAILY_USD", "12.5", null);
  assert.equal(saved.value, "12.5");
  assert.equal(await controls.getNumber("AI_BUDGET_GLOBAL_DAILY_USD"), 12.5);
});

test("describeControls reports every control with its source", async () => {
  await controls.setControl("SAGE_URGENT_ENABLED", true, null);
  const view = await controls.describeControls();
  const sage = view.switches.find((s) => s.name === "SAGE_URGENT_ENABLED");
  assert.deepEqual({ value: sage.value, source: sage.source }, { value: true, source: "admin setting" });
  const master = view.switches.find((s) => s.name === "AI_ENABLED");
  assert.equal(master.source, "default");
  assert.ok(view.limits.some((l) => l.name === "AI_BUDGET_GLOBAL_DAILY_USD"));
});

// --- The admission gate ------------------------------------------------------

test("development block: no paid calls outside production without explicit opt-in", async () => {
  delete process.env.DEVELOPMENT_AI_ENABLED; // dbGuard's test opt-in
  controls._resetCacheForTests();
  await assert.rejects(
    () => assertAiAllowed("anthropic"),
    (err) => {
      assert.equal(err.status, 503);
      assert.equal(err.aiBlocked, true);
      assert.match(err.message, /disabled in the development environment/);
      return true;
    },
  );
});

test("emergency shutoff blocks everything with an honest 503", async () => {
  await controls.setControl("AI_ENABLED", false, null);
  await assert.rejects(
    () => assertAiAllowed("anthropic"),
    (err) => err.status === 503 && /emergency shutoff/.test(err.message),
  );
  // Resume restores service.
  await controls.setControl("AI_ENABLED", true, null);
  const meta = await assertAiAllowed("anthropic");
  assert.equal(meta.triggeredBy, "user");
});

test("provider and trigger switches gate independently", async () => {
  await controls.setControl("ANTHROPIC_CONTENT_ENABLED", false, null);
  await assert.rejects(() => assertAiAllowed("anthropic"), /Claude.*switched off/);
  await controls.setControl("ANTHROPIC_CONTENT_ENABLED", true, null);

  await controls.setControl("BACKGROUND_AI_ENABLED", false, null);
  await assert.rejects(
    () => assertAiAllowed("anthropic", { triggeredBy: "background" }),
    /background AI is switched off/,
  );
  // User calls keep working while background is paused.
  const meta = await assertAiAllowed("anthropic");
  assert.equal(meta.triggeredBy, "user");

  await controls.setControl("USER_AI_ENABLED", false, null);
  await assert.rejects(() => assertAiAllowed("anthropic"), /user-requested AI is switched off/);
});

test("ambient AI context flows into gate metadata", async () => {
  await runWithAiContext(
    { triggeredBy: "background", jobName: "sage-urgent-scan", agent: "sage" },
    async () => {
      const meta = resolveMeta({});
      assert.equal(meta.triggeredBy, "background");
      assert.equal(meta.jobName, "sage-urgent-scan");
      assert.equal(meta.agent, "sage");
    },
  );
  // Explicit opts beat ambient context; outside context defaults to user.
  assert.equal(resolveMeta({ triggeredBy: "user" }).triggeredBy, "user");
  assert.equal(resolveMeta({}).triggeredBy, "user");
});

test("per-minute rate limit blocks the call after the cap", async () => {
  process.env.AI_MAX_CALLS_PER_MINUTE = "2";
  controls._resetCacheForTests();
  assert.equal((await checkRateLimit()).allowed, true);
  assert.equal((await checkRateLimit()).allowed, true);
  const third = await checkRateLimit();
  assert.equal(third.allowed, false);
  assert.match(third.reason, /rate limit/);
});

// --- Usage ledger ------------------------------------------------------------

test("estimateTokenCost prices tokens and web searches", () => {
  // Defaults: $3/M in, $15/M out, $0.01 per web search (anthropic).
  const cost = usage.estimateTokenCost("anthropic", {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    webSearches: 2,
  });
  assert.equal(Math.round(cost * 100) / 100, 18.02);
  assert.equal(usage.estimateTokenCost("nonsense", { inputTokens: 5 }), 0);
});

test("recordUsage writes a complete ledger row", async () => {
  const requestId = usage.newRequestId();
  await usage.recordUsage({
    provider: "anthropic",
    model: "claude-test",
    feature: "cost-controls-test",
    requestId,
    triggeredBy: "background",
    jobName: "test-job",
    inputTokens: 1000,
    outputTokens: 500,
    retryCount: 1,
    durationMs: 42,
    success: true,
  });
  const r = await db.query("SELECT * FROM ai_usage_log WHERE request_id = $1", [requestId]);
  assert.equal(r.rows.length, 1);
  const row = r.rows[0];
  assert.equal(row.environment, "development");
  assert.equal(row.triggered_by, "background");
  assert.equal(row.job_name, "test-job");
  assert.equal(row.retry_count, 1);
  // 1000 * 3/M + 500 * 15/M = 0.0105
  assert.equal(Number(row.estimated_cost_usd), 0.0105);
});

test("categorizeAiError maps failures honestly", () => {
  assert.equal(usage.categorizeAiError({ aiBlocked: true }), "blocked_by_policy");
  assert.equal(usage.categorizeAiError({ status: 401 }), "auth");
  assert.equal(usage.categorizeAiError({ status: 429 }), "rate_limit");
  assert.equal(usage.categorizeAiError({ status: 529 }), "provider_error");
  assert.equal(usage.categorizeAiError(new Error("Your credit balance is too low")), "billing");
  assert.equal(usage.categorizeAiError(new Error("Request timed out")), "timeout");
});

// --- Hard budgets -------------------------------------------------------------

async function seedSpend({ cost, triggeredBy = "user" }) {
  await usage.recordUsage({
    provider: "anthropic",
    feature: "budget-test-seed",
    requestId: usage.newRequestId(),
    triggeredBy,
    estimatedCostUsd: cost,
  });
  usage._resetSpendCacheForTests();
}

test("100% of the global daily budget blocks ALL paid calls and alerts once", async () => {
  process.env.AI_BUDGET_GLOBAL_DAILY_USD = "0.05";
  controls._resetCacheForTests();
  await seedSpend({ cost: 0.1 });

  const blocked = await checkBudget({ triggeredBy: "user" });
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /global daily AI budget is used up/);

  // Second check re-blocks but does NOT duplicate the alerts.
  await checkBudget({ triggeredBy: "user" });
  const alerts = await db.query(
    "SELECT level, COUNT(*) AS n FROM ai_budget_alerts WHERE scope = 'global daily' GROUP BY level ORDER BY level",
  );
  assert.deepEqual(
    alerts.rows.map((r) => [r.level, Number(r.n)]),
    [
      [50, 1],
      [75, 1],
      [90, 1],
      [100, 1],
    ],
  );
});

test("90% of the background budget pauses background AI but not user AI", async () => {
  process.env.AI_BUDGET_BACKGROUND_DAILY_USD = "0.10";
  controls._resetCacheForTests();
  await seedSpend({ cost: 0.095, triggeredBy: "background" });

  const background = await checkBudget({ triggeredBy: "background" });
  assert.equal(background.allowed, false);
  assert.match(background.reason, /over 90%.*background AI is paused/);

  const user = await checkBudget({ triggeredBy: "user" });
  assert.equal(user.allowed, true);
});

// --- OpenAI paid chokepoints (Whisper / TTS / DALL-E) --------------------------

function stubOpenAiClient() {
  const calls = [];
  return {
    calls,
    audio: {
      speech: {
        create: async (p) => {
          calls.push(["tts", p]);
          return { ok: true };
        },
      },
      transcriptions: {
        create: async (p) => {
          calls.push(["stt", p]);
          return { text: "hi" };
        },
      },
    },
    images: {
      generate: async (p) => {
        calls.push(["image", p]);
        return { data: [{ url: "x" }] };
      },
    },
  };
}

test("OpenAI calls are blocked in development BEFORE the SDK is reached", async () => {
  const { _wireCostControlsForTests } = require("../config/openai");
  const client = stubOpenAiClient();
  _wireCostControlsForTests(client);

  delete process.env.DEVELOPMENT_AI_ENABLED;
  controls._resetCacheForTests();

  for (const call of [
    () => client.audio.speech.create({ input: "hello" }),
    () => client.audio.transcriptions.create({ file: Buffer.from("x") }),
    () => client.images.generate({ prompt: "a logo" }),
  ]) {
    await assert.rejects(call, (err) => err.status === 503 && err.aiBlocked === true);
  }
  assert.equal(client.calls.length, 0); // gate fired before any SDK call
});

test("an allowed OpenAI call goes through and lands in the ledger", async () => {
  const { _wireCostControlsForTests } = require("../config/openai");
  const client = stubOpenAiClient();
  _wireCostControlsForTests(client);

  const res = await client.audio.speech.create({ input: "a".repeat(1000) });
  assert.deepEqual(res, { ok: true });
  assert.equal(client.calls.length, 1);

  // recordUsage is fire-and-forget; poll until the insert lands (the full
  // suite runs many files in parallel, so a fixed sleep is flaky under load).
  let rows;
  const deadline = Date.now() + 10000;
  do {
    rows = await db.query(
      "SELECT provider, task_type, estimated_cost_usd, success FROM ai_usage_log WHERE task_type = 'tts'",
    );
    if (rows.rows.length > 0) break;
    await new Promise((r) => setTimeout(r, 200));
  } while (Date.now() < deadline);
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].provider, "openai");
  assert.equal(rows.rows[0].success, true);
  // 1000 chars at $0.015 / 1k chars
  assert.equal(Number(rows.rows[0].estimated_cost_usd), 0.015);
});

test("the emergency stop blocks OpenAI too", async () => {
  const { _wireCostControlsForTests } = require("../config/openai");
  const client = stubOpenAiClient();
  _wireCostControlsForTests(client);

  await controls.setControl("AI_ENABLED", false, null);
  await assert.rejects(
    () => client.images.generate({ prompt: "x" }),
    (err) => err.status === 503 && /emergency shutoff/.test(err.message),
  );
  assert.equal(client.calls.length, 0);
});

test("OpenAI cost estimators price by real usage dimensions", () => {
  const { _estimateSttMinutesForTests, _estimateImageCostForTests } = require("../config/openai");
  // ~16 kB/s: 960,000 bytes ≈ 1 minute; unknown size defaults to 1 minute.
  assert.equal(_estimateSttMinutesForTests({ size: 960000 }), 1);
  assert.equal(_estimateSttMinutesForTests(undefined), 1);
  assert.ok(_estimateSttMinutesForTests({ size: 1 }) >= 0.1);
  // DALL-E 3: standard 1024 $0.04; hd 1024 $0.08; large hd $0.12; n multiplies.
  assert.equal(_estimateImageCostForTests({ size: "1024x1024" }), 0.04);
  assert.equal(_estimateImageCostForTests({ size: "1024x1024", quality: "hd" }), 0.08);
  assert.equal(_estimateImageCostForTests({ size: "1792x1024", quality: "hd", n: 2 }), 0.24);
});

// --- Scheduler gating ----------------------------------------------------------

test("executeJob skips a gated AI job without running it", async () => {
  // SAGE_URGENT_ENABLED defaults to false for the launch sprint.
  let ran = false;
  const result = await scheduler.executeJob({
    name: "sage-urgent-scan",
    ai: true,
    control: "SAGE_URGENT_ENABLED",
    run: async () => {
      ran = true;
    },
  });
  assert.equal(result.ran, false);
  assert.match(result.reason, /SAGE_URGENT_ENABLED=false/);
  assert.equal(ran, false);
});

test("executeJob blocks AI jobs entirely outside production", async () => {
  delete process.env.DEVELOPMENT_AI_ENABLED;
  controls._resetCacheForTests();
  let ran = false;
  const result = await scheduler.executeJob({
    name: "morning-briefing-warm",
    ai: true,
    control: null,
    run: async () => {
      ran = true;
    },
  });
  assert.equal(result.ran, false);
  assert.match(result.reason, /outside production/);
  assert.equal(ran, false);
});

test("operational (non-AI) jobs always run, inside a background AI context", async () => {
  delete process.env.DEVELOPMENT_AI_ENABLED; // even with dev AI off
  controls._resetCacheForTests();
  const { getAiContext } = require("../utils/aiContext");
  let seenContext = null;
  const result = await scheduler.executeJob({
    name: "social-publish",
    ai: false,
    control: null,
    run: async () => {
      seenContext = getAiContext();
    },
  });
  assert.equal(result.ran, true);
  assert.equal(seenContext.triggeredBy, "background");
  assert.equal(seenContext.jobName, "social-publish");
});

test("an enabled AI job runs with its job name in the AI context", async () => {
  await controls.setControl("SAGE_URGENT_ENABLED", true, null);
  const { getAiContext } = require("../utils/aiContext");
  let seenContext = null;
  const result = await scheduler.executeJob({
    name: "sage-urgent-scan",
    ai: true,
    control: "SAGE_URGENT_ENABLED",
    run: async () => {
      seenContext = getAiContext();
    },
  });
  assert.equal(result.ran, true);
  assert.equal(seenContext.jobName, "sage-urgent-scan");
});
