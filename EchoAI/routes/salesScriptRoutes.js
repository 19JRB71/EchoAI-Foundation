const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const salesScriptController = require("../controllers/salesScriptController");

// All sales-script routes require authentication and an active (non-locked)
// subscription.
router.use(auth, lockout);

router.post("/generate", salesScriptController.generateScript);
router.post("/", salesScriptController.saveScript);
router.get("/:brandId", salesScriptController.getScripts);
router.put("/:scriptId", salesScriptController.updateScript);
router.delete("/:scriptId", salesScriptController.deleteScript);

module.exports = router;
