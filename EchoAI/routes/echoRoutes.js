const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const { requireOwner } = require("../middleware/rolePermissions");
const { uploadAudio } = require("../middleware/audioUpload");
const controller = require("../controllers/echoCompanionController");
const memory = require("../controllers/echoMemoryController");
const growth = require("../controllers/growthController");

// All Echo routes require an authenticated, non-locked account. Echo is now a
// department in the team-based navigation, so its READ views (briefing, memory,
// autonomous-growth log) are visible to invited team members too. The owner-only
// controls — the activation companion (state/advance/approve/decline/message/
// transcribe) and mutating the growth guardrails — stay behind `requireOwner`.
router.use(auth, lockout);

// Current companion state: activation status, chat log, and any pending approval.
router.get("/state", requireOwner, controller.getState);

// Advance the activation journey by one step (auto-called in a loop by the client
// for info steps; stops on a preview/approval or a connection hand-off).
router.post("/advance", requireOwner, controller.advance);

// Approve / decline the action currently awaiting review.
router.post("/approve", requireOwner, controller.approve);
router.post("/decline", requireOwner, controller.decline);

// Free-form chat with Echo (typed or transcribed voice).
router.post("/message", requireOwner, controller.sendMessage);

// Voice input: transcribe a recorded clip with Whisper (multipart audio). Not
// feature-gated — Echo's mic is core to the companion, mirroring the setup agent.
router.post("/transcribe", requireOwner, uploadAudio, controller.transcribe);

// Daily briefing: what happened, what's live, what needs approval.
router.get("/briefing", controller.briefing);

// Persistent memory: recent timeline + natural-language recall ("what happened
// with Bob?").
router.get("/memory", memory.timeline);
router.post("/memory/recall", memory.recall);

// Autonomous Growth Mode: guardrail settings + the log of proposed/auto actions
// are readable by the team; only the owner can change the guardrails.
router.get("/growth", growth.getSettings);
router.put("/growth", requireOwner, growth.updateSettings);
router.get("/growth/actions", growth.listActions);

module.exports = router;
