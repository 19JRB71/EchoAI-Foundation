const express = require("express");

const authMiddleware = require("../middleware/auth");
const adminMiddleware = require("../middleware/admin");
const adminController = require("../controllers/adminController");
const betaAdminController = require("../controllers/betaAdminController");
const featureSuggestionAdminController = require("../controllers/featureSuggestionAdminController");
const demoController = require("../controllers/demoController");
const diagnosticsController = require("../controllers/diagnosticsController");
const selfReviewAdminController = require("../controllers/selfReviewAdminController");

const router = express.Router();

// Every admin route requires a valid session (auth) AND an admin role (admin).
router.use(authMiddleware);
router.use(adminMiddleware);

router.get("/stats", adminController.getPlatformStats);
router.get("/health", adminController.getPlatformHealth);
router.get("/health/accounts", adminController.getAllAccountsHealth);

router.get("/diagnostics/report", diagnosticsController.generateReport);

router.get("/users", adminController.getAllUsers);
router.get("/users/:userId", adminController.getUserDetail);
router.put("/users/:userId/subscription", adminController.updateUserSubscription);
router.post("/users/:userId/unlock", adminController.unlockAccount);
router.post("/users/:userId/lock", adminController.lockAccount);
router.delete("/users/:userId", adminController.deleteUser);

// Beta Program Management.
router.get("/beta", betaAdminController.getBetaOverview);
router.put("/beta/settings", betaAdminController.updateBetaSettings);
router.post("/beta/users/:userId/convert", betaAdminController.convertToPaid);
router.delete("/beta/waitlist/:waitlistId", betaAdminController.removeWaitlistEntry);

// Feature Suggestions (logged automatically when Echo can't do something).
router.get("/feature-suggestions", featureSuggestionAdminController.listSuggestions);
router.get(
  "/feature-suggestions/:suggestionId/requests",
  featureSuggestionAdminController.listSuggestionRequests,
);
router.put(
  "/feature-suggestions/:suggestionId/status",
  featureSuggestionAdminController.updateSuggestionStatus,
);

// Echo Self-Review (Sage's weekly platform study — recommendation-only).
router.get("/self-review/reports", selfReviewAdminController.listReports);
router.get("/self-review/reports/:reportId", selfReviewAdminController.getReport);
router.post("/self-review/run", selfReviewAdminController.runNow);
router.put("/self-review/items/:itemId/status", selfReviewAdminController.updateItemStatus);

// Demo Account & Sales Presentation Mode.
router.get("/demo/status", demoController.getStatus);
router.get("/demo/script", demoController.getScript);
router.post("/demo/seed", demoController.seed);
router.post("/demo/reset", demoController.reset);
router.post("/demo/activate", demoController.activate);
router.post("/demo/deactivate", demoController.deactivate);
router.put("/demo/config", demoController.updateConfig);
router.post("/demo/suggestions/adapt", demoController.adaptSuggestions);

module.exports = router;
