const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const musicController = require("../controllers/musicController");

// Music is a personal in-dashboard convenience (background focus/morning music),
// available to any authenticated user — no lockout/feature gate. Search needs
// YOUTUBE_API_KEY; it degrades to 503 when unset.
router.use(auth);

router.get("/status", musicController.status);
router.get("/search", musicController.search);

module.exports = router;
