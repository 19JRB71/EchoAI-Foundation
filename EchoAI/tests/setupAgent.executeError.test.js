// Task: a user-initiated pause/dismiss that races a running setup step must never
// surface as the scary red error screen. The onboarding Setup Agent distinguishes
// a server 409 that carries the real session (a honored cancellation) from a real
// step failure. That branching is a subtle, race-dependent contract with no other
// coverage — this pins it so a future refactor of the /execute loop can't silently
// regress it.
//
// The fragile decision lives in the pure `classifyExecuteError` used by
// SetupAgent.jsx's runLoop catch. We import that ESM module (the client is
// "type": "module") and assert each outcome maps to the correct UI phase.

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let classifyExecuteError;

before(async () => {
  const mod = await import(
    pathToFileURL(path.join(__dirname, "../client/src/onboarding/executeError.js")).href
  );
  classifyExecuteError = mod.classifyExecuteError;
});

test("409 with a paused session → resumable paused state, not the error phase", () => {
  const err = Object.assign(new Error("Setup was paused."), {
    status: 409,
    data: { session: { status: "paused", sessionId: "s1" } },
  });

  const outcome = classifyExecuteError(err);

  assert.equal(outcome.type, "paused", "must enter the resumable paused state");
  assert.notEqual(outcome.type, "error", "must NOT fall through to the error phase");
  assert.deepEqual(
    outcome.session,
    { status: "paused", sessionId: "s1" },
    "carries the real session through so the panel can resume it",
  );
});

test("409 with a dismissed session → clean close (onClose), no error banner", () => {
  const err = Object.assign(new Error("Setup was dismissed."), {
    status: 409,
    data: { session: { status: "dismissed" } },
  });

  const outcome = classifyExecuteError(err);

  assert.equal(outcome.type, "dismissed", "must trigger a clean close, not an error");
});

test('409 WITHOUT a session body ("A setup step is already running") → normal retryable error', () => {
  const err = Object.assign(new Error("A setup step is already running."), {
    status: 409,
    data: { error: "A setup step is already running." },
  });

  const outcome = classifyExecuteError(err);

  assert.equal(outcome.type, "error", "a session-less 409 is still a real, retryable error");
  assert.equal(
    outcome.message,
    "A setup step is already running.",
    "surfaces the server message so the user can retry",
  );
});

test("a non-409 failure is a normal retryable error", () => {
  const err = Object.assign(new Error("A setup step failed."), {
    status: 502,
    data: { error: "A setup step failed." },
  });

  const outcome = classifyExecuteError(err);

  assert.equal(outcome.type, "error");
  assert.equal(outcome.message, "A setup step failed.");
});

test("a 409 session in some other lifecycle status is treated as a real error, not silently swallowed", () => {
  const err = Object.assign(new Error("Unexpected state."), {
    status: 409,
    data: { session: { status: "in_progress" } },
  });

  const outcome = classifyExecuteError(err);

  assert.equal(outcome.type, "error", "only paused/dismisssed are honored cancellations");
});

test("falls back to a safe default message when the error carries none", () => {
  const outcome = classifyExecuteError({ status: 500, data: {} });

  assert.equal(outcome.type, "error");
  assert.equal(outcome.message, "A setup step failed. You can retry.");
});
