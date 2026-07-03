const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const adminMiddleware = require("../middleware/admin");
const salesAgentController = require("../controllers/salesAgentController");

// ---------------------------------------------------------------------------
// Twilio webhooks + owner join link — NO auth. Twilio's servers (and the owner
// tapping the SMS link) hit these directly; authenticity of the Twilio calls is
// enforced via X-Twilio-Signature inside the handlers using the sales auth
// token. This is EchoAI's OWN dedicated sales number, separate from /api/phone.
// ---------------------------------------------------------------------------
router.post("/inbound", salesAgentController.initiateDemoCall);
router.post("/voice/:callId", salesAgentController.handleSalesConversation);
router.post("/status", salesAgentController.handleSalesCallStatus);
router.get("/join/:callId", salesAgentController.handleJoinCall);
router.post("/conference/:callId", salesAgentController.handleConference);

// ---------------------------------------------------------------------------
// Admin-only management — this feature is for the platform owner, not customers.
// ---------------------------------------------------------------------------
router.use(auth, adminMiddleware);

router.get("/config", salesAgentController.getConfig);
router.put("/config", salesAgentController.saveConfig);
router.get("/calls", salesAgentController.getSalesCalls);
router.get("/live", salesAgentController.getLiveCalls);
router.get("/performance", salesAgentController.getPerformance);
router.get("/calls/:callId", salesAgentController.getSalesCallDetail);
router.post("/calls/:callId/invite", salesAgentController.triggerInvite);
router.post("/calls/:callId/ask-echo", salesAgentController.askEcho);
router.post("/calls/:callId/book-demo", salesAgentController.bookDemo);

module.exports = router;
