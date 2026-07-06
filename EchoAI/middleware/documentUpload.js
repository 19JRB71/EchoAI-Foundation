const multer = require("multer");

// Shared image/PDF upload middleware for Sage's Intelligence Input. Files are
// held in memory and forwarded straight to Anthropic (base64) for analysis, so
// cap the size and restrict the type to keep an oversized/malicious upload from
// exhausting memory or reaching the API.
const MAX_DOC_BYTES = Number(process.env.MAX_DOC_UPLOAD_BYTES) || 12 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOC_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const mime = file.mimetype || "";
    if (mime === "application/pdf" || mime.startsWith("image/")) return cb(null, true);
    cb(new Error("Only image or PDF uploads are allowed"));
  },
});

// Wrap multer so size/type violations return a clean 400 instead of a 500.
function uploadDocument(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? "File too large" : err.message;
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

module.exports = { uploadDocument, MAX_DOC_BYTES };
