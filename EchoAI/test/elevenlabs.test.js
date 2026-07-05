const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const elevenlabsConfig = require("../config/elevenlabs");
const elevenlabs = require("../utils/elevenlabs");
const openaiConfig = require("../config/openai");
const { synthesizeSpeech, isVoiceConfigured } = require("../controllers/voiceController");

// ---- env helpers ----------------------------------------------------------
const ENV_KEYS = ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "OPENAI_API_KEY"];
let savedEnv;
let savedFetch;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  savedFetch = global.fetch;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  global.fetch = savedFetch;
});

function okAudio(bytes = [1, 2, 3, 4]) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  };
}

/* ----------------------------- config gating ------------------------------ */

test("ttsConfigured requires BOTH api key and voice id", () => {
  process.env.ELEVENLABS_API_KEY = "";
  process.env.ELEVENLABS_VOICE_ID = "";
  assert.strictEqual(elevenlabsConfig.ttsConfigured(), false);

  process.env.ELEVENLABS_API_KEY = "k";
  assert.strictEqual(elevenlabsConfig.ttsConfigured(), false, "voice id still missing");

  process.env.ELEVENLABS_VOICE_ID = "v";
  assert.strictEqual(elevenlabsConfig.ttsConfigured(), true);
});

test("soundConfigured needs only the api key (voice-less)", () => {
  process.env.ELEVENLABS_API_KEY = "";
  process.env.ELEVENLABS_VOICE_ID = "";
  assert.strictEqual(elevenlabsConfig.soundConfigured(), false);

  process.env.ELEVENLABS_API_KEY = "k";
  assert.strictEqual(elevenlabsConfig.soundConfigured(), true);
});

/* ------------------------------ TTS synthesize ---------------------------- */

test("synthesize posts to the streaming endpoint with the configured voice", async () => {
  process.env.ELEVENLABS_API_KEY = "secret-key";
  process.env.ELEVENLABS_VOICE_ID = "voice-123";
  let calledUrl = null;
  let calledHeaders = null;
  global.fetch = async (url, opts) => {
    calledUrl = url;
    calledHeaders = opts.headers;
    return okAudio();
  };

  const buf = await elevenlabs.synthesize("hello world");
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 0);
  assert.match(calledUrl, /\/text-to-speech\/voice-123\/stream/);
  assert.match(calledUrl, /optimize_streaming_latency/);
  assert.strictEqual(calledHeaders["xi-api-key"], "secret-key");
});

test("synthesize throws on a non-ok response (so callers can fall back)", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  process.env.ELEVENLABS_VOICE_ID = "v";
  global.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => "unauthorized",
    statusText: "Unauthorized",
  });
  await assert.rejects(() => elevenlabs.synthesize("hi"), /ElevenLabs 401/);
});

test("synthesize throws on empty audio", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  process.env.ELEVENLABS_VOICE_ID = "v";
  global.fetch = async () => okAudio([]);
  await assert.rejects(() => elevenlabs.synthesize("hi"), /empty audio/);
});

/* ---------------------------- sound generation ---------------------------- */

test("generateSound clamps duration and hits the sound-generation endpoint", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  let body = null;
  let url = null;
  global.fetch = async (u, opts) => {
    url = u;
    body = JSON.parse(opts.body);
    return okAudio([9, 9, 9]);
  };
  const buf = await elevenlabs.generateSound("upbeat sting", { durationSeconds: 999 });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 0);
  assert.match(url, /\/sound-generation$/);
  assert.ok(body.duration_seconds <= 22, "duration clamped to the API max");
});

/* --------------------- voiceController orchestration ---------------------- */

test("isVoiceConfigured is true when either provider is configured", () => {
  process.env.ELEVENLABS_API_KEY = "";
  process.env.ELEVENLABS_VOICE_ID = "";
  process.env.OPENAI_API_KEY = "";
  assert.strictEqual(isVoiceConfigured(), false);

  process.env.OPENAI_API_KEY = "openai";
  assert.strictEqual(isVoiceConfigured(), true, "OpenAI alone counts");

  process.env.OPENAI_API_KEY = "";
  process.env.ELEVENLABS_API_KEY = "k";
  process.env.ELEVENLABS_VOICE_ID = "v";
  assert.strictEqual(isVoiceConfigured(), true, "ElevenLabs alone counts");
});

test("synthesizeSpeech prefers ElevenLabs when configured (no OpenAI call)", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  process.env.ELEVENLABS_VOICE_ID = "v";
  global.fetch = async () => okAudio([7, 7, 7]);

  const savedCreate = openaiConfig.openai.audio.speech.create;
  let openaiCalled = false;
  openaiConfig.openai.audio.speech.create = async () => {
    openaiCalled = true;
    return { arrayBuffer: async () => Uint8Array.from([0]).buffer };
  };
  try {
    const buf = await synthesizeSpeech("hi", "friendly");
    assert.deepStrictEqual([...buf], [7, 7, 7]);
    assert.strictEqual(openaiCalled, false);
  } finally {
    openaiConfig.openai.audio.speech.create = savedCreate;
  }
});

test("synthesizeSpeech falls back to OpenAI when ElevenLabs errors", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  process.env.ELEVENLABS_VOICE_ID = "v";
  global.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => "boom",
    statusText: "Server Error",
  });

  const savedCreate = openaiConfig.openai.audio.speech.create;
  openaiConfig.openai.audio.speech.create = async () => ({
    arrayBuffer: async () => Uint8Array.from([5, 5]).buffer,
  });
  try {
    const buf = await synthesizeSpeech("hi", "friendly");
    assert.deepStrictEqual([...buf], [5, 5]);
  } finally {
    openaiConfig.openai.audio.speech.create = savedCreate;
  }
});

test("synthesizeSpeech uses OpenAI directly when ElevenLabs is not configured", async () => {
  process.env.ELEVENLABS_API_KEY = "";
  process.env.ELEVENLABS_VOICE_ID = "";
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    return okAudio();
  };
  const savedCreate = openaiConfig.openai.audio.speech.create;
  openaiConfig.openai.audio.speech.create = async () => ({
    arrayBuffer: async () => Uint8Array.from([2, 2]).buffer,
  });
  try {
    const buf = await synthesizeSpeech("hi", "friendly");
    assert.deepStrictEqual([...buf], [2, 2]);
    assert.strictEqual(fetchCalled, false, "ElevenLabs never contacted");
  } finally {
    openaiConfig.openai.audio.speech.create = savedCreate;
  }
});
