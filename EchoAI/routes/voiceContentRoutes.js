const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const { denyViewerMutations } = require("../middleware/rolePermissions");
const voiceContentController = require("../controllers/voiceContentController");

// Voice-driven content creation ("Hey Echo, let's create some content").
// Same gate as the Content Calendar: this is AI content generation (Pro+).
// Viewers may read a session but never draft/approve/schedule.
router.use(auth, lockout, featureGate("content_calendar"), denyViewerMutations);

router.post("/start", voiceContentController.startSession);
router.get("/:sessionId", voiceContentController.getSession);
router.post("/:sessionId/answers", voiceContentController.submitAnswers);
router.post("/:sessionId/complete", voiceContentController.completeSession);
router.post("/:sessionId/drafts/:draftId/image", voiceContentController.generateDraftImage);
router.post("/:sessionId/drafts/:draftId/revise", voiceContentController.reviseDraft);
router.post("/:sessionId/drafts/:draftId/approve", voiceContentController.approveDraft);
router.post("/:sessionId/drafts/:draftId/skip", voiceContentController.skipDraft);

module.exports = router;
