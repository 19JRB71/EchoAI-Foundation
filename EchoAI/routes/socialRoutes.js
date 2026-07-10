const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const { denyViewerMutations } = require("../middleware/rolePermissions");
const socialController = require("../controllers/socialController");

// All social routes require authentication and an active (non-locked)
// subscription. Viewers may read but not post/modify.
router.use(auth, lockout, denyViewerMutations);

router.post("/connect", socialController.connectSocialAccount);
router.post("/facebook-page", socialController.setFacebookBrandPage);
router.post("/generate", socialController.generateSocialContent);
router.post("/schedule", socialController.schedulePost);
router.put("/posts/:postId/reschedule", socialController.reschedulePost);
router.get("/calendar/:brandId", socialController.getSocialCalendar);
router.get("/accounts/:brandId", socialController.getSocialAccounts);
router.delete("/accounts/:brandId/:platform", socialController.disconnectSocialAccount);
router.get("/performance/:brandId", socialController.getPostPerformance);

module.exports = router;
