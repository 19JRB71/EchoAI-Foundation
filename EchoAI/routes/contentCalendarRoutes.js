const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const { denyViewerMutations } = require("../middleware/rolePermissions");
const contentCalendarController = require("../controllers/contentCalendarController");

// All content-calendar routes require authentication and an active subscription.
// Viewers may read but not generate/modify content.
router.use(auth, lockout, featureGate("content_calendar"), denyViewerMutations);

router.post("/generate", contentCalendarController.generateCalendar);
router.post("/", contentCalendarController.saveCalendar);
router.get("/:brandId", contentCalendarController.getCalendar);
router.post("/activate", contentCalendarController.activateCalendar);
router.post("/pause", contentCalendarController.pauseCalendar);
router.post("/regenerate-post", contentCalendarController.regeneratePost);
router.put("/post/:postId", contentCalendarController.updatePost);

module.exports = router;
