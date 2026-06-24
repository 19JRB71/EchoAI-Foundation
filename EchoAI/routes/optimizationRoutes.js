const express = require("express");

const optimizationController = require("../controllers/optimizationController");
const authMiddleware = require("../middleware/auth");
const lockoutCheck = require("../middleware/lockout");

const router = express.Router();

// All optimization routes require a valid JWT and an unlocked account.
router.use(authMiddleware, lockoutCheck);

router.post("/competitors", optimizationController.runCompetitorAnalysis);
router.post("/auto", optimizationController.autoOptimizeCampaigns);
router.get("/history/:brandId", optimizationController.getOptimizationHistory);

module.exports = router;
