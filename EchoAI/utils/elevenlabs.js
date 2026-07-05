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

// Balanced voice settings: stable but still expressive/energetic.
const VOICE_SETTINGS = {
  stability: 0.4,
  similarity_boost: 0.75,
  style: 0.35,
  use_speaker_boost: true,
};

async function readError(resp) {
  const body = await resp.text().catch(() => "");
  return `ElevenLabs ${resp.status}: ${body.slice(0, 200) || resp.statusText}`;
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
    `?output_format=${encodeURIComponent(OUTPUT_FORMAT)}&optimize_streaming_latency=3`;

  const resp = await fetch(url, {
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

  if (!resp.ok) throw new Error(await readError(resp));
  const buf = Buffer.from(await resp.arrayBuffer());
  if (!buf.length) throw new Error("ElevenLabs TTS returned empty audio");
  return buf;
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
  return buf;
}

module.exports = {
  synthesize,
  generateSound,
  ttsConfigured,
  soundConfigured,
};
