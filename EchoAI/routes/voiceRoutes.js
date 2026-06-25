const express = require("express");
const multer = require("multer");

const authMiddleware = require("../middleware/auth");
const voiceController = require("../controllers/voiceController");

// Audio uploads are held in memory and forwarded straight to OpenAI.
const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

// Protected: converting a prospect's audio to text and an AI reply to speech are
// internal tools used by authenticated parts of the platform.
router.post(
  "/speech-to-text",
  authMiddleware,
  upload.single("audio"),
  voiceController.transcribeSpeech
);
router.post("/text-to-speech", authMiddleware, voiceController.generateSpeech);

// Public: the full voice conversation loop is used by prospects, who are not
// logged in.
router.post("/chat", upload.single("audio"), voiceController.voiceChat);

module.exports = router;
