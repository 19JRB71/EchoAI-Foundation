// Task: pin the Setup Agent voice-input fallback endpoint's controller behavior.
//
// POST /api/setup-agent/transcribe reuses the existing Whisper infra
// (voiceController.transcribeAudio) and must:
//   - 400 when no audio file was uploaded,
//   - return the trimmed transcript on success,
//   - map an upstream Whisper failure to 502 (never a generic 500, never mocked).
//
// The route's auth/lockout/owner guards and multipart size/type limits are the
// standard middleware exercised elsewhere; here we unit-test the handler with a
// fake req/res and a mocked transcribeAudio (no DB, no OpenAI).

const { test, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const voiceController = require("../controllers/voiceController");
const controller = require("../controllers/setupAgentController");
const { db } = require("./helpers");

after(async () => {
  await db.pool.end();
});

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("400 when no audio file is uploaded", async () => {
  const res = makeRes();
  await controller.transcribeVoiceInput({ file: undefined }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /audio/i);
});

test("returns the trimmed transcript on success", async () => {
  const t = mock.method(voiceController, "transcribeAudio", async () => "  We sell candles.  ");
  try {
    const res = makeRes();
    await controller.transcribeVoiceInput({ file: { buffer: Buffer.from("x") } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.text, "We sell candles.");
    assert.equal(t.mock.callCount(), 1);
  } finally {
    t.mock.restore();
  }
});

test("maps an upstream Whisper failure to 502 (not 500)", async () => {
  const t = mock.method(voiceController, "transcribeAudio", async () => {
    throw new Error("openai down");
  });
  try {
    const res = makeRes();
    await controller.transcribeVoiceInput({ file: { buffer: Buffer.from("x") } }, res);
    assert.equal(res.statusCode, 502);
    assert.match(res.body.error, /transcribe/i);
  } finally {
    t.mock.restore();
  }
});
