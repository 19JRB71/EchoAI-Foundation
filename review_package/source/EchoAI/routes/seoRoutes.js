const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const seoController = require("../controllers/seoController");

// All SEO routes require auth + an account in good standing (lockout-gated),
// consistent with the other AI content-generation features.
router.use(auth, lockout);

router.post("/generate", seoController.generateContent);
router.post("/keywords", seoController.getKeywordSuggestions);
router.post("/", seoController.saveContent);
router.get("/:brandId", seoController.getContent);
router.delete("/:contentId", seoController.deleteContent);

module.exports = router;
