const { toFile } = require("openai");
const { openai, STT_MODEL, TTS_MODEL, TTS_VOICE } = require("../config/openai");
const chatbotController = require("./chatbotController");

// OpenAI's supported TTS voices. Any other "voice style" falls back to default.
const VALID_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];

function resolveVoice(voice) {
  return VALID_VOICES.includes(voice) ? voice : TTS_VOICE;
}

/**
 * Converts text into natural-sounding speech (MP3) using the OpenAI TTS API.
 * Returns the audio as a Buffer.
 */
async function synthesizeSpeech(text, voice) {
  const speech = await openai.audio.speech.create({
    model: TTS_MODEL,
    voice: resolveVoice(voice),
    input: text,
  });
  const arrayBuffer = await speech.arrayBuffer();
  return Buffer.from(arrayBuffer);
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
    const audio = await synthesizeSpeech(text, voice);
    res.setHeader("Content-Type", "audio/mpeg");
    return res.send(audio);
  } catch (err) {
    console.error("Generate speech error:", err.message);
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
    const audio = await synthesizeSpeech(reply, voice);

    return res.json({
      leadId,
      transcript,
      reply,
      audio: audio.toString("base64"),
      audioFormat: "audio/mpeg",
    });
  } catch (err) {
    console.error("Voice chat error:", err.message);
    return res.status(500).json({ error: "Voice chat failed" });
  }
}

module.exports = { generateSpeech, transcribeSpeech, transcribeAudio, voiceChat };
