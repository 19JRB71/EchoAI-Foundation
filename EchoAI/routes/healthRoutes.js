const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const admin = require("../middleware/admin");
const healthMonitorController = require("../controllers/healthMonitorController");

// --- Authenticated health monitor + support. ---
// NOTE: health monitoring is available to every tier (it protects the account
// itself), so there is no featureGate here. Support routes bypass no lockout
// intentionally — a locked/past-due user must still be able to ask for help.
router.use(auth);

// Support tickets stay reachable even when locked out so a past-due user can
// still get help (mirrors the billing-management lockout bypass convention).
// A larger JSON limit is applied here (screenshots are base64 data URLs that
// exceed the global 100 KB limit); the global parser skips this exact path.
router.post(
  "/support",
  express.json({ limit: "12mb" }),
  healthMonitorController.submitSupportTicket,
);
router.get("/support", healthMonitorController.listSupportTickets);

// API credit / quota monitoring is PLATFORM-level (the platform's own API keys),
// so it is admin-only — a regular customer must never see the platform's credit
// levels. Registered before the /:brandId/* routes so the literal path wins.
router.get("/api-credits", admin, healthMonitorController.getApiCredits);
router.post("/api-credits/refresh", admin, healthMonitorController.refreshApiCredits);

// Health-check reads/runs require an active (non-locked) account.
router.get("/:brandId/status", lockout, healthMonitorController.getStatus);
router.get("/:brandId/history", lockout, healthMonitorController.getHistory);
router.post("/:brandId/check", lockout, healthMonitorController.runCheck);

module.exports = router;
