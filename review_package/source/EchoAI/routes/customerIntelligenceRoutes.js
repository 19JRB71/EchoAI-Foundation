const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const ci = require("../controllers/customerIntelligenceController");

// The Customer Intelligence Engine is Zorecho's most advanced Enterprise feature.
// Order is always auth → lockout → featureGate (never gate before lockout).
router.use(auth, lockout);
const enterprise = featureGate("customer_intelligence");

router.get("/:brandId/brief", enterprise, ci.getIntelligenceBrief);
router.get("/:brandId/profile", enterprise, ci.getIntelligenceProfile);
router.get("/:brandId/trends", enterprise, ci.getIntelligenceTrends);
router.post("/:brandId/generate", enterprise, ci.regenerateIntelligence);
router.get("/:brandId/applied", enterprise, ci.getAppliedRecommendations);
router.post("/:brandId/applied", enterprise, ci.applyRecommendation);
router.patch("/:brandId/applied/:applicationId", enterprise, ci.updateAppliedRecommendation);

module.exports = router;
