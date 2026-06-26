const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const socialController = require("../controllers/socialController");

// All social routes require authentication and an active (non-locked) subscription.
router.use(auth, lockout);

router.post("/connect", socialController.connectSocialAccount);
router.post("/generate", socialController.generateSocialContent);
router.post("/schedule", socialController.schedulePost);
router.get("/calendar/:brandId", socialController.getSocialCalendar);
router.get("/accounts/:brandId", socialController.getSocialAccounts);
router.delete("/accounts/:brandId/:platform", socialController.disconnectSocialAccount);
router.get("/performance/:brandId", socialController.getPostPerformance);

module.exports = router;
