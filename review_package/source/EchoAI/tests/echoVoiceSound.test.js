// Pin the Echo Voice sound-effect endpoints' controller behavior.
//
// GET /api/echo-voice/sound/:name serves named ElevenLabs personality stings
// (wake, goodbye, thinking, hotlead, celebration, error). It must:
//   - 204 for an unknown effect name (before any generation),
//   - 204 when ElevenLabs sound generation isn't configured (best-effort: the
//     client just skips the sound, never errors),
//   - serve audio/mpeg for a known name when configured.
// The wakeup-intro endpoint shares the same best-effort 204-when-unconfigured
// contract, so it's covered here too.
//
// Owner/auth guards are standard middleware exercised elsewhere; here we unit
// test the handlers with a fake req/res and a mocked elevenlabs util (no OpenAI,
// no real generation).

const { test, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const elevenlabs = require("../utils/elevenlabs");
const controller = require("../controllers/echoVoiceController");
const { db } = require("./helpers");

// The "configured" case writes a fake cache file to uploads/audio; remove it so
// the test never leaves a bogus (non-audio) sting behind for the real app/git.
const CELEBRATION_CACHE = path.join(
  __dirname,
  "..",
  "uploads",
  "audio",
  "sfx-celebration.mp3",
);

after(async () => {
  try {
    fs.rmSync(CELEBRATION_CACHE, { force: true });
  } catch {
    /* best effort */
  }
  await db.pool.end();
});

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

test("unknown sound name → 204 (no generation attempted)", async () => {
  const gen = mock.method(elevenlabs, "generateSound", async () => {
    throw new Error("should not be called for an unknown name");
  });
  try {
    const res = makeRes();
    await controller.sound({ params: { name: "not-a-real-effect" } }, res);
    assert.equal(res.statusCode, 204);
    assert.equal(gen.mock.callCount(), 0);
  } finally {
    gen.mock.restore();
  }
});

test("known sound name → 204 when ElevenLabs sound isn't configured", async () => {
  const cfg = mock.method(elevenlabs, "soundConfigured", () => false);
  try {
    const res = makeRes();
    await controller.sound({ params: { name: "wake" } }, res);
    assert.equal(res.statusCode, 204);
  } finally {
    cfg.mock.restore();
  }
});

test("wakeup-intro → 204 when ElevenLabs sound isn't configured", async () => {
  const cfg = mock.method(elevenlabs, "soundConfigured", () => false);
  try {
    const res = makeRes();
    await controller.wakeupIntro({}, res);
    assert.equal(res.statusCode, 204);
  } finally {
    cfg.mock.restore();
  }
});

test("known sound name → audio/mpeg when configured", async () => {
  const cfg = mock.method(elevenlabs, "soundConfigured", () => true);
  const gen = mock.method(elevenlabs, "generateSound", async () =>
    Buffer.from("fake-mp3-bytes"),
  );
  try {
    const res = makeRes();
    await controller.sound({ params: { name: "celebration" } }, res);
    // Either freshly generated or served from an earlier cache — both are 200s
    // with the audio content type; the client must receive playable audio.
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["Content-Type"], "audio/mpeg");
    assert.ok(res.body && res.body.length > 0);
  } finally {
    cfg.mock.restore();
    gen.mock.restore();
  }
});
