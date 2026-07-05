const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const { requireOwner } = require("../middleware/rolePermissions");
const { uploadAudio } = require("../middleware/audioUpload");
const controller = require("../controllers/echoCompanionController");
const memory = require("../controllers/echoMemoryController");
const profile = require("../controllers/echoProfileController");
const growth = require("../controllers/growthController");
const autonomousGrowth = require("../controllers/autonomousGrowthController");

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

// Persistent memory: timeline, search, natural-language recall, manual capture
// and delete. Memory now holds the owner's personal context, preferences, values
// and per-person relationship notes, so the whole surface is OWNER-ONLY.
router.get("/memory", requireOwner, memory.timeline);
router.get("/memory/search", requireOwner, memory.search);
router.post("/memory/recall", requireOwner, memory.recall);
router.post("/memory", requireOwner, memory.capture);
router.delete("/memory/:id", requireOwner, memory.remove);

// Relationship profiles (People) and the owner profile (About You) — owner-only.
router.get("/profiles", requireOwner, profile.listProfiles);
router.put("/profiles", requireOwner, profile.saveProfile);
router.delete("/profiles/:id", requireOwner, profile.removeProfile);
router.get("/owner-profile", requireOwner, profile.getOwnerProfile);
router.put("/owner-profile", requireOwner, profile.saveOwnerProfile);

// Autonomous Growth Mode: guardrail settings + the log of proposed/auto actions
// are readable by the team; only the owner can change the guardrails or act on a
// proposal (approve/decline).
router.get("/growth", growth.getSettings);
router.put("/growth", requireOwner, growth.updateSettings);
router.get("/growth/actions", growth.listActions);
router.post("/growth/actions/:id/approve", requireOwner, autonomousGrowth.approveAction);
router.post("/growth/actions/:id/decline", requireOwner, autonomousGrowth.declineAction);

module.exports = router;
