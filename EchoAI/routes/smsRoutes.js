const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const { denyViewerMutations } = require("../middleware/rolePermissions");
const sms = require("../controllers/smsMarketingController");

// ---------------------------------------------------------------------------
// Twilio inbound SMS webhook — NO auth/lockout. Twilio's servers call this
// directly; authenticity is enforced via X-Twilio-Signature inside the handler.
// ---------------------------------------------------------------------------
router.post("/inbound", sms.handleInbound);

// ---------------------------------------------------------------------------
// Customer-facing routes — auth + account in good standing + Pro tier.
// ---------------------------------------------------------------------------
router.use(auth, lockout, featureGate("sms_marketing"), denyViewerMutations);

// Campaign copy generation + lifecycle
router.post("/generate", sms.generateMessages);
router.post("/campaigns", sms.createCampaign);
router.post("/campaigns/:campaignId/send", sms.sendCampaign);
router.get("/campaigns/:brandId", sms.getCampaigns);
router.get("/campaign/:campaignId", sms.getCampaignDetail);

// Two-way conversations
router.get("/conversations/:brandId", sms.getConversations);
router.post("/reply", sms.sendManualReply);

// Contacts + opt-out management
router.get("/contacts/:brandId", sms.getContacts);
router.post("/resubscribe", sms.resubscribe);

// Analytics
router.get("/analytics/:brandId", sms.getAnalytics);

module.exports = router;
