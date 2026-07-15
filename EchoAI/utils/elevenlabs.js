/**
 * ElevenLabs client — thin wrappers over the ElevenLabs HTTP API used for all of
 * Echo's spoken audio and the morning wake-up music intro.
 *
 *  - `synthesize(text)`      → MP3 Buffer via the low-latency STREAMING TTS
 *                              endpoint. We use the `/stream` endpoint (with
 *                              `optimize_streaming_latency`) so ElevenLabs starts
 *                              emitting audio sooner, but we buffer the full body
 *                              server-side so an upstream error can still fall
 *                              back to OpenAI TTS cleanly (a piped stream cannot
 *                              fall back once headers are flushed).
 *  - `generateSound(prompt)` → MP3 Buffer via the sound-generation endpoint,
 *                              used for the 3–4s upbeat wake-up intro.
 *
 * Every failure throws so the caller can decide whether to fall back (TTS) or
 * skip silently (the wake-up intro must never block the briefing).
 */

const {
  API_BASE,
  TTS_MODEL,
  OUTPUT_FORMAT,
  apiKey,
  voiceId,
  ttsConfigured,
  soundConfigured,
} = require("../config/elevenlabs");

const { recordCommsUsage, UNIT_PRICES } = require("./aiUsage");

// Balanced voice settings: stable but still expressive/energetic.
const VOICE_SETTINGS = {
  stability: 0.4,
  similarity_boost: 0.75,
  style: 0.35,
  use_speaker_boost: true,
};

async function readError(resp) {
  const body = await resp.text().catch(() => "");
  return `ElevenLabs ${resp.status}: ${body.slice(0, 300) || resp.statusText}`;
}

/**
 * Build a tagged Error from a non-ok ElevenLabs response. We distinguish two
 * failure classes so callers can decide whether a fallback is legitimate:
 *  - `reachableButRefused` (4xx): the service answered but rejected us — bad key,
 *    quota exceeded, unknown voice, malformed request. These are FIXABLE
 *    account/config problems; masking them behind another voice provider hides
 *    the real issue, so callers must surface them instead of falling back.
 *  - unreachable (5xx or a thrown network/timeout error): a transient outage
 *    where a fallback keeps voice alive.
 */
async function makeHttpError(resp) {
  const err = new Error(await readError(resp));
  err.elevenLabsStatus = resp.status;
  err.reachableButRefused = resp.status >= 400 && resp.status < 500;
  return err;
}

/**
 * Synthesize `text` to an MP3 Buffer using the configured voice. Uses the
 * streaming endpoint for faster time-to-first-byte. Throws on any failure.
 */
async function synthesize(text, { voiceId: overrideVoice } = {}) {
  const useVoice = overrideVoice || voiceId();
  if (!apiKey() || !useVoice) {
    throw new Error("ElevenLabs TTS is not configured");
  }
  const url =
    `${API_BASE}/text-to-speech/${encodeURIComponent(useVoice)}/stream` +
    `?output_format=${encodeURIComponent(OUTPUT_FORMAT)}&optimize_streaming_latency=4`;

  const chars = Math.min(String(text).length, 5000);
  const startedAt = Date.now();
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey(),
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: String(text).slice(0, 5000),
        model_id: TTS_MODEL,
        voice_settings: VOICE_SETTINGS,
      }),
    });
  } catch (err) {
    recordTts(chars, startedAt, false, "network");
    throw err;
  }

  if (!resp.ok) {
    recordTts(chars, startedAt, false, resp.status >= 500 ? "provider_error" : "auth");
    throw await makeHttpError(resp);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  if (!buf.length) throw new Error("ElevenLabs TTS returned empty audio");
  recordTts(chars, startedAt, true, null);
  return buf;
}

// Ledger write for one TTS synthesis. Fire-and-forget; never blocks audio.
function recordTts(chars, startedAt, success, errorCategory) {
  recordCommsUsage({
    provider: "elevenlabs",
    unitType: "tts_chars",
    unitQuantity: chars,
    estimatedCostUsd: (chars / 1000) * UNIT_PRICES["elevenlabs:tts_per_1k_chars"],
    model: TTS_MODEL,
    feature: "voice_tts",
    durationMs: Date.now() - startedAt,
    success,
    errorCategory,
    // ElevenLabs bills per character even on some failures; unknown → null.
    providerChargedOnFailure: success ? null : false,
  });
}

/**
 * Generate a short sound effect / music sting from a text prompt. Returns an MP3
 * Buffer. `durationSeconds` is clamped to the API's supported range.
 */
async function generateSound(prompt, { durationSeconds = 4, promptInfluence = 0.5 } = {}) {
  if (!apiKey()) {
    throw new Error("ElevenLabs sound generation is not configured");
  }
  const duration = Math.min(22, Math.max(0.5, Number(durationSeconds) || 4));

  const resp = await fetch(`${API_BASE}/sound-generation`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey(),
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: String(prompt).slice(0, 500),
      duration_seconds: duration,
      prompt_influence: Math.min(1, Math.max(0, promptInfluence)),
    }),
  });

  if (!resp.ok) throw new Error(await readError(resp));
  const buf = Buffer.from(await resp.arrayBuffer());
  if (!buf.length) throw new Error("ElevenLabs sound generation returned empty audio");
  recordCommsUsage({
    provider: "elevenlabs",
    unitType: "sound_generation",
    unitQuantity: 1,
    feature: "voice_sound",
    success: true,
  });
  return buf;
}

module.exports = {
  synthesize,
  generateSound,
  ttsConfigured,
  soundConfigured,
};
