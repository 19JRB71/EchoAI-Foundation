/**
 * Vision — Visual Intelligence Agent routes.
 *
 * Vision, like Sage, works for every tier: its daily study runs improve
 * Forge's image output for all brands, so there is no featureGate here.
 * Every route requires an authenticated, non-locked account; brand-scoped
 * resources are guarded in the controller via getOwnedBrand.
 */

const express = require("express");
const multer = require("multer");
const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const controller = require("../controllers/visionController");

const router = express.Router();

router.use(auth, lockout);

// Knowledge base + latest run + Forge-impact stats for one brand.
router.get("/overview", controller.getOverview);

// Manual "Study now" trigger for the active brand.
router.post("/study", controller.studyNow);

// Recent study runs + Forge consultations (activity feed).
router.get("/activity", controller.getActivity);

// Reference Library — owner-uploaded real photos Vision studies each run.
// Multer caps the body so an oversized upload can't exhaust memory; the
// controller enforces type + per-brand caps.
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
function uploadPhotoFile(req, res, next) {
  photoUpload.single("file")(req, res, (err) => {
    if (err) {
      const msg =
        err.code === "LIMIT_FILE_SIZE" ? "Photo is too large (max 5 MB)." : err.message;
      return res.status(400).json({ error: msg });
    }
    next();
  });
}
router.get("/reference", controller.listReferencePhotos);
router.post("/reference", uploadPhotoFile, controller.uploadReferencePhoto);
router.delete("/reference/:imageId", controller.deleteReferencePhoto);

module.exports = router;
