const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const feedbackController = require("../controllers/feedbackController");

// --- Public (no auth): customers view + submit their survey response. ---
router.get("/r/:responseId", feedbackController.renderSurveyPage);
router.post("/r/:responseId", feedbackController.recordResponse);

// --- Everything below requires auth + an active subscription. ---
router.use(auth, lockout);

router.post("/survey", feedbackController.createSurvey);
router.put("/survey/:surveyId", feedbackController.updateSurvey);
router.post("/send", feedbackController.sendSurvey);
router.post("/analyze", feedbackController.analyzeFeedback);
router.get("/dashboard/:brandId", feedbackController.getFeedbackDashboard);
router.get("/responses/:brandId", feedbackController.getResponses);
router.get("/surveys/:brandId", feedbackController.getSurveys);

module.exports = router;
