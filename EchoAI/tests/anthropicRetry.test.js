// Task: pin the AI timeout + retry helper (config/anthropic.createMessage).
//
// AI-heavy generations (e.g. the drip sequence) must:
//   - retry automatically on transient upstream failures (timeouts, 429, 5xx,
//     "overloaded") up to the configured attempt cap before surfacing the error,
//   - NOT retry deterministic failures (auth/quota 4xx) — those only fail again,
//   - forward a per-request timeout to the SDK,
//   - disable the SDK's own retry so this wrapper is the single retry source.
//
// Pure unit tests over the wrapper with a stubbed messages.create — no network,
// no DB, no real AI.

const { test, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const anthropicModule = require("../config/anthropic");
const { createMessage, isTransientAiError } = anthropicModule;
const { db } = require("./helpers");

const originalCreate = anthropicModule.anthropic.messages.create;

after(async () => {
  anthropicModule.anthropic.messages.create = originalCreate;
  await db.pool.end();
});

let calls;
beforeEach(() => {
  calls = [];
});
afterEach(() => {
  anthropicModule.anthropic.messages.create = originalCreate;
});

function stub(impl) {
  anthropicModule.anthropic.messages.create = async (params, options) => {
    calls.push({ params, options });
    return impl(calls.length);
  };
}

function transient(message = "Request timed out") {
  const err = new Error(message);
  err.name = "APIConnectionTimeoutError";
  return err;
}

test("isTransientAiError classifies retryable vs deterministic failures", () => {
  assert.equal(isTransientAiError(transient()), true);
  assert.equal(isTransientAiError({ status: 429 }), true);
  assert.equal(isTransientAiError({ status: 503 }), true);
  assert.equal(isTransientAiError({ message: "overloaded_error" }), true);
  assert.equal(isTransientAiError({ status: 401 }), false);
  assert.equal(isTransientAiError({ status: 400 }), false);
  assert.equal(isTransientAiError(null), false);
});

test("retries transient failures then succeeds within the attempt cap", async () => {
  stub((n) => {
    if (n < 3) throw transient();
    return { content: [{ type: "text", text: "ok" }] };
  });
  const res = await createMessage({ model: "m", messages: [] }, { attempts: 3, timeout: 1234 });
  assert.equal(res.content[0].text, "ok");
  assert.equal(calls.length, 3);
  // The per-request timeout is forwarded and the SDK's own retry is disabled.
  assert.equal(calls[0].options.timeout, 1234);
  assert.equal(calls[0].options.maxRetries, 0);
});

test("gives up after the attempt cap and throws the last transient error", async () => {
  stub(() => {
    throw transient("still timing out");
  });
  await assert.rejects(
    () => createMessage({ model: "m", messages: [] }, { attempts: 3 }),
    /still timing out/,
  );
  assert.equal(calls.length, 3);
});

test("does NOT retry a deterministic (non-transient) error", async () => {
  stub(() => {
    const err = new Error("invalid api key");
    err.status = 401;
    throw err;
  });
  await assert.rejects(
    () => createMessage({ model: "m", messages: [] }, { attempts: 3 }),
    /invalid api key/,
  );
  assert.equal(calls.length, 1);
});
