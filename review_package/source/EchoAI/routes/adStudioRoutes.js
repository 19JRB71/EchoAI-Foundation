const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const adCreativeStudioController = require("../controllers/adCreativeStudioController");

// All ad-studio routes require authentication and an active subscription.
router.use(auth, lockout, featureGate("ad_studio"));

router.post("/generate", adCreativeStudioController.generateCreatives);
router.post("/", adCreativeStudioController.saveCreative);
router.post("/launch", adCreativeStudioController.launchCreative);
// Declared before "/:brandId" so "performance" is not captured as a brandId.
router.get("/performance/:brandId", adCreativeStudioController.getCreativePerformance);
router.get("/:brandId", adCreativeStudioController.getCreativeLibrary);

module.exports = router;
