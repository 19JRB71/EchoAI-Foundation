const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const db = require("../config/db");

// ---------------------------------------------------------------------------
// Guided Setup wizard regressions.
//
// The AI analyzer and the screenshot persister are patched BEFORE the
// controller is required (it destructures both at require time), mirroring
// betaProgram.test.js. db.query is swapped per-test with in-memory fakes.
// ---------------------------------------------------------------------------

const promptModule = require("../prompts/guidedSetupPrompt");
let analyzeImpl = async () => {
  throw new Error("analyzeSetupHelpScreenshot not stubbed");
};
promptModule.analyzeSetupHelpScreenshot = (...args) => analyzeImpl(...args);

const healthMonitor = require("../controllers/healthMonitorController");
let persistImpl = async () => ({ base64: "abc", mediaType: "image/png", url: "/uploads/support/x.png" });
healthMonitor.persistScreenshot = (...args) => persistImpl(...args);

const controller = require("../controllers/guidedSetupController");
const { validateSetupHelpAnalysis } = promptModule;

const realQuery = db.query;
const realGetClient = db.getClient;
const RECOVERY = Object.freeze({
  clobbered: true,
  at: "2026-08-21T12:00:00.000Z",
  ref: "pm8b-11111111-1111-4111-8111-111111111111",
  note: "historical_connections_state_irrecoverable",
});

beforeEach(() => {
  db.query = realQuery;
  db.getClient = realGetClient;
  analyzeImpl = async () => {
    throw new Error("analyzeSetupHelpScreenshot not stubbed");
  };
  persistImpl = async () => ({
    base64: "abc",
    mediaType: "image/png",
    url: "/uploads/support/x.png",
  });
});

function mockRes() {
  const res = { statusCode: 200, body: null, ended: false };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  res.end = () => {
    res.ended = true;
    return res;
  };
  return res;
}

const req = (body) => ({ user: { userId: "u1" }, body });

function installProgressClient(initialConnections) {
  const calls = [];
  let stored = initialConnections;
  db.getClient = async () => ({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/SELECT connections FROM guided_setup_progress/.test(sql)) {
        return { rows: stored === undefined ? [] : [{ connections: stored }] };
      }
      if (/INSERT INTO guided_setup_progress/.test(sql)) {
        stored = JSON.parse(params[2]);
      }
      return { rows: [] };
    },
    release: () => {},
  });
  return { calls, stored: () => stored };
}

// --- validateSetupHelpAnalysis ------------------------------------------------

test("validateSetupHelpAnalysis passes a valid response through", () => {
  const out = validateSetupHelpAnalysis({
    screen: "Facebook login",
    nextAction: "Press Log In",
    confidence: "high",
  });
  assert.deepStrictEqual(out, {
    screen: "Facebook login",
    nextAction: "Press Log In",
    confidence: "high",
  });
});

test("validateSetupHelpAnalysis downgrades an invalid confidence to low", () => {
  const out = validateSetupHelpAnalysis({
    screen: "s",
    nextAction: "n",
    confidence: "certain",
  });
  assert.strictEqual(out.confidence, "low");
});

test("validateSetupHelpAnalysis throws aiInvalid on missing guidance", () => {
  for (const bad of [null, [], { screen: "s" }, { nextAction: "n" }, { screen: " ", nextAction: "n" }]) {
    assert.throws(
      () => validateSetupHelpAnalysis(bad),
      (err) => err.aiInvalid === true,
    );
  }
});

// --- sanitizeConnections --------------------------------------------------------

test("sanitizeConnections whitelists providers and fields", () => {
  const out = controller.sanitizeConnections({
    facebook: { skipped: true, connecting: "yes", errorKey: "denied", extra: 1 },
    google: { errorKey: `  ${"x".repeat(100)}  ` },
    tiktok: { skipped: true },
    junk: "str",
  });
  assert.deepStrictEqual(Object.keys(out).sort(), ["facebook", "google"]);
  assert.deepStrictEqual(out.facebook, { skipped: true, errorKey: "denied" });
  assert.strictEqual(out.google.errorKey.length, 64);
});

test("sanitizeConnections tolerates junk input", () => {
  assert.deepStrictEqual(controller.sanitizeConnections(null), {});
  assert.deepStrictEqual(controller.sanitizeConnections([1, 2]), {});
  assert.deepStrictEqual(controller.sanitizeConnections("nope"), {});
});

