// Prompt 024 — onboarding first-win routes.
//
// Owner-only (auth → lockout → requireOwner), same posture as guided setup:
// onboarding belongs to the account owner; team members never run it.
// GET /status is the ONE onboarding progress projection (Section F) — the
// Wizard and Echo both read it; it performs zero writes.

const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const { requireOwner } = require("../middleware/rolePermissions");
const onboardingController = require("../controllers/onboardingController");

router.use(auth, lockout, requireOwner);

router.get("/status", onboardingController.getStatus);
// Prompt 035 Section L — append-only timing events + honest four-figure summary.
router.post("/timing-events", onboardingController.recordTimingEvents);
router.get("/timing-summary", onboardingController.getTimingSummary);
router.post("/first-win/prepare", onboardingController.prepareFirstWinPost);
router.post("/first-win/arm", onboardingController.armFirstWinPost);
router.post("/first-win/disarm", onboardingController.disarmFirstWinPost);
router.post("/celebration/claim", onboardingController.claimCelebration);

module.exports = router;
