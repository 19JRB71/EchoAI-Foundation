const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const zapierController = require("../controllers/zapierController");

// All webhook-management routes require authentication and an active
// (non-locked) subscription.
router.use(auth, lockout);

router.post("/", zapierController.createWebhook);
router.post("/test", zapierController.testWebhook);
router.get("/:brandId", zapierController.listWebhooks);
router.delete("/:webhookId", zapierController.deleteWebhook);

module.exports = router;
