const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const phoneController = require("../controllers/phoneController");

// ---------------------------------------------------------------------------
// Twilio webhooks — NO auth/lockout. Twilio's servers call these directly;
// authenticity is enforced via X-Twilio-Signature inside the handlers.
// ---------------------------------------------------------------------------
router.post("/inbound", phoneController.handleInboundCall);
router.post("/voice/:callId", phoneController.handleVoiceTurn);
router.post("/status", phoneController.handleCallStatus);

// ---------------------------------------------------------------------------
// Customer-facing routes — auth + account in good standing.
// ---------------------------------------------------------------------------
router.use(auth, lockout);

// Twilio config (Settings panel)
router.post("/config", phoneController.saveTwilioConfig);
router.get("/config/:brandId", phoneController.getTwilioConfigStatus);
router.delete("/config/:brandId", phoneController.deleteTwilioConfig);

// Calls
router.post("/outbound", phoneController.initiateOutboundCall);
router.get("/history/:brandId", phoneController.getCallHistory);

module.exports = router;
