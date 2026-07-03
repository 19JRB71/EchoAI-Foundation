const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const { requireOwner } = require("../middleware/rolePermissions");
const { requireSetupConsent } = require("../middleware/setupConsent");
const controller = require("../controllers/setupAgentController");

// sendBeacon pause fires during a hard tab/window close and can't set an
// Authorization header, so it is defined BEFORE the auth middleware and verifies
// the JWT from its own body instead. Kept minimal and self-guarded.
router.post("/pause-beacon", controller.pauseSessionBeacon);

// The AI Setup Agent configures a whole workspace, so it is restricted to the
// account owner (or platform admin) — invited team members are blocked
// server-side, not just hidden in the UI. Per-action tier gating happens inside
// the action runner so gated actions are skipped gracefully rather than blocking
// the whole flow.
router.use(auth, lockout, requireOwner);

// Interview + session lifecycle
router.get("/latest", controller.getLatestSession);
router.post("/session", controller.initiateSession);
router.post("/answer", controller.submitAnswer);
router.post("/consent", controller.grantConsent);
router.post("/pause", controller.pauseSession);
router.post("/dismiss", controller.dismissSession);

// Account configuration — sits behind the explicit setup-consent guard.
router.post("/execute", requireSetupConsent, controller.executeNextAction);

module.exports = router;
