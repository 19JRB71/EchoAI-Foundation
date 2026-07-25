/**
 * Mobile push-notification routes — mounted at /api/v2/push.
 * All routes require a valid (mobile) access token.
 */

const express = require("express");
const auth = require("../middleware/auth");
const mobilePushController = require("../controllers/mobilePushController");

const router = express.Router();

router.post("/register", auth, mobilePushController.registerDeviceToken);
router.delete("/register", auth, mobilePushController.unregisterDeviceToken);

module.exports = router;
