/**
 * ElevenLabs configuration — the single source of truth for the ElevenLabs
 * text-to-speech + sound-generation integration. Values are read from the
 * environment at call time (via getters) so the integration activates as soon as
 * the credentials are present without any code change.
 *
 * Gating is intentionally split:
 *  - `ttsConfigured()` needs BOTH the API key and a voice id (TTS targets a voice)
 *  - `soundConfigured()` needs only the API key (sound generation is voice-less)
 *
 * When ElevenLabs is not configured, callers transparently fall back to OpenAI
 * TTS (see controllers/voiceController.js), so voice keeps working either way.
 */

const API_BASE = process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io/v1";
// Flash v2.5 is ElevenLabs' fastest model (~75ms inference) and supports the
// streaming endpoint — chosen for conversational latency; override if needed.
const TTS_MODEL = process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5";
const OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128";

function apiKey() {
  return process.env.ELEVENLABS_API_KEY || "";
}

function voiceId() {
  return process.env.ELEVENLABS_VOICE_ID || "";
}

/** TTS requires an API key AND a configured voice id. */
function ttsConfigured() {
  return Boolean(apiKey() && voiceId());
}

/** Sound generation (the wake-up intro) needs only the API key. */
function soundConfigured() {
  return Boolean(apiKey());
}

module.exports = {
  API_BASE,
  TTS_MODEL,
  OUTPUT_FORMAT,
  apiKey,
  voiceId,
  ttsConfigured,
  soundConfigured,
};
