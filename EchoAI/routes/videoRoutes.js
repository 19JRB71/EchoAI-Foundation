const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const { denyViewerMutations } = require("../middleware/rolePermissions");
const videoContentController = require("../controllers/videoContentController");

// All video content routes require authentication and an active (non-locked)
// subscription. Viewers may read but not generate/modify content.
router.use(auth, lockout, featureGate("video"), denyViewerMutations);

router.post("/generate", videoContentController.generateScript);
router.post("/scripts", videoContentController.saveScript);
router.get("/scripts/:brandId", videoContentController.getScripts);
router.delete("/scripts/:scriptId", videoContentController.deleteScript);

module.exports = router;
