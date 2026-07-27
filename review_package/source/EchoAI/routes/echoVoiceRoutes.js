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

// Morning wake-up music intro (ElevenLabs sound generation, ~3-4s). Returns
// audio/mpeg, or 204 when ElevenLabs isn't configured so the client just skips it.
router.get("/wakeup-intro", controller.wakeupIntro);

// Named personality sound effects (wake, goodbye, thinking, hotlead,
// celebration, error). Returns audio/mpeg, or 204 so the client just skips it.
router.get("/sound/:name", controller.sound);

// Instant spoken acknowledgements ("Got it, Sir.") — pre-cached per voice so
// the client can play one the moment a command lands. audio/mpeg or 204.
router.get("/ack/:name", controller.ackSound);

// Morning briefing text + once-per-day delivery bookkeeping.
router.get("/briefing", controller.getBriefing);
router.post("/briefing/delivered", controller.markBriefingDelivered);

// Weekly strategy briefing (7-day cross-business review + opportunities/risks).
router.get("/weekly-briefing", controller.getWeeklyBriefing);

// Owner's decision on a proactive channel/tool suggestion (accepted | declined),
// used to dedupe future nudges. Owner-scoped by the authenticated user id.
router.post("/suggestions/:key/decision", controller.decideSuggestion);

// On-demand "Talk to Echo" current-status update.
router.get("/status", controller.getStatus);

// Spoken-event queue: reminders + real-time alerts the client drains while open.
router.get("/pending", controller.getPending);

// Notification badge system: per-brand + general badge counts (visual, always
// shown), the per-brand panel list, and bulk-clear ("Clear all" / "Hey Echo,
// clear my notifications"). Registered BEFORE the parameterized :id route so
// "/notifications/clear" and "/notifications/list" are not swallowed by it.
router.get("/notification-summary", controller.getNotificationSummary);
router.get("/notifications/list", controller.listBrandNotifications);
router.post("/notifications/clear", controller.clearNotifications);

router.post("/notifications/:id/delivered", controller.markNotificationDelivered);

// Learned speech patterns: Echo adapts to the owner's natural phrasing over
// time (misheard phrase repeated in an understood form → remembered mapping).
router.get("/learned-phrases", controller.getLearnedPhrases);
router.post("/learned-phrases", controller.saveLearnedPhrase);

module.exports = router;
