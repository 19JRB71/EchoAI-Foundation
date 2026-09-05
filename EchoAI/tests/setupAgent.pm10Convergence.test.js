const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
require("./dbGuard");
const express = require("express");
const jwt = require("jsonwebtoken");
const { db, createTestUser, deleteUser } = require("./helpers");
const setup = require("../controllers/setupAgentController");
const guided = require("../controllers/guidedSetupController");
const email = require("../controllers/emailController");
const setupRoutes = require("../routes/setupAgentRoutes");
const guidedRoutes = require("../routes/guidedSetupRoutes");
const authRoutes = require("../routes/authRoutes");

let server, base, aiCalls = 0, welcomeCalls = 0;
const users = [];
const originalAI = setup._createMessage;
const originalWelcome = email.sendWelcomeEmail;

before(async () => {
  setup._createMessage = async () => {
    aiCalls += 1;
    return { content: [{ type: "text", text: JSON.stringify({ message: "First question?", collects: "primary_goal", complete: false }) }] };
  };
  email.sendWelcomeEmail = async () => { welcomeCalls += 1; };
  const app = express();
  app.use(express.json());
  app.use("/api/setup-agent", setupRoutes);
  app.use("/api/guided-setup", guidedRoutes);
  app.use("/api/auth", authRoutes);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  setup._createMessage = originalAI;
  email.sendWelcomeEmail = originalWelcome;
  await new Promise((resolve) => server.close(resolve));
  for (const userId of users) {
    await db.query("DELETE FROM external_actions WHERE user_id=$1", [userId]).catch(() => {});
    await db.query("DELETE FROM agent_tasks WHERE user_id=$1", [userId]).catch(() => {});
    await deleteUser(userId).catch(() => {});
  }
  await db.pool.end();
});

