const express = require("express");

const authMiddleware = require("../middleware/auth");
const lockoutCheck = require("../middleware/lockout");
const usageCapacityController = require("../controllers/usageCapacityController");

const router = express.Router();

// Customer-facing AI Workforce Capacity meter (percent only, no dollars).
router.get(
  "/capacity",
  authMiddleware,
  lockoutCheck,
  usageCapacityController.getCapacity,
);

module.exports = router;