test("sanitizeConnections admits only the bounded PM8b recovery marker", () => {
  const out = controller.sanitizeConnections({
    _recovery: { ...RECOVERY, token: "never-store", arbitrary: true },
    arbitrary: { accepted: true },
  });
  assert.deepStrictEqual(out, { _recovery: RECOVERY });
  assert.deepStrictEqual(
    controller.sanitizeConnections({
      _recovery: { ...RECOVERY, clobbered: false, ref: "attacker-value" },
    }),
    {},
  );
});

// --- saveProgress ----------------------------------------------------------------

test("saveProgress rejects an unknown step with 400 and never hits the DB", async () => {
  let called = 0;
  db.getClient = async () => {
    called += 1;
  };
  const res = mockRes();
  await controller.saveProgress(req({ currentStep: "hack", connections: {} }), res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(called, 0);
});

test("saveProgress upserts the sanitized payload", async () => {
  const dbState = installProgressClient(undefined);
  const res = mockRes();
  await controller.saveProgress(
    req({
      currentStep: "connections",
      connections: { facebook: { connecting: true, hacked: true }, other: {} },
    }),
    res,
  );
  assert.strictEqual(res.statusCode, 200);
  const insert = dbState.calls.find(({ sql }) => /INSERT INTO guided_setup_progress/.test(sql));
  assert.match(insert.sql, /ON CONFLICT \(user_id\)/);
  assert.strictEqual(insert.params[1], "connections");
  assert.deepStrictEqual(JSON.parse(insert.params[2]), { facebook: { connecting: true } });
  assert.deepStrictEqual(res.body.connections, { facebook: { connecting: true } });
});

test("saveProgress preserves every omitted durable family through the real writer path", async () => {
  const seed = {
    facebook: { skipped: true, errorKey: "denied" },
    google: { skipped: true },
    email: { skipped: true },
    firstwin: { choice: "lead", done: true, skipped: false },
    parked: { parked: true, at: "2026-08-20T10:00:00.000Z" },
    _recovery: RECOVERY,
  };
  const dbState = installProgressClient(seed);
  const res = mockRes();
  await controller.saveProgress(
    req({ currentStep: "connections", connections: { google: { connecting: false } } }),
    res,
  );
  assert.deepStrictEqual(res.body.connections, {
    ...seed,
    google: { skipped: true, connecting: false },
  });
  assert.deepStrictEqual(dbState.stored(), res.body.connections);
});

test("saveProgress preserves explicit provider clears and OAuth transient cleanup", async () => {
  let dbState = installProgressClient({
    facebook: { skipped: true, connecting: true, errorKey: "denied" },
  });
  let res = mockRes();
  await controller.saveProgress(
    req({
      currentStep: "connections",
      connections: { facebook: { skipped: false, connecting: false, errorKey: null } },
    }),
    res,
  );
  assert.deepStrictEqual(res.body.connections.facebook, {
    skipped: false,
    connecting: false,
  });

  dbState = installProgressClient({
    facebook: { skipped: true, connecting: true, errorKey: "denied" },
  });
  res = mockRes();
  await controller.saveProgress(
    req({ currentStep: "connections", connections: { facebook: { skipped: false } } }),
    res,
  );
  assert.deepStrictEqual(dbState.stored().facebook, { skipped: false });
});

test("saveProgress honors full intent while keeping the first recovery marker immutable", async () => {
  const dbState = installProgressClient({
    facebook: { skipped: true, connecting: true, errorKey: "old" },
    firstwin: { choice: "lead", done: true, skipped: false },
    parked: { parked: true, at: "2026-08-20T10:00:00.000Z" },
    _recovery: RECOVERY,
  });
  const replacementMarker = {
    ...RECOVERY,
    at: "2026-08-22T12:00:00.000Z",
    ref: "pm8b-22222222-2222-4222-8222-222222222222",
  };
  const res = mockRes();
  await controller.saveProgress(
    req({
      currentStep: "team",
      connections: {
        facebook: { skipped: false, connecting: false, errorKey: null },
        firstwin: { choice: "post", done: true, skipped: false },
        parked: { parked: false, at: "2026-08-21T12:00:00.000Z" },
        _recovery: replacementMarker,
      },
    }),
    res,
  );
  assert.deepStrictEqual(res.body.connections, {
    facebook: { skipped: false, connecting: false },
    firstwin: { choice: "post", done: true, skipped: false },
    parked: { parked: false, at: "2026-08-21T12:00:00.000Z" },
    _recovery: RECOVERY,
  });
  assert.deepStrictEqual(dbState.stored(), res.body.connections);
});

// --- getState ---------------------------------------------------------------------

test("getState reports probe failures as unknown, never fabricated", async () => {
  db.query = async (sql, params) => {
    if (/FROM guided_setup_progress/.test(sql)) {
      return {
        rows: [
          {
            current_step: "connections",
            connections: {
              facebook: { skipped: true },
              junk: { persisted: true },
              _recovery: { ...RECOVERY, clobbered: false },
            },
            updated_at: "2026-07-11",
          },
        ],
      };
    }
    if (/FROM api_integrations/.test(sql)) throw new Error("fb probe down");
    if (/FROM google_integrations/.test(sql)) return { rows: [{ 1: 1 }] };
    if (/FROM setup_sessions/.test(sql)) throw new Error("sessions down");
    throw new Error(`unexpected query: ${sql}`);
  };
  const res = mockRes();
  await controller.getState(req({}), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.connectionStatus.facebook, "unknown");
  assert.strictEqual(res.body.connectionStatus.google, "connected");
  assert.deepStrictEqual(res.body.setupSession, { status: "unknown" });
  assert.strictEqual(res.body.progress.currentStep, "connections");
  assert.deepStrictEqual(res.body.progress.connections, { facebook: { skipped: true } });
});

test("getState returns null progress for a brand-new user", async () => {
  db.query = async (sql) => {
    if (/FROM setup_sessions/.test(sql)) return { rows: [] };
    return { rows: [] };
  };
  const res = mockRes();
  await controller.getState(req({}), res);
  assert.strictEqual(res.body.progress, null);
  assert.strictEqual(res.body.connectionStatus.facebook, "not_connected");
  assert.strictEqual(res.body.setupSession, null);
});

// --- helpAnalyze ---------------------------------------------------------------------

test("helpAnalyze returns the validated analysis with the stored screenshot URL", async () => {
  analyzeImpl = async () => ({ screen: "s", nextAction: "n", confidence: "high" });
  const res = mockRes();
  await controller.helpAnalyze(req({ screenshot: "data:image/png;base64,abc" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, {
    screen: "s",
    nextAction: "n",
    confidence: "high",
    screenshotUrl: "/uploads/support/x.png",
  });
});

test("helpAnalyze maps AI failures to 502, never fabricates guidance", async () => {
  for (const err of [
    Object.assign(new Error("bad json"), { aiInvalid: true }),
    Object.assign(new Error("anthropic down"), { status: 503 }),
  ]) {
    analyzeImpl = async () => {
      throw err;
    };
    const res = mockRes();
    await controller.helpAnalyze(req({ screenshot: "data:image/png;base64,abc" }), res);
    assert.strictEqual(res.statusCode, 502);
  }
});

test("helpAnalyze maps unexpected failures to 500", async () => {
  analyzeImpl = async () => {
    throw new Error("disk exploded");
  };
  const res = mockRes();
  await controller.helpAnalyze(req({ screenshot: "data:image/png;base64,abc" }), res);
  assert.strictEqual(res.statusCode, 500);
});

test("helpAnalyze rejects a missing screenshot with 400 and oversized with 413", async () => {
  persistImpl = async () => ({ base64: null, mediaType: null, url: null });
  let res = mockRes();
  await controller.helpAnalyze(req({}), res);
  assert.strictEqual(res.statusCode, 400);

  persistImpl = async () => {
    throw Object.assign(new Error("too big"), { tooLarge: true });
  };
  res = mockRes();
  await controller.helpAnalyze(req({ screenshot: "data:image/png;base64,huge" }), res);
  assert.strictEqual(res.statusCode, 413);
});

// --- reportConnectionError --------------------------------------------------------

test("reportConnectionError logs and returns 204", async () => {
  const res = mockRes();
  await controller.reportConnectionError(
    { user: { userId: "u1" }, body: { provider: "facebook", raw: "OAuthException code 190" } },
    res,
  );
  assert.strictEqual(res.statusCode, 204);
  assert.strictEqual(res.ended, true);
});
