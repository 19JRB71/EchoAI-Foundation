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

beforeEach(() => {
  db.query = realQuery;
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

// --- saveProgress ----------------------------------------------------------------

test("saveProgress rejects an unknown step with 400 and never hits the DB", async () => {
  let called = 0;
  db.query = async () => {
    called += 1;
    return { rows: [] };
  };
  const res = mockRes();
  await controller.saveProgress(req({ currentStep: "hack", connections: {} }), res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(called, 0);
});

test("saveProgress upserts the sanitized payload", async () => {
  const calls = [];
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [] };
  };
  const res = mockRes();
  await controller.saveProgress(
    req({
      currentStep: "connections",
      connections: { facebook: { connecting: true, hacked: true }, other: {} },
    }),
    res,
  );
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].sql, /ON CONFLICT \(user_id\)/);
  assert.strictEqual(calls[0].params[1], "connections");
  assert.deepStrictEqual(JSON.parse(calls[0].params[2]), { facebook: { connecting: true } });
  assert.deepStrictEqual(res.body.connections, { facebook: { connecting: true } });
});

// --- getState ---------------------------------------------------------------------

test("getState reports probe failures as unknown, never fabricated", async () => {
  db.query = async (sql, params) => {
    if (/FROM guided_setup_progress/.test(sql)) {
      return {
        rows: [
          {
            current_step: "connections",
            connections: { facebook: { skipped: true } },
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
