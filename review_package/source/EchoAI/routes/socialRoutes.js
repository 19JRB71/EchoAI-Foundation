const express = require("express");
const multer = require("multer");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const { denyViewerMutations } = require("../middleware/rolePermissions");
const socialController = require("../controllers/socialController");

// All social routes require authentication and an active (non-locked)
// subscription. Viewers may read but not post/modify.
router.use(auth, lockout, denyViewerMutations);

router.post("/connect", socialController.connectSocialAccount);
router.post("/facebook-page", socialController.setFacebookBrandPage);
router.post("/generate", socialController.generateSocialContent);

// Owner-uploaded post media (photos ≤10MB, videos ≤200MB — the controller
// enforces the per-type caps; multer caps the overall body so an oversized
// upload can't exhaust memory).
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024, files: 1 },
});
function uploadMediaFile(req, res, next) {
  mediaUpload.single("file")(req, res, (err) => {
    if (err) {
      const msg =
        err.code === "LIMIT_FILE_SIZE"
          ? "File is too large (max 200 MB)."
          : err.message;
      return res.status(400).json({ error: msg });
    }
    next();
  });
}
router.post("/media", uploadMediaFile, socialController.uploadPostMedia);
router.post("/schedule", socialController.schedulePost);
router.put("/posts/:postId/reschedule", socialController.reschedulePost);
router.post("/posts/:postId/publish-now", socialController.publishPostNow);
router.get("/calendar/:brandId", socialController.getSocialCalendar);
router.get("/accounts/:brandId", socialController.getSocialAccounts);
router.delete("/accounts/:brandId/:platform", socialController.disconnectSocialAccount);
router.get("/performance/:brandId", socialController.getPostPerformance);

module.exports = router;
