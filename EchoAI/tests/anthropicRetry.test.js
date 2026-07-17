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

test("pause_turn responses are continued until the turn completes", async () => {
  stub((n) => {
    if (n === 1) {
      return {
        stop_reason: "pause_turn",
        content: [{ type: "server_tool_use", id: "t1", name: "web_search", input: { query: "x" } }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    }
    return {
      stop_reason: "end_turn",
      content: [{ type: "text", text: '{"ok":true}' }],
      usage: { input_tokens: 20, output_tokens: 15 },
    };
  });
  const resp = await createMessage(
    { model: "m", max_tokens: 100, messages: [{ role: "user", content: "hi" }] },
    { attempts: 1, label: "pause test" }
  );
  assert.equal(calls.length, 2);
  assert.equal(resp.stop_reason, "end_turn");
  // The continuation call must carry the paused assistant content back.
  const msgs = calls[1].params.messages;
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1].role, "assistant");
});

test("pause_turn continuation is bounded (never loops forever)", async () => {
  stub(() => ({
    stop_reason: "pause_turn",
    content: [{ type: "server_tool_use", id: "t", name: "web_search", input: {} }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
  const resp = await createMessage(
    { model: "m", max_tokens: 100, messages: [{ role: "user", content: "hi" }] },
    { attempts: 1, label: "pause bound test" }
  );
  assert.equal(calls.length, 6); // initial + 5 bounded continuations
  assert.equal(resp.stop_reason, "pause_turn");
});
