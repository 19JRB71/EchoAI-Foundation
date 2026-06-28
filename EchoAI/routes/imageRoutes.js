const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const featureGate = require("../middleware/featureGate");
const { denyViewerMutations } = require("../middleware/rolePermissions");
const imageController = require("../controllers/imageController");

// All Image Studio routes require auth, an active (non-locked) subscription, and
// the Professional tier (admins bypass). Viewers may read but not mutate.
router.use(auth, lockout, featureGate("image_studio"), denyViewerMutations);

// AI Image Prompt Engineer + DALL-E generation.
router.post("/prompts", imageController.generateImagePrompts);
router.post("/from-prompt", imageController.generateImageFromPrompt);
router.post("/variations", imageController.generateImageVariations);

router.post("/generate", imageController.generateImage);
router.post("/ad-set", imageController.generateAdCreativeSet);
router.post("/", imageController.saveImage);

// Specific GET routes must precede the catch-all `/:brandId`.
router.get("/style-guide/:brandId", imageController.getBrandStyleGuide);
router.get("/:brandId", imageController.getImages);

router.delete("/:imageId", imageController.deleteImage);

module.exports = router;
