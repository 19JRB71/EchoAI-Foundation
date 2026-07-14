/**
 * Sage — Industry Intelligence Agent routes.
 *
 * Sage is available to every tier and every workspace role (like Echo): its
 * schedulers research all active brands and its findings feed the morning
 * briefing for everyone, so there is no featureGate here. Every route still
 * requires an authenticated, non-locked account; brand-scoped resources are
 * guarded in the controller via getOwnedBrand (brand.user_id). Order is
 * auth → lockout, matching every other all-tier data route.
 */

const express = require("express");
const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const { uploadDocument } = require("../middleware/documentUpload");
const controller = require("../controllers/sageController");

const router = express.Router();

router.use(auth, lockout);

// Industry Brief
router.get("/brief", controller.getBrief);
router.post("/brief/refresh", controller.refreshBrief);

// Latest Intelligence feed
router.get("/feed", controller.getFeed);
router.post("/feed/dismiss", controller.dismissFeedItems);

// Marketing Insights
router.get("/insights", controller.getInsights);

// Competitor Watch
router.get("/competitors", controller.listCompetitors);
router.post("/competitors", controller.addCompetitor);
router.post("/competitors/suggest", controller.suggestCompetitorsHandler);
router.post("/competitors/:id/refresh", controller.refreshCompetitorHandler);
router.patch("/competitors/:id", controller.updateCompetitor);
router.delete("/competitors/:id", controller.deleteCompetitor);

// Intelligence Input (link / facebook JSON, or image / PDF multipart)
router.post("/input", uploadDocument, controller.submitIntelligence);
router.get("/submissions", controller.listSubmissions);

module.exports = router;
