const express = require("express");

const campaignController = require("../controllers/campaignController");
const campaignControlController = require("../controllers/campaignControlController");
const authMiddleware = require("../middleware/auth");
const lockoutCheck = require("../middleware/lockout");
const { denyViewerMutations, requireOwner } = require("../middleware/rolePermissions");

const router = express.Router();

// All campaign routes require a valid JWT and an unlocked account. Viewers may
// read but not launch/modify campaigns.
router.use(authMiddleware, lockoutCheck, denyViewerMutations);

router.post("/connect", campaignController.connectFacebookAccount);
router.post("/", campaignController.createCampaign);
router.get("/performance", campaignController.getCampaignPerformance);
router.post("/optimize", campaignController.optimizeCampaign);
router.post("/generate-creative", campaignController.generateAdCreative);

// Prompt 015: spending caps + pause/unpause delivery controls. Owner-only —
// these change (or gate changing) real ad delivery. Lives in its own
// controller module, never in a launch path.
router.get("/spend-cap", requireOwner, campaignControlController.getSpendCap);
router.put("/spend-cap", requireOwner, campaignControlController.setSpendCap);
router.post("/:campaignId/unpause", requireOwner, campaignControlController.unpauseCampaign);
router.post("/:campaignId/pause", requireOwner, campaignControlController.pauseCampaign);
router.post("/:campaignId/refresh-status", requireOwner, campaignControlController.refreshStatus);
router.get("/:campaignId/audit", requireOwner, campaignControlController.getAuditTrail);

module.exports = router;
