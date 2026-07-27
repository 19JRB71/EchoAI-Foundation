// Guided Setup wizard routes.
//
// Owner-only (auth → lockout → requireOwner): the wizard is the new-account
// front door, and team members never run owner onboarding.

const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const { requireOwner } = require("../middleware/rolePermissions");
const guidedSetupController = require("../controllers/guidedSetupController");

// The "Help Me" screenshot is a base64 data URL that easily exceeds the global
// 100 KB JSON limit. Parse it here with a scoped larger limit — server.js
// skips the global parser for this exact path (LARGE_BODY_SUPPORT_PATHS).
router.post(
  "/help",
  express.json({ limit: "12mb" }),
  auth,
  lockout,
  requireOwner,
  guidedSetupController.helpAnalyze,
);

router.use(auth, lockout, requireOwner);

router.get("/state", guidedSetupController.getState);
router.get("/checklist", guidedSetupController.getChecklist);
router.put("/progress", guidedSetupController.saveProgress);
router.post("/connection-error", guidedSetupController.reportConnectionError);

module.exports = router;
