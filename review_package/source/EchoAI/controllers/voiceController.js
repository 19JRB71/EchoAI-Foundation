const { toFile } = require("openai");
const { openai, STT_MODEL, TTS_MODEL, TTS_VOICE } = require("../config/openai");
const elevenlabs = require("../utils/elevenlabs");
const chatbotController = require("./chatbotController");

// OpenAI's supported TTS voices. Any other "voice style" falls back to default.
const VALID_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];

function resolveVoice(voice) {
  return VALID_VOICES.includes(voice) ? voice : TTS_VOICE;
}

/** OpenAI TTS synthesis (the fallback path). Returns an MP3 Buffer. */
async function openaiSpeech(text, voice) {
  const speech = await openai.audio.speech.create({
    model: TTS_MODEL,
    voice: resolveVoice(voice),
    input: text,
  });
  const arrayBuffer = await speech.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Converts text into natural-sounding speech (MP3), returned as a Buffer.
 *
 * ElevenLabs (the configured voice) is the intended provider for EVERY spoken
 * surface — briefings, reminders, alerts, Talk to Echo, and the public voice
 * chat all flow through here. Fallback policy is deliberately narrow so a broken
 * ElevenLabs account can't hide behind a different-sounding voice:
 *
 *  - ElevenLabs reachable-but-refused (4xx: bad key, quota exceeded, unknown
 *    voice) → NO fallback. We throw an `elevenlabs_error` so the caller surfaces
 *    the real problem (which the account owner must fix) instead of silently
 *    speaking in OpenAI's voice.
 *  - ElevenLabs unreachable (5xx / network / timeout) → fall back to OpenAI TTS
 *    (non-strict) so voice survives a transient outage. This is the only case
 *    where another provider is used.
 *  - ElevenLabs not configured → OpenAI TTS (non-strict).
 *
 * `opts.strict` (Sales Presentation Mode) takes precedence over the above: the
 * voice must never switch mid-demo, so ANY ElevenLabs problem — refusal (4xx) OR
 * outage (5xx/network) — collapses to one uniform `tts_unavailable` throw and the
 * caller shows a text notification (never OpenAI, never a surfaced 4xx detail).
 *
 * Every path logs the provider actually used so operators can confirm ElevenLabs
 * is active on each audio request (`opts.label` tags the surface, e.g. "speak").
 */
async function synthesizeSpeech(text, voice, opts = {}) {
  const strict = Boolean(opts && opts.strict);
  const label = (opts && opts.label) || "tts";

  if (elevenlabs.ttsConfigured()) {
    try {
      const audio = await elevenlabs.synthesize(text);
      console.log(`[voice:${label}] provider=elevenlabs bytes=${audio.length}`);
      return audio;
    } catch (err) {
      // Presentation mode: the voice must NEVER switch mid-demo, so ANY
      // ElevenLabs problem (refusal or outage) collapses to one uniform
      // `tts_unavailable` signal and the client shows a text notification.
      if (strict) {
        console.error(
          `[voice:${label}] ElevenLabs failed in strict mode — no fallback. ${err.message}`,
        );
        const e = new Error("ElevenLabs TTS unavailable");
        e.code = "tts_unavailable";
        throw e;
      }
      // 4xx: the request reached ElevenLabs and was refused (bad key, quota,
      // unknown voice). Never mask a fixable account problem with another voice.
      if (err && err.reachableButRefused) {
        console.error(
          `[voice:${label}] ElevenLabs REFUSED the request (status ${err.elevenLabsStatus}) — not falling back. ${err.message}`,
        );
        const e = new Error(`ElevenLabs error: ${err.message}`);
        e.code = "elevenlabs_error";
        e.elevenLabsStatus = err.elevenLabsStatus;
        throw e;
      }
      // Unreachable (5xx / network / timeout) in normal mode → keep voice alive.
      console.warn(
        `[voice:${label}] ElevenLabs unreachable — falling back to OpenAI TTS. ${err.message}`,
      );
    }
  } else if (strict) {
    const e = new Error("ElevenLabs TTS is not configured");
    e.code = "tts_unavailable";
    throw e;
  } else {
    console.warn(
      `[voice:${label}] ElevenLabs not configured — using OpenAI TTS fallback.`,
    );
  }

  const audio = await openaiSpeech(text, voice);
  console.log(`[voice:${label}] provider=openai bytes=${audio.length}`);
  return audio;
}

/** True when at least one TTS provider (ElevenLabs or OpenAI) is configured. */
function isVoiceConfigured() {
  return elevenlabs.ttsConfigured() || Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Transcribes an uploaded audio file into text using the OpenAI Whisper API.
 */
async function transcribeAudio(file) {
  const audio = await toFile(file.buffer, file.originalname || "audio.webm");
  const result = await openai.audio.transcriptions.create({
    file: audio,
    model: STT_MODEL,
  });
  return result.text;
}

/**
 * Invokes the lead qualification chatbot controller in-process with a synthetic
 * request/response so the full chatbot pipeline (reply, lead scoring, history,
 * CRM logging) is reused exactly. Resolves with the controller's status + payload.
 */
function invokeChatbot(leadId, message) {
  return new Promise((resolve, reject) => {
    const req = { body: { leadId, message } };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ statusCode: this.statusCode, payload });
      },
    };
    Promise.resolve(chatbotController.chat(req, res)).catch(reject);
  });
}

