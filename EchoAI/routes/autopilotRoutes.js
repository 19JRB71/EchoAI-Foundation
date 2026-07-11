const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const { denyViewerMutations } = require("../middleware/rolePermissions");
const autopilot = require("../controllers/autopilotController");

// Autopilot Mode: weekly batch drafting (posts + graphics + test ads) with
// approve-everything review. Same gate as the other AI content generators
// (Pro+); viewers may look but never approve/launch/spend.
router.use(auth, lockout, featureGate("content_calendar"), denyViewerMutations);

router.get("/settings", autopilot.getSettings);
router.put("/settings", autopilot.updateSettings);
router.get("/readiness", autopilot.getReadiness);
router.get("/batch", autopilot.getCurrentBatch);
router.post("/run", autopilot.runNow);
router.post("/items/:itemId/approve", autopilot.approveItem);
router.post("/items/:itemId/decline", autopilot.declineItem);
router.post("/items/:itemId/revise", autopilot.reviseItem);
router.post("/items/:itemId/image", autopilot.generateItemImage);
router.post("/batches/:batchId/complete", autopilot.completeBatch);

module.exports = router;
