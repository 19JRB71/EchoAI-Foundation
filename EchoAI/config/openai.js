require("dotenv").config();

const OpenAI = require("openai");
const { makeUnconfiguredClient } = require("../utils/optionalClient");

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

module.exports = { openai, STT_MODEL, TTS_MODEL, TTS_VOICE };
