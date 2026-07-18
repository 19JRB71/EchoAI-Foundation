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
const { requireOwner } = require("../middleware/rolePermissions");
const { uploadDocument } = require("../middleware/documentUpload");
const controller = require("../controllers/sageController");
const briefingController = require("../controllers/sageBriefingController");
const phase4 = require("../controllers/sagePhase4Controller");

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

// Pattern Intelligence Engine (industry-wide public-campaign patterns)
router.get("/patterns", controller.getPatterns);
router.post("/patterns/refresh", controller.refreshPatterns);

// Sage V2 P1 (flag-gated, default off): consolidated weekly briefing +
// flying-blind context stats. Endpoints answer {enabled:false} when dark.
router.get("/briefing/weekly", briefingController.getWeeklyBriefing);
router.get("/context-stats", briefingController.getContextStats);

// Sage V2 P4 (flag-gated, default off): Offers registry, Business
// Constraints, Executive Memory. Endpoints answer {enabled:false} when dark.
// Owner-only: offers carry margin notes; constraints carry legal/cash-flow
// notes — team members never see or edit them.
router.get("/offers", requireOwner, phase4.listOffers);
router.post("/offers", requireOwner, phase4.createOffer);
router.patch("/offers/:id", requireOwner, phase4.updateOffer);
router.get("/constraints", requireOwner, phase4.getConstraints);
router.put("/constraints", requireOwner, phase4.saveConstraints);
router.get("/memory", requireOwner, phase4.listMemories);
router.post("/memory", requireOwner, phase4.createMemory);
router.patch("/memory/:id/archive", requireOwner, phase4.archiveMemory);

// Intelligence Input (link / facebook JSON, or image / PDF multipart)
router.post("/input", uploadDocument, controller.submitIntelligence);
router.get("/submissions", controller.listSubmissions);

module.exports = router;
