const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const { denyViewerMutations } = require("../middleware/rolePermissions");
const followUps = require("../controllers/followUpController");

// ---------------------------------------------------------------------------
// All follow-up routes require auth, an account in good standing, the
// Professional tier (admins bypass), and block read-only team members from
// mutating. Order is always auth -> lockout -> featureGate -> denyViewerMutations.
// ---------------------------------------------------------------------------
router.use(auth, lockout, featureGate("followups"), denyViewerMutations);

// Generate a preview sequence (AI), then save + activate.
router.post("/generate", followUps.generateSequence);
router.post("/", followUps.saveAndActivate);

// List + detail.
router.get("/", followUps.getSequences);
router.get("/:sequenceId", followUps.getSequenceDetail);

// Lifecycle controls.
router.post("/:sequenceId/pause", followUps.pauseSequence);
router.post("/:sequenceId/resume", followUps.resumeSequence);
router.post("/:sequenceId/cancel", followUps.cancelSequence);

module.exports = router;
