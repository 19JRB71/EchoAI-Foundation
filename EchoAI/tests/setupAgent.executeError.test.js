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

// 026-C2 / AM-C2-3 INVERSION (disclosed): this test previously asserted the
// DEFECT — a session-less lease 409 classified as `type: "error"`, which the
// UI rendered as a terminal "Please wait" banner over a dead loop (the SDS-H1
// freeze surface). The corrected contract: any 409 that is not an honored
// pause/dismiss means "an execute is in flight" and must reconcile (bounded
// re-attempt), never die.
//   OLD assertion: outcome.type === "error" with the raw server message.
//   NEW assertion: outcome.type === "reconcile".
test('409 WITHOUT a session body ("already running") → reconcile, never a terminal error', () => {
  const err = Object.assign(new Error("Another setup step is currently running."), {
    status: 409,
    data: { error: "Another setup step is currently running." },
  });

  const outcome = classifyExecuteError(err);

  assert.equal(outcome.type, "reconcile", "a session-less 409 must reconcile, not die");
  assert.equal(outcome.session, null, "no session body → the loop refetches server truth");
});

// 026-C2: the server's lease 409 now carries the authoritative serialized
// session (status in_progress). It must classify as reconcile WITH that
// session so the client adopts server truth before re-attempting.
test("409 with an in_progress session (live lease conflict) → reconcile with server truth", () => {
  const session = { status: "in_progress", sessionId: "s1", completedSteps: ["a"] };
  const err = Object.assign(new Error("Another setup step is currently running."), {
    status: 409,
    data: { error: "Another setup step is currently running.", code: "execute_in_progress", session },
  });

  const outcome = classifyExecuteError(err);

  assert.equal(outcome.type, "reconcile");
  assert.deepEqual(outcome.session, session, "carries the session so the client adopts it");
});

// 026-C2: a durable failed step outcome from the server classifies as a
// persistent failed-step state carrying ONLY owner-safe template text.
test("a failed-step response → type failed with owner-safe message, step, and outcome", () => {
  const session = { status: "in_progress", sessionId: "s1" };
  const err = Object.assign(new Error("Request failed"), {
    status: 502,
    data: {
      error: "The AI service was temporarily unavailable while running this step. Your progress is saved — you can retry now.",
      failedStep: { key: "ad_creatives", label: "Generating your first ad creatives" },
      outcome: { code: "provider_unavailable", retryable: true, ref: "ref-1", at: "2026-08-16T00:00:00Z" },
      session,
    },
  });

  const outcome = classifyExecuteError(err);

  assert.equal(outcome.type, "failed");
  assert.equal(outcome.failedStep.key, "ad_creatives");
  assert.equal(outcome.outcome.ref, "ref-1");
  assert.deepEqual(outcome.session, session);
  assert.match(outcome.message, /temporarily unavailable/);
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

// 026-C2 / AM-C2-3 INVERSION (disclosed): this test previously asserted that a
// 409 whose session was in any status other than paused/dismissed was a
// terminal error. Under C2 the server's lease refusal deliberately carries an
// in_progress session, so that shape now means "live lease conflict —
// reconcile". The honored-cancellation branches (paused/dismissed) are
// unchanged and still pinned above.
//   OLD assertion: outcome.type === "error".
//   NEW assertion: outcome.type === "reconcile" (with the session carried).
test("a 409 session in a non-cancelled status is a live lease conflict → reconcile, not an error", () => {
  const err = Object.assign(new Error("Unexpected state."), {
    status: 409,
    data: { session: { status: "in_progress" } },
  });

  const outcome = classifyExecuteError(err);

  assert.equal(outcome.type, "reconcile", "an in-progress 409 session must reconcile");
  assert.deepEqual(outcome.session, { status: "in_progress" });
});

test("falls back to a safe default message when the error carries none", () => {
  const outcome = classifyExecuteError({ status: 500, data: {} });

  assert.equal(outcome.type, "error");
  assert.equal(outcome.message, "A setup step failed. You can retry.");
});
