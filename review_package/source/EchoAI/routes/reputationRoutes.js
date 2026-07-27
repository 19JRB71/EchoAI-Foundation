const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const reputationController = require("../controllers/reputationController");

// All reputation routes require auth + an account in good standing.
router.use(auth, lockout, featureGate("reputation"));

// Brand-scoped
router.get("/:brandId", reputationController.getReviews);
router.post("/:brandId/fetch", reputationController.fetchReviews);
router.post("/:brandId/reviews", reputationController.addReview);

// Review-scoped
router.post("/reviews/:reviewId/generate", reputationController.generateResponse);
router.post("/reviews/:reviewId/respond", reputationController.postResponse);
router.post("/reviews/:reviewId/ignore", reputationController.ignoreReview);

module.exports = router;
