const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const roiController = require("../controllers/roiController");

// All ROI routes require auth + an account in good standing (lockout-gated).
router.use(auth, lockout);

router.get("/:brandId", roiController.getRoi);
router.get("/:brandId/history", roiController.getRoiHistory);
router.post("/:brandId/report", roiController.generateReport);

module.exports = router;
