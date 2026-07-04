const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const { requireOwner } = require("../middleware/rolePermissions");
const { uploadAudio } = require("../middleware/audioUpload");
const controller = require("../controllers/echoCompanionController");
const memory = require("../controllers/echoMemoryController");
const growth = require("../controllers/growthController");

// Echo manages the whole workspace on the owner's behalf, so — like the Setup
// Agent — it is restricted to the account owner (or platform admin). Invited team
// members are blocked server-side, not just hidden in the UI.
router.use(auth, lockout, requireOwner);

// Current companion state: activation status, chat log, and any pending approval.
router.get("/state", controller.getState);

// Advance the activation journey by one step (auto-called in a loop by the client
// for info steps; stops on a preview/approval or a connection hand-off).
router.post("/advance", controller.advance);

// Approve / decline the action currently awaiting review.
router.post("/approve", controller.approve);
router.post("/decline", controller.decline);

// Free-form chat with Echo (typed or transcribed voice).
router.post("/message", controller.sendMessage);

// Voice input: transcribe a recorded clip with Whisper (multipart audio). Not
// feature-gated — Echo's mic is core to the companion, mirroring the setup agent.
router.post("/transcribe", uploadAudio, controller.transcribe);

// Daily briefing: what happened, what's live, what needs approval.
router.get("/briefing", controller.briefing);

// Persistent memory: recent timeline + natural-language recall ("what happened
// with Bob?").
router.get("/memory", memory.timeline);
router.post("/memory/recall", memory.recall);

// Autonomous Growth Mode: guardrail settings + the log of proposed/auto actions.
router.get("/growth", growth.getSettings);
router.put("/growth", growth.updateSettings);
router.get("/growth/actions", growth.listActions);

module.exports = router;
