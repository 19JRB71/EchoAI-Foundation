const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const videoContentController = require("../controllers/videoContentController");

// All video content routes require authentication and an active (non-locked)
// subscription.
router.use(auth, lockout, featureGate("video"));

router.post("/generate", videoContentController.generateScript);
router.post("/scripts", videoContentController.saveScript);
router.get("/scripts/:brandId", videoContentController.getScripts);
router.delete("/scripts/:scriptId", videoContentController.deleteScript);

module.exports = router;
