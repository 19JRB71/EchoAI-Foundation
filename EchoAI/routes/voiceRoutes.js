const express = require("express");
const multer = require("multer");

const authMiddleware = require("../middleware/auth");
const featureGate = require("../middleware/featureGate");
const voiceController = require("../controllers/voiceController");

// Audio uploads are held in memory and forwarded straight to OpenAI. Cap the
// size and reject non-audio uploads so a malicious/oversized file can't exhaust
// memory or reach the transcription API.
const MAX_AUDIO_BYTES = Number(process.env.MAX_AUDIO_UPLOAD_BYTES) || 25 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("audio/")) return cb(null, true);
    cb(new Error("Only audio uploads are allowed"));
  },
});

// Wrap multer so size/type violations return a clean 400 instead of bubbling to
// the global 500 handler.
function uploadAudio(req, res, next) {
  upload.single("audio")(req, res, (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? "Audio file too large" : err.message;
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

const router = express.Router();

// Protected: converting a prospect's audio to text and an AI reply to speech are
// internal tools used by authenticated parts of the platform.
router.post(
  "/speech-to-text",
  authMiddleware,
  featureGate("voice_chatbot"),
  uploadAudio,
  voiceController.transcribeSpeech
);
router.post(
  "/text-to-speech",
  authMiddleware,
  featureGate("voice_chatbot"),
  voiceController.generateSpeech
);

// Public: the full voice conversation loop is used by prospects, who are not
// logged in.
router.post("/chat", uploadAudio, voiceController.voiceChat);

module.exports = router;
