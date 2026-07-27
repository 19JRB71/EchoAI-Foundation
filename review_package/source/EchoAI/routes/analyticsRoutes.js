const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const analyticsController = require("../controllers/analyticsController");
const reportingController = require("../controllers/reportingController");

// All analytics routes require authentication and an active subscription.
router.use(auth, lockout);

// Read endpoints.
router.get("/:brandId", analyticsController.getAnalytics);
router.get("/:brandId/current", analyticsController.getCurrentWeekSummary);

// Manual triggers.
router.post("/:brandId/report", reportingController.generateReport);
router.post("/:brandId/record", analyticsController.recordWeeklyAnalytics);

module.exports = router;
