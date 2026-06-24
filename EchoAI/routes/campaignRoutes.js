const express = require("express");

const campaignController = require("../controllers/campaignController");
const authMiddleware = require("../middleware/auth");
const lockoutCheck = require("../middleware/lockout");

const router = express.Router();

// All campaign routes require a valid JWT and an unlocked account.
router.use(authMiddleware, lockoutCheck);

router.post("/connect", campaignController.connectFacebookAccount);
router.post("/", campaignController.createCampaign);
router.get("/performance", campaignController.getCampaignPerformance);
router.post("/optimize", campaignController.optimizeCampaign);
router.post("/generate-creative", campaignController.generateAdCreative);

module.exports = router;