async function fixture({ completed = false } = {}) {
  const userId = await createTestUser();
  users.push(userId);
  await db.query("UPDATE users SET onboarding_completed = $2 WHERE user_id = $1", [userId, completed]);
  return userId;
}
async function brand(userId) {
  const { rows } = await db.query("INSERT INTO brands (user_id, brand_name) VALUES ($1,'PM10 Brand') RETURNING brand_id", [userId]);
  return rows[0].brand_id;
}
async function completedSession(userId, brandId, { intent = "resume", terminal = true } = {}) {
  const keys = setup.ACTIONS.map((action) => action.key);
  const outcomes = Object.fromEntries(keys.map((key) => [key, "completed"]));
  if (!terminal) delete outcomes[keys.at(-1)];
  const answers = { _interview: { entryIntent: intent }, step_outcomes: outcomes };
  const { rows } = await db.query(
    `INSERT INTO setup_sessions
      (user_id,brand_id,status,interview_complete,completed_steps,answers,completed_at)
     VALUES ($1,$2,'completed',TRUE,$3::jsonb,$4::jsonb,NOW()) RETURNING *`,
    [userId, brandId, JSON.stringify(keys), JSON.stringify(answers)],
  );
  return rows[0];
}
async function call(userId, path, body) {
  const response = await fetch(`${base}${path}`, {
    method: path.endsWith("/state") ? "GET" : path.includes("guided-setup") || path.includes("/auth/") ? "PUT" : "POST",
    headers: { Authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`, "Content-Type": "application/json" },
    body: path.endsWith("/state") ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
const converge = (userId) =>
  call(userId, "/api/guided-setup/progress", { currentStep: guided.CONVERGENCE_OPERATION, connections: {} });

const keys = setup.ACTIONS.map((action) => action.key);
const validDeferral = {
  status: "failed",
  code: "provider_manual_review",
  message: "Facebook accepted part of the launch; the owner chose review.",
  retryable: false,
  ref: "pm10-provider-ref",
  journey_disposition: "deferred",
  deferred_reason: "pending_provider_review",
  owner_directed: true,
  deferred_at: "2026-08-24T12:00:00.000Z",
};
function terminalRow(outcome = "completed", status = "completed") {
  return {
    status,
    completed_steps: keys,
    answers: { step_outcomes: Object.fromEntries(keys.map((key) => [key, key === "create_facebook_campaign" ? outcome : "completed"])) },
  };
}

test("R16: the production terminal predicate accepts every completed outcome", () => {
  assert.equal(setup.isTerminalSetupJourney(terminalRow()), true);
});

test("R16: the production terminal predicate accepts skipped outcomes", () => {
  assert.equal(setup.isTerminalSetupJourney(terminalRow("skipped")), true);
});

test("R16: the production terminal predicate accepts the exact owner-directed deferred outcome", () => {
  assert.equal(setup.isTerminalSetupJourney(terminalRow(validDeferral)), true);
});

test("R16: failed without a journey disposition is not terminal", () => {
  const { journey_disposition, deferred_reason, owner_directed, deferred_at, ...failed } = validDeferral;
  assert.equal(setup.isTerminalSetupJourney(terminalRow(failed)), false);
});

test("R16: a retryable failed outcome is not terminal", () => {
  assert.equal(setup.isTerminalSetupJourney(terminalRow({ ...validDeferral, retryable: true })), false);
});

test("R16: running session and action states are not terminal", () => {
  assert.equal(setup.isTerminalSetupJourney(terminalRow("running")), false);
  assert.equal(setup.isTerminalSetupJourney(terminalRow("completed", "in_progress")), false);
});

test("R16: a pending action outcome is not terminal", () => {
  assert.equal(setup.isTerminalSetupJourney(terminalRow("pending")), false);
});

async function richFixture() {
  const userId = await fixture();
  await db.query(
    `UPDATE users SET onboarding_step=2, business_name='PM10 Owner',
       team_size=3 WHERE user_id=$1`,
    [userId],
  );
  const brandId = await brand(userId);
  await db.query(
    `UPDATE brands SET brand_personality='direct', voice_description='warm',
       visual_style_preferences='{"palette":["navy","gold"]}'::jsonb,
       target_audience='{"segment":"owners"}'::jsonb WHERE brand_id=$1`,
    [brandId],
  );
  const outcomes = Object.fromEntries(keys.map((key) => [
    key,
    key === "create_facebook_campaign" ? validDeferral : "completed",
  ]));
  const { rows: sessions } = await db.query(
    `INSERT INTO setup_sessions
       (user_id,brand_id,status,answers,messages,completed_steps,current_field,
        interview_complete,consent_granted,completed_at)
     VALUES ($1,$2,'completed',$3::jsonb,$4::jsonb,$5::jsonb,NULL,TRUE,FALSE,NOW())
     RETURNING session_id`,
    [
      userId,
      brandId,
      JSON.stringify({
        _interview: { entryIntent: "resume" },
        primary_goal: "durable growth",
        step_outcomes: outcomes,
      }),
      JSON.stringify([{ role: "user", content: "Preserve this transcript." }]),
      JSON.stringify(keys),
    ],
  );
  await db.query(
    `INSERT INTO guided_setup_progress (user_id,current_step,connections)
     VALUES ($1,'Store-3',$2::jsonb)`,
    [userId, JSON.stringify({ facebook: { skipped: false }, _recovery: { source: "Store-3", attempt: 2 } })],
  );
  const { rows: campaigns } = await db.query(
    `INSERT INTO campaigns
       (brand_id,user_id,campaign_name,budget,status,facebook_campaign_id,facebook_adset_id,
        ad_creative_variations)
     VALUES ($1,$2,'Provider-backed campaign',41,'created_paused','fb-campaign-pm10',
       'fb-adset-pm10','[{"headline":"Keep me"}]'::jsonb) RETURNING campaign_id`,
    [brandId, userId],
  );
  await db.query(
    `INSERT INTO social_accounts
       (brand_id,platform,platform_username,credentials_encrypted,connection_status)
     VALUES ($1,'facebook','pm10-page','encrypted-fixture-only','connected')`,
    [brandId],
  );
  await db.query(
    `INSERT INTO social_posts (brand_id,platform,post_content,scheduled_time,status)
     SELECT $1,'facebook','Calendar draft ' || n,
            TIMESTAMPTZ '2026-09-01 12:00:00+00' + n * INTERVAL '1 day','draft'
       FROM generate_series(1,13) n`,
    [brandId],
  );
  const { rows: tasks } = await db.query(
    `INSERT INTO agent_tasks
       (brand_id,user_id,task_type,source_type,source_id,status,title,meta)
     VALUES ($1,$2,'reconciliation','campaign',$3,'COMPLETED','Persisted task',
       '{"fixture":"pm10"}'::jsonb) RETURNING task_id`,
    [brandId, userId, String(campaigns[0].campaign_id)],
  );
  await db.query(
    `INSERT INTO external_actions
       (idempotency_key,provider,action,task_id,brand_id,user_id,status,external_ref,
        meta,finished_at)
     VALUES ($1,'facebook','campaign_create',$2,$3,$4,'succeeded','provider-action-pm10',
       '{"ledger":"keep"}'::jsonb,NOW())`,
    [`pm10:${userId}`, tasks[0].task_id, brandId, userId],
  );
  return { userId, brandId, sessionId: sessions[0].session_id };
}

async function richSnapshot({ userId, brandId }) {
  const one = async (sql, params) => (await db.query(sql, params)).rows;
  return {
    user: (await one(
      "SELECT * FROM users WHERE user_id=$1",
      [userId],
    ))[0],
    brands: await one("SELECT * FROM brands WHERE brand_id=$1", [brandId]),
    sessions: await one("SELECT * FROM setup_sessions WHERE user_id=$1 ORDER BY session_id", [userId]),
    guided: await one("SELECT * FROM guided_setup_progress WHERE user_id=$1", [userId]),
    campaigns: await one("SELECT * FROM campaigns WHERE brand_id=$1 ORDER BY campaign_id", [brandId]),
    posts: await one("SELECT * FROM social_posts WHERE brand_id=$1 ORDER BY scheduled_time", [brandId]),
    accounts: await one("SELECT * FROM social_accounts WHERE brand_id=$1 ORDER BY account_id", [brandId]),
    tasks: await one("SELECT * FROM agent_tasks WHERE user_id=$1 ORDER BY task_id", [userId]),
    actions: await one("SELECT * FROM external_actions WHERE user_id=$1 ORDER BY action_id", [userId]),
  };
}

function rowCounts(snapshot) {
  return Object.fromEntries(
    Object.entries(snapshot).filter(([, value]) => Array.isArray(value)).map(([table, rows]) => [table, rows.length]),
  );
}

function assertCompletionOnlyUserChange(before, after) {
  const { updated_at: beforeUpdatedAt, ...beforeStrict } = before;
  const { updated_at: afterUpdatedAt, ...afterStrict } = after;
  assert.deepEqual(afterStrict, {
    ...beforeStrict,
    onboarding_completed: true,
    onboarding_step: 5,
  });
  assert.ok(
    new Date(afterUpdatedAt).getTime() >= new Date(beforeUpdatedAt).getTime(),
    "the legitimately written user row updated_at must move monotonically",
  );
}

async function waitForWelcome(expected) {
  for (let i = 0; i < 30 && welcomeCalls < expected; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("R15/R16: real HTTP rejects a nonterminal journey with zero writes, sessions, or execution seams", async () => {
  const userId = await fixture();
  const brandId = await brand(userId);
  await completedSession(userId, brandId, { terminal: false });
  const beforeAI = aiCalls;
  const beforeWelcome = welcomeCalls;
  const beforeSessions = (await db.query(
    "SELECT session_id FROM setup_sessions WHERE user_id=$1 ORDER BY session_id",
    [userId],
  )).rows;
  const result = await converge(userId);
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "setup_journey_not_terminal");
  assert.equal((await db.query("SELECT onboarding_completed FROM users WHERE user_id=$1", [userId])).rows[0].onboarding_completed, false);
  assert.deepEqual((await db.query(
    "SELECT session_id FROM setup_sessions WHERE user_id=$1 ORDER BY session_id",
    [userId],
  )).rows, beforeSessions);
  assert.equal(aiCalls, beforeAI);
  assert.equal(welcomeCalls, beforeWelcome);
});

test("R1/R2/R3/R4/R5/R12/R13/R17: master real-HTTP snapshot changes only completion and preserves all rich journey state", async () => {
  const ids = await richFixture();
  const beforeSnapshot = await richSnapshot(ids);
  const beforeAI = aiCalls;
  const beforeWelcome = welcomeCalls;
  const result = await converge(ids.userId);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.converged, true);
  assert.equal(result.body.onboardingStep, 5);
  await waitForWelcome(beforeWelcome + 1);
  const afterSnapshot = await richSnapshot(ids);
  assertCompletionOnlyUserChange(beforeSnapshot.user, afterSnapshot.user);
  for (const table of ["brands", "sessions", "guided", "campaigns", "posts", "accounts", "tasks", "actions"]) {
    assert.deepEqual(afterSnapshot[table], beforeSnapshot[table], `${table} must remain byte-equivalent`);
  }
  assert.equal(afterSnapshot.posts.length, 13);
  assert.equal(afterSnapshot.posts.every((post) => post.status === "draft"), true);
  assert.equal(afterSnapshot.posts.filter((post) => post.status === "scheduled").length, 0);
  assert.equal(afterSnapshot.posts.filter((post) => post.status === "published").length, 0);
  assert.deepEqual(
    afterSnapshot.sessions.map((session) => session.session_id),
    beforeSnapshot.sessions.map((session) => session.session_id),
  );
  assert.deepEqual(afterSnapshot.sessions[0].answers.step_outcomes.create_facebook_campaign, validDeferral);
  assert.deepEqual(afterSnapshot.guided[0].connections._recovery, { source: "Store-3", attempt: 2 });
  assert.deepEqual(rowCounts(afterSnapshot), rowCounts(beforeSnapshot), "zero row creation or deletion");
  assert.equal(aiCalls, beforeAI, "zero AI calls");
  assert.equal(afterSnapshot.actions.length, 1, "zero provider/publish/launch ledger writes");
  assert.equal(afterSnapshot.tasks.length, 1, "zero provider/publish/launch task writes");
  assert.equal(welcomeCalls, beforeWelcome + 1);
  assert.equal((await converge(ids.userId)).body.converged, false);
  await waitForWelcome(beforeWelcome + 1);
  assert.equal(welcomeCalls, beforeWelcome + 1, "idempotent retry sends welcome exactly once");
});

test("R18: original handoff real HTTP preserves its exact response and completion contract", async () => {
  const original = await richFixture();
  const before = await richSnapshot(original);
  const result = await call(original.userId, "/api/auth/profile/onboarding", {
    onboardingStep: 5,
    onboardingCompleted: true,
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    userId: original.userId,
    onboardingCompleted: true,
    onboardingStep: 5,
  });
  const afterSnapshot = await richSnapshot(original);
  assertCompletionOnlyUserChange(before.user, afterSnapshot.user);
  for (const table of ["brands", "sessions", "guided", "campaigns", "posts", "accounts", "tasks", "actions"]) {
    assert.deepEqual(afterSnapshot[table], before[table], `${table} must remain byte-equivalent`);
  }
});

test("R19: original handoff and convergence real-HTTP callers produce equal durable completion state", async () => {
  const original = await richFixture();
  const converged = await richFixture();
  const beforeWelcome = welcomeCalls;
  const handoff = await call(original.userId, "/api/auth/profile/onboarding", {
    onboardingStep: 5,
    onboardingCompleted: true,
  });
  assert.equal(handoff.status, 200);
  assert.deepEqual(handoff.body, {
    userId: original.userId,
    onboardingCompleted: true,
    onboardingStep: 5,
  });
  const convergence = await converge(converged.userId);
  assert.equal(convergence.status, 200, JSON.stringify(convergence.body));
  const durable = async (userId) => (await db.query(
    "SELECT onboarding_completed,onboarding_step FROM users WHERE user_id=$1",
    [userId],
  )).rows[0];
  assert.deepEqual(await durable(original.userId), await durable(converged.userId));
  assert.deepEqual(await durable(original.userId), { onboarding_completed: true, onboarding_step: 5 });
  const second = await call(original.userId, "/api/auth/profile/onboarding", {
    onboardingStep: 5,
    onboardingCompleted: true,
  });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, handoff.body);
  assert.equal((await converge(converged.userId)).body.converged, false);
  await waitForWelcome(beforeWelcome + 2);
  assert.equal(welcomeCalls, beforeWelcome + 2, "each equivalent fixture welcomes exactly once");
});

test("R23: pre-completion new_business is a side-effect-free 409", async () => {
  const userId = await fixture();
  const beforeCount = aiCalls;
  const result = await call(userId, "/api/setup-agent/session", { intent: "new_business" });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "onboarding_incomplete_new_business");
  assert.equal((await db.query("SELECT 1 FROM setup_sessions WHERE user_id=$1", [userId])).rows.length, 0);
  assert.equal(aiCalls, beforeCount);
});

test("R24: post-completion new_business still starts normally", async () => {
  const sdsUserId = await fixture({ completed: true });
  const sdsBrandId = await brand(sdsUserId);
  await db.query("UPDATE brands SET brand_name='SDS fixture' WHERE brand_id=$1", [sdsBrandId]);
  const sdsBefore = await db.query("SELECT * FROM brands WHERE brand_id=$1", [sdsBrandId]);
  const sdsBeforeHash = createHash("sha256").update(JSON.stringify(sdsBefore.rows)).digest("hex");

  const userId = await fixture({ completed: true });
  await brand(userId);
  const result = await call(userId, "/api/setup-agent/session", { intent: "new_business" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.session.answers._interview.entryIntent, "new_business");
  assert.equal(result.body.session.brandId, null);
  assert.deepEqual(Object.keys(result.body.session.answers), ["_interview"]);

  const sdsAfter = await db.query("SELECT * FROM brands WHERE brand_id=$1", [sdsBrandId]);
  const sdsAfterHash = createHash("sha256").update(JSON.stringify(sdsAfter.rows)).digest("hex");
  assert.equal(sdsAfter.rowCount, sdsBefore.rowCount, "SDS brand fixture count is unchanged");
  assert.equal(sdsAfterHash, sdsBeforeHash, "SDS brand fixture hash is unchanged");
  assert.equal(
    (await db.query("SELECT 1 FROM setup_sessions WHERE user_id=$1", [sdsUserId])).rowCount,
    0,
    "new_business creates no SDS setup session",
  );
});

test("R25 + concurrency: new_business rejects; the same valid initial journey converges once and preserves evidence", async () => {
  const userId = await fixture();
  const brandId = await brand(userId);
  const session = await completedSession(userId, brandId, { intent: "new_business" });
  await db.query("INSERT INTO setup_sessions (user_id,status,created_at) VALUES ($1,'paused',NOW()+INTERVAL '1 second')", [userId]);
  assert.equal((await call(userId, "/api/guided-setup/state")).body.setupSession.status, "completed");
  await db.query("INSERT INTO guided_setup_progress (user_id,current_step,connections) VALUES ($1,'profile',$2::jsonb)", [userId, JSON.stringify({ _recovery: { note: "keep" } })]);
  const rejected = await converge(userId);
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, "setup_entry_intent_new_business");
  const answers = { ...session.answers, _interview: { entryIntent: "resume" } };
  await db.query("UPDATE setup_sessions SET answers=$2::jsonb WHERE session_id=$1", [session.session_id, JSON.stringify(answers)]);
  const pair = await Promise.all([converge(userId), converge(userId)]);
  assert.deepEqual(pair.map((r) => r.body.converged).sort(), [false, true]);
  assert.equal((await db.query("SELECT onboarding_completed FROM users WHERE user_id=$1", [userId])).rows[0].onboarding_completed, true);
  assert.deepEqual((await db.query("SELECT connections FROM guided_setup_progress WHERE user_id=$1", [userId])).rows[0].connections, { _recovery: { note: "keep" } });
  assert.deepEqual((await db.query("SELECT answers FROM setup_sessions WHERE session_id=$1", [session.session_id])).rows[0].answers, answers);
  assert.equal((await converge(userId)).body.converged, false);
});

test("R9/R21: zero and greater-than-one completed-session cardinality never converges or creates a replacement", async () => {
  const userId = await fixture();
  const brandId = await brand(userId);
  const initialSessions = (await db.query(
    "SELECT session_id FROM setup_sessions WHERE user_id=$1 ORDER BY session_id",
    [userId],
  )).rows;
  const zero = await converge(userId);
  assert.equal(zero.status, 409);
  assert.equal(zero.body.code, "setup_session_cardinality");
  assert.equal(zero.body.completedSessionCount, 0);
  assert.deepEqual((await db.query(
    "SELECT session_id FROM setup_sessions WHERE user_id=$1 ORDER BY session_id",
    [userId],
  )).rows, initialSessions);
  assert.equal((await db.query(
    "SELECT onboarding_completed FROM users WHERE user_id=$1",
    [userId],
  )).rows[0].onboarding_completed, false);
  await completedSession(userId, brandId, { terminal: false });
  assert.equal((await converge(userId)).body.code, "setup_journey_not_terminal");
  await completedSession(userId, brandId);
  assert.equal((await converge(userId)).body.completedSessionCount, 2);
  const many = await converge(userId);
  assert.equal(many.status, 409);
  assert.equal(many.body.code, "setup_session_cardinality");
  assert.equal(many.body.completedSessionCount, 2);
  assert.equal((await db.query(
    "SELECT onboarding_completed FROM users WHERE user_id=$1",
    [userId],
  )).rows[0].onboarding_completed, false);
  const guarded = await call(userId, "/api/setup-agent/session", {});
  assert.equal(guarded.body.code, "setup_journey_completed");
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM setup_sessions WHERE user_id=$1", [userId])).rows[0].n, 2);
});