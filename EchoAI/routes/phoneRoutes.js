const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const {
  denyReadOnlyMutations,
  denySalesRep,
} = require("../middleware/rolePermissions");
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
// Sales reps never see raw call history / caller numbers here — they call leads
// only through the masked CRM bridge (/api/crm/call).
router.use(auth, lockout, featureGate("phone_agent"), denySalesRep, denyReadOnlyMutations);

// Twilio config (Settings panel)
router.post("/config", phoneController.saveTwilioConfig);
router.get("/config/:brandId", phoneController.getTwilioConfigStatus);
router.delete("/config/:brandId", phoneController.deleteTwilioConfig);

// Calls
router.post("/outbound", phoneController.initiateOutboundCall);
router.get("/history/:brandId", phoneController.getCallHistory);

module.exports = router;
