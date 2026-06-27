const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const imageController = require("../controllers/imageController");

// All image studio routes require authentication and an active (non-locked)
// subscription.
router.use(auth, lockout);

router.post("/generate", imageController.generateImage);
router.post("/ad-set", imageController.generateAdCreativeSet);
router.post("/", imageController.saveImage);
router.get("/:brandId", imageController.getImages);
router.delete("/:imageId", imageController.deleteImage);

module.exports = router;
