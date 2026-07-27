const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const controller = require("../controllers/autonomousConversationController");

// Two-Way Autonomous Conversation dashboard: an authenticated, non-locked owner
// surface. Not feature-gated — autonomous lead conversations run across every
// tier (the underlying channels enforce their own gates). The controller scopes
// every read/write to the caller's own brands (admin bypasses).
router.use(auth, lockout);

// List the owner's autonomous conversations (optional ?brandId= & ?status=).
router.get("/", controller.listConversations);

// One conversation with its full transcript.
router.get("/:id", controller.getConversation);

// Owner takes over a live conversation — stops Echo's autonomy (seamless handoff).
router.post("/:id/transfer", controller.transfer);

// Hand a transferred conversation back to Echo.
router.post("/:id/resume", controller.resume);

module.exports = router;
