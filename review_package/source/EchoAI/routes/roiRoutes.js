const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const roiController = require("../controllers/roiController");
const roiDashboardController = require("../controllers/roiDashboardController");

// All ROI routes require auth + an account in good standing (lockout-gated).
router.use(auth, lockout);

// --- Advanced ROI Dashboard (Enterprise). auth → lockout → featureGate. ---
const enterprise = featureGate("advanced_roi");
router.get("/:brandId/advanced/summary", enterprise, roiDashboardController.getAdvancedSummary);
router.post("/:brandId/advanced/analysis", enterprise, roiDashboardController.generateAdvancedAnalysis);
router.get("/:brandId/advanced/history", enterprise, roiDashboardController.getAdvancedHistory);
router.get("/:brandId/advanced/history/:snapshotId", enterprise, roiDashboardController.getAdvancedSnapshot);

// --- Basic ROI (all paid tiers) ---
router.get("/:brandId", roiController.getRoi);
router.get("/:brandId/history", roiController.getRoiHistory);
router.post("/:brandId/report", roiController.generateReport);

module.exports = router;
