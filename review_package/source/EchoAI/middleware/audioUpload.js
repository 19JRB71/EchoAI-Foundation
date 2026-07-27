const multer = require("multer");

// Shared audio-upload middleware. Audio blobs are held in memory and forwarded
// straight to OpenAI Whisper, so cap the size and reject non-audio uploads to
// keep a malicious/oversized file from exhausting memory or reaching the API.
// Reused by the voice chatbot (voiceRoutes) and the Setup Agent voice input.
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

module.exports = { uploadAudio, MAX_AUDIO_BYTES };
