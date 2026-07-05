const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const {
  requireRole,
  requireSalesRep,
  denySalesRep,
} = require("../middleware/rolePermissions");
const crmController = require("../controllers/crmController");

// ---------------------------------------------------------------------------
// Twilio webhooks — NO auth/lockout. Twilio's servers call these directly;
// authenticity is verified inside each handler via the brand's auth token +
// X-Twilio-Signature.
// ---------------------------------------------------------------------------
router.post("/bridge/:callId", crmController.bridgeCall);
router.post("/recording/:callId", crmController.recordingCallback);
router.post("/callstatus/:callId", crmController.callStatusCallback);

// ---------------------------------------------------------------------------
// Everything below requires an authenticated user in good standing.
// ---------------------------------------------------------------------------
router.use(auth, lockout);

// --- Sales rep: personal one-lead-at-a-time queue --------------------------
router.get("/current", requireSalesRep, crmController.getCurrentLead);
router.post("/call", requireSalesRep, crmController.callCurrentLead);
router.post("/complete", requireSalesRep, crmController.completeCurrentLead);

// --- Owner/admin/manager: read the queue & Pulse overview ------------------
// Managers are read-only (they may view but not mutate); sales reps are blocked
// from these — they never see the full queue or real phone numbers.
router.get("/queue", denySalesRep, crmController.listQueue);
router.get("/queue/overview", denySalesRep, crmController.queueOverview);

// --- Owner/admin only: Sentinel call monitoring ----------------------------
// Call review exposes sensitive accountability data — full lead contact info,
// per-lead logs and Twilio recording playback. It lives in the owner/admin-only
// Sentinel department, so managers (read-only) are blocked here too, matching
// the client-side gate (callmonitor: isAdmin || !isTeamMember).
router.get("/calls/today", requireRole("admin"), crmController.callsToday);
router.get("/leads/:leadId/log", requireRole("admin"), crmController.leadLog);
router.get(
  "/recording/:callId/audio",
  requireRole("admin"),
  crmController.streamRecording,
);

// --- Admin/owner only: queue mutations -------------------------------------
router.post("/queue/assign", requireRole("admin"), crmController.assignToQueue);
router.post("/queue/priority", requireRole("admin"), crmController.setPriority);
router.post("/queue/remove", requireRole("admin"), crmController.removeFromQueue);

module.exports = router;
