require("dotenv").config();

const OpenAI = require("openai");
const { makeUnconfiguredClient } = require("../utils/optionalClient");
const { assertAiAllowed } = require("../utils/aiGate");
const { recordUsage, categorizeAiError, newRequestId, UNIT_PRICES } = require("../utils/aiUsage");

// ---------------------------------------------------------------------------
// Cost controls: OpenAI's paid chokepoints (Whisper STT, TTS, DALL-E images)
// pass through the SAME admission gate and usage ledger as Anthropic/Hermes —
// wired here on the shared client so no call site can bypass them. Blocked
// calls throw an honest 503 (err.aiBlocked), never mocked output.
// ---------------------------------------------------------------------------

// Estimated audio minutes from the uploaded file's byte size (Whisper bills per
// minute but the duration isn't known before upload). ~16 kB/s covers typical
// browser Opus/WebM voice recordings; floored at 6 seconds. Estimated is the
// honest best available — the ledger column is named estimated_cost_usd.
function estimateSttMinutes(file) {
  const bytes =
    (file && typeof file.size === "number" && file.size) ||
    (file && file.buffer && file.buffer.length) ||
    (Buffer.isBuffer(file) && file.length) ||
    0;
  return bytes > 0 ? Math.max(0.1, bytes / (16000 * 60)) : 1;
}

// DALL-E 3 list prices by size/quality (fallback: the flat configured price).
function estimateImageCost(params = {}) {
  const n = Math.max(1, Number(params.n) || 1);
  const hd = params.quality === "hd";
  const large = typeof params.size === "string" && params.size !== "1024x1024";
  let perImage;
  if (large) perImage = hd ? 0.12 : 0.08;
  else if (hd) perImage = 0.08;
  else perImage = 0.04;
  return n * (perImage || UNIT_PRICES["openai:image"]);
}

/**
 * Wrap one paid SDK method with gate + ledger. The gate runs BEFORE the SDK
 * call (no money moves when blocked); one ledger row per call, success or
 * failure — failures record $0 spend but keep the error category.
 */
function gated(target, methodName, { taskType, model, estimateCost }) {
  const original = target[methodName].bind(target);
  target[methodName] = async function (params, ...rest) {
    const meta = await assertAiAllowed("openai", {});
    const startedAt = Date.now();
    const base = {
      ...meta,
      provider: "openai",
      model: (params && params.model) || model,
      feature: meta.jobName || `openai-${taskType}`,
      // Ambient context (e.g. a scheduler job) may set a more specific task
      // type; fall back to the modality. Must come after the meta spread so a
      // null context value can't clobber it.
      taskType: meta.taskType || taskType,
      requestId: newRequestId(),
    };
    try {
      const response = await original(params, ...rest);
      recordUsage({
        ...base,
        estimatedCostUsd: estimateCost(params),
        durationMs: Date.now() - startedAt,
        success: true,
      });
      return response;
    } catch (err) {
      recordUsage({
        ...base,
        estimatedCostUsd: 0,
        durationMs: Date.now() - startedAt,
        success: false,
        errorCategory: categorizeAiError(err),
      });
      throw err;
    }
  };
}

function wireCostControls(client) {
  gated(client.audio.speech, "create", {
    taskType: "tts",
    model: TTS_MODEL,
    estimateCost: (p) =>
      (String((p && p.input) || "").length / 1000) * UNIT_PRICES["openai:tts_per_1k_chars"],
  });
  gated(client.audio.transcriptions, "create", {
    taskType: "stt",
    model: STT_MODEL,
    estimateCost: (p) => estimateSttMinutes(p && p.file) * UNIT_PRICES["openai:stt_per_minute"],
  });
  gated(client.images, "generate", {
    taskType: "image",
    model: "gpt-image-1",
    estimateCost: estimateImageCost,
  });
}

// The OpenAI SDK throws at construction when no key is available (arg undefined
// AND no OPENAI_API_KEY in env), which would crash the whole server at boot.
// Voice/image generation is optional, so build the client only when the key is
// present; otherwise use a stub that fails only if OpenAI is actually called.
let openai;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} else {
  console.warn(
    "Warning: OPENAI_API_KEY is not set. Voice/image generation is disabled; OpenAI calls will fail until it is configured."
  );
  openai = makeUnconfiguredClient("OpenAI (voice/image)", "OPENAI_API_KEY");
}

// Whisper for transcription; OpenAI TTS for natural-sounding speech.
const STT_MODEL = process.env.OPENAI_STT_MODEL || "whisper-1";
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "tts-1";
// "nova" is the default Echo voice: fast, natural, and energetic. Individual
// voice styles can still override this per the owner's Voice Settings.
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || "nova";

// Only a real client is wrapped: the unconfigured stub throws its honest
// "not configured" error on any access, so no money can move through it.
if (process.env.OPENAI_API_KEY) {
  wireCostControls(openai);
}

module.exports = {
  openai,
  STT_MODEL,
  TTS_MODEL,
  TTS_VOICE,
  // Test seams: wire the same gate+ledger wrapper around a stub client, and
  // check the cost estimators without touching the network.
  _wireCostControlsForTests: wireCostControls,
  _estimateSttMinutesForTests: estimateSttMinutes,
  _estimateImageCostForTests: estimateImageCost,
};
