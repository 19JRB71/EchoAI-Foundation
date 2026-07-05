const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const { requireOwner } = require("../middleware/rolePermissions");
const controller = require("../controllers/echoVoiceController");

// Echo Voice is the business owner's personal spoken assistant: an authenticated,
// non-locked, OWNER-ONLY surface. It is deliberately NOT feature-gated — voice is
// core to Echo across every tier, mirroring the setup-agent voice precedent.
router.use(auth, lockout, requireOwner);

// Voice preferences (enable/disable, style, volume, quiet hours, event toggles,
// auto-briefing) + the owner's first name used in spoken copy.
router.get("/settings", controller.getSettings);
router.put("/settings", controller.updateSettings);

// Owner-only, ungated TTS in the owner's chosen voice style (returns audio/mpeg).
router.post("/speak", controller.speak);

// Morning briefing text + once-per-day delivery bookkeeping.
router.get("/briefing", controller.getBriefing);
router.post("/briefing/delivered", controller.markBriefingDelivered);

// On-demand "Talk to Echo" current-status update.
router.get("/status", controller.getStatus);

// Spoken-event queue: reminders + real-time alerts the client drains while open.
router.get("/pending", controller.getPending);
router.post("/notifications/:id/delivered", controller.markNotificationDelivered);

module.exports = router;
