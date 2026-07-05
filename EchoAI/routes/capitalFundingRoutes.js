/**
 * Capital & Funding routes (Enterprise) — Scout's opportunity & capital
 * intelligence + Echo's grant writer.
 *
 * Every route requires an authenticated, non-locked account on the Enterprise
 * tier (admin bypasses via featureGate). Brand-scoped resources are guarded in
 * the controller via getOwnedBrand (brand.user_id). Order is auth → lockout →
 * featureGate, matching every other gated data route.
 */

const express = require("express");
const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const controller = require("../controllers/capitalFundingController");

const router = express.Router();

router.use(auth, lockout, featureGate("capital_funding"));

// Funding opportunities + scan
router.get("/:brandId/opportunities", controller.getOpportunities);
router.post("/:brandId/scan", controller.scanFunding);
router.post("/:brandId/opportunities/:opportunityId/dismiss", controller.dismissOpportunity);

// Weekly opportunity briefing
router.get("/:brandId/briefing", controller.getBriefing);
router.post("/:brandId/briefing/generate", controller.generateBriefing);

// Funding pipeline
router.get("/:brandId/pipeline", controller.getPipeline);

// Grant writer + applications
router.post("/:brandId/opportunities/:opportunityId/draft", controller.draftApplication);
router.get("/:brandId/applications", controller.listApplications);
router.get("/:brandId/applications/:applicationId", controller.getApplication);
router.patch("/:brandId/applications/:applicationId", controller.updateApplication);

module.exports = router;
