/**
 * Vision — Visual Intelligence Agent routes.
 *
 * Vision, like Sage, works for every tier: its daily study runs improve
 * Forge's image output for all brands, so there is no featureGate here.
 * Every route requires an authenticated, non-locked account; brand-scoped
 * resources are guarded in the controller via getOwnedBrand.
 */

const express = require("express");
const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const controller = require("../controllers/visionController");

const router = express.Router();

router.use(auth, lockout);

// Knowledge base + latest run + Forge-impact stats for one brand.
router.get("/overview", controller.getOverview);

// Manual "Study now" trigger for the active brand.
router.post("/study", controller.studyNow);

// Recent study runs + Forge consultations (activity feed).
router.get("/activity", controller.getActivity);

module.exports = router;
