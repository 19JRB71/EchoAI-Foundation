const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("./dbGuard");
const express = require("express");
const jwt = require("jsonwebtoken");
const { db, createTestUser, deleteUser } = require("./helpers");
const setup = require("../controllers/setupAgentController");
const guided = require("../controllers/guidedSetupController");
const email = require("../controllers/emailController");
const setupRoutes = require("../routes/setupAgentRoutes");
const guidedRoutes = require("../routes/guidedSetupRoutes");

let server, base, aiCalls = 0;
const users = [];
const originalAI = setup._createMessage;
const originalWelcome = email.sendWelcomeEmail;

before(async () => {
  setup._createMessage = async () => {
    aiCalls += 1;
    return { content: [{ type: "text", text: JSON.stringify({ message: "First question?", collects: "primary_goal", complete: false }) }] };
  };
  email.sendWelcomeEmail = async () => {};
  const app = express();
  app.use(express.json());
  app.use("/api/setup-agent", setupRoutes);
  app.use("/api/guided-setup", guidedRoutes);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  setup._createMessage = originalAI;
  email.sendWelcomeEmail = originalWelcome;
  await new Promise((resolve) => server.close(resolve));
  for (const userId of users) await deleteUser(userId).catch(() => {});
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
    method: path.endsWith("/state") ? "GET" : path.includes("guided-setup") ? "PUT" : "POST",
    headers: { Authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`, "Content-Type": "application/json" },
    body: path.endsWith("/state") ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
const converge = (userId) =>
  call(userId, "/api/guided-setup/progress", { currentStep: guided.CONVERGENCE_OPERATION, connections: {} });

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
  const userId = await fixture({ completed: true });
  await brand(userId);
  const result = await call(userId, "/api/setup-agent/session", { intent: "new_business" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.session.answers._interview.entryIntent, "new_business");
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

test("cardinality and terminal failures never converge or create a replacement session", async () => {
  const userId = await fixture();
  const brandId = await brand(userId);
  assert.equal((await converge(userId)).body.completedSessionCount, 0);
  await completedSession(userId, brandId, { terminal: false });
  assert.equal((await converge(userId)).body.code, "setup_journey_not_terminal");
  await completedSession(userId, brandId);
  assert.equal((await converge(userId)).body.completedSessionCount, 2);
  const guarded = await call(userId, "/api/setup-agent/session", {});
  assert.equal(guarded.body.code, "setup_journey_completed");
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM setup_sessions WHERE user_id=$1", [userId])).rows[0].n, 2);
});