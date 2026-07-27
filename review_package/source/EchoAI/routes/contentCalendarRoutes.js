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

// Per-platform posting-window settings for the "optimal" schedule. Declared
// before the "/:brandId" catch so "settings" isn't swallowed as a brand id.
router.get("/settings/:brandId", contentCalendarController.getPostingSettings);
router.put("/settings/:brandId", contentCalendarController.updatePostingSettings);

router.post("/generate", contentCalendarController.generateCalendar);
router.post("/", contentCalendarController.saveCalendar);
router.get("/:brandId", contentCalendarController.getCalendar);
router.post("/activate", contentCalendarController.activateCalendar);
router.post("/pause", contentCalendarController.pauseCalendar);
router.post("/regenerate-post", contentCalendarController.regeneratePost);
router.put("/post/:postId", contentCalendarController.updatePost);

module.exports = router;
