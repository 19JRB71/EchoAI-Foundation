const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const contentCalendarController = require("../controllers/contentCalendarController");

// All content-calendar routes require authentication and an active subscription.
router.use(auth, lockout, featureGate("content_calendar"));

router.post("/generate", contentCalendarController.generateCalendar);
router.post("/", contentCalendarController.saveCalendar);
router.get("/:brandId", contentCalendarController.getCalendar);
router.post("/activate", contentCalendarController.activateCalendar);
router.post("/pause", contentCalendarController.pauseCalendar);
router.post("/regenerate-post", contentCalendarController.regeneratePost);
router.put("/post/:postId", contentCalendarController.updatePost);

module.exports = router;
