const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const leadController = require("../controllers/leadController");
const chatbotController = require("../controllers/chatbotController");

// Public chatbot route — prospects are not logged-in users, so no auth/lockout.
router.post("/chat", chatbotController.chat);

// All remaining lead routes require authentication and an active subscription.
router.use(auth, lockout);

router.post("/", leadController.createLead);
router.get("/", leadController.getLeads);
router.get("/:leadId", leadController.getLeadProfile);
router.put("/:leadId", leadController.updateLead);
router.post("/:leadId/convert", leadController.convertLead);

module.exports = router;
