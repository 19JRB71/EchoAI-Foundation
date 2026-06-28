const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const controller = require("../controllers/emailMarketingController");

// ---------------------------------------------------------------------------
// Public, no-auth endpoints. Declared BEFORE the auth middleware so recipients
// can open/click-track and unsubscribe straight from an email without a session.
// ---------------------------------------------------------------------------
router.get("/open/:recipientId", controller.trackOpen);
router.get("/click/:recipientId", controller.trackClick);
router.get("/unsubscribe", controller.unsubscribe);
router.post("/unsubscribe", controller.unsubscribe);

// ---------------------------------------------------------------------------
// Everything below requires auth + an active account + Professional tier.
// Order is always auth -> lockout -> featureGate (never gate before lockout).
// ---------------------------------------------------------------------------
router.use(auth, lockout, featureGate("email_marketing"));

// AI generation
router.post("/generate-email", controller.generateCampaignEmail);
router.post("/generate-drip", controller.generateDripSequence);

// Campaign creation
router.post("/campaigns", controller.createCampaign);
router.post("/drip", controller.createDripSequence);

// Lifecycle controls
router.post("/campaigns/:campaignId/send", controller.sendCampaign);
router.post("/campaigns/:campaignId/pause", controller.pauseCampaign);
router.post("/campaigns/:campaignId/resume", controller.resumeCampaign);
router.delete("/campaigns/:campaignId", controller.cancelCampaign);

// Reads (brand-scoped lists + single campaign detail)
router.get("/campaigns/:brandId", controller.getCampaigns);
router.get("/campaign/:campaignId", controller.getCampaignDetail);
router.get("/contacts/:brandId", controller.getContacts);
router.get("/analytics/:brandId", controller.getAnalytics);

module.exports = router;