/**
 * POST /api/voice/text-to-speech  (protected)
 * Accepts { text, voice } and returns the spoken audio file (MP3).
 */
async function generateSpeech(req, res) {
  const { text, voice } = req.body;

  if (!text) {
    return res.status(400).json({ error: "text is required" });
  }

  try {
    const audio = await synthesizeSpeech(text, voice, { label: "text-to-speech" });
    res.setHeader("Content-Type", "audio/mpeg");
    return res.send(audio);
  } catch (err) {
    console.error("Generate speech error:", err.message);
    if (err && err.code === "elevenlabs_error") {
      return res
        .status(502)
        .json({ error: err.message, provider: "elevenlabs", code: "elevenlabs_error" });
    }
    return res.status(500).json({ error: "Failed to generate speech" });
  }
}

/**
 * POST /api/voice/speech-to-text  (protected)
 * Accepts an uploaded audio file ("audio") and returns { text }.
 */
async function transcribeSpeech(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: "An audio file is required" });
  }

  try {
    const text = await transcribeAudio(req.file);
    return res.json({ text });
  } catch (err) {
    console.error("Transcribe speech error:", err.message);
    return res.status(500).json({ error: "Failed to transcribe audio" });
  }
}

/**
 * POST /api/voice/chat  (PUBLIC — prospects are not authenticated)
 * The full voice loop: transcribe the prospect's audio, run it through the lead
 * qualification chatbot, synthesize the reply, and return the audio plus the
 * transcript so the client can play it and show a readable conversation.
 *
 * Request: multipart form with "audio" (file), "leadId", and optional "voice".
 */
async function voiceChat(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: "An audio file is required" });
  }

  const { leadId, voice } = req.body;

  if (!leadId) {
    return res.status(400).json({ error: "leadId is required" });
  }

  try {
    const transcript = await transcribeAudio(req.file);
    const result = await invokeChatbot(leadId, transcript);

    if (result.statusCode !== 200) {
      return res.status(result.statusCode).json(result.payload);
    }

    const reply = result.payload.reply;
    const audio = await synthesizeSpeech(reply, voice, { label: "voice-chat" });

    return res.json({
      leadId,
      transcript,
      reply,
      audio: audio.toString("base64"),
      audioFormat: "audio/mpeg",
    });
  } catch (err) {
    console.error("Voice chat error:", err.message);
    if (err && err.code === "elevenlabs_error") {
      return res
        .status(502)
        .json({ error: err.message, provider: "elevenlabs", code: "elevenlabs_error" });
    }
    return res.status(500).json({ error: "Voice chat failed" });
  }
}

module.exports = {
  synthesizeSpeech,
  isVoiceConfigured,
  generateSpeech,
  transcribeSpeech,
  transcribeAudio,
  voiceChat,
};
