const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const emailCampaignController = require("../controllers/emailCampaignController");

// All email campaign routes require authentication and an active (non-locked)
// subscription.
router.use(auth, lockout);

router.post("/generate", emailCampaignController.generateSequence);
router.post("/", emailCampaignController.saveCampaign);
router.post("/:campaignId/send", emailCampaignController.sendCampaign);
router.get("/performance/:brandId", emailCampaignController.getCampaignPerformance);
router.get("/:brandId", emailCampaignController.getCampaigns);

module.exports = router;
