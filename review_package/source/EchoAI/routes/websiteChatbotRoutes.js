const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const chatbot = require("../controllers/websiteChatbotController");

// ---------------------------------------------------------------------------
// PUBLIC routes — called by the embeddable widget from arbitrary third-party
// websites. No auth: website visitors are not logged in. CORS is opened for
// these specific paths in server.js so the widget works on any domain.
// ---------------------------------------------------------------------------
router.get("/config/:brandId", chatbot.getChatbotConfig);
router.post("/chat", chatbot.chat);
router.post("/capture", chatbot.captureLead);

// ---------------------------------------------------------------------------
// Owner routes — auth + account in good standing.
// ---------------------------------------------------------------------------
router.use(auth, lockout);

router.get("/sessions/:brandId", chatbot.getChatbotSessions);
router.get("/admin-config/:brandId", chatbot.getChatbotConfigForOwner);
router.put("/config/:brandId", chatbot.saveChatbotConfig);

module.exports = router;
