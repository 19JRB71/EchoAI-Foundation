require("dotenv").config();

const OpenAI = require("openai");

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "Warning: OPENAI_API_KEY is not set. Voice (speech-to-text and text-to-speech) calls will fail until it is configured."
  );
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Whisper for transcription; OpenAI TTS for natural-sounding speech.
const STT_MODEL = process.env.OPENAI_STT_MODEL || "whisper-1";
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "tts-1";
// "nova" is the default Echo voice: fast, natural, and energetic. Individual
// voice styles can still override this per the owner's Voice Settings.
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || "nova";

module.exports = { openai, STT_MODEL, TTS_MODEL, TTS_VOICE };
