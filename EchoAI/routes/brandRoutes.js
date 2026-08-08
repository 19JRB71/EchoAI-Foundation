const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const brandController = require("../controllers/brandController");
const brandDiscoveryController = require("../controllers/brandDiscoveryController");
const sageResearchController = require("../controllers/sageResearchController");

// All brand routes require authentication and an active (non-locked) subscription.
router.use(auth, lockout);

// Brand Discovery conversational agent.
router.post("/discovery", brandDiscoveryController.discovery);

// Brand management.
router.post("/", brandController.createBrand);
router.get("/", brandController.getBrands);

// Last-active brand (restored at login). Registered before /:brandId so the
// literal path can't be captured by the param route.
router.get("/active/selection", brandController.getActiveBrand);
router.put("/active/selection", brandController.setActiveBrand);

// Sage pre-interview public research (UNAPPROVED drafts; never mutates brands).
router.post("/:brandId/research", sageResearchController.startResearch);
router.get("/:brandId/research", sageResearchController.getResearch);

// Versioned brand knowledge (Prompt 011) — registered before /:brandId's
// sibling verbs stay unambiguous.
const brandKnowledgeController = require("../controllers/brandKnowledgeController");
router.get("/:brandId/knowledge", brandKnowledgeController.getKnowledge);
router.get("/:brandId/knowledge/history/:fieldKey", brandKnowledgeController.getHistory);
router.post("/:brandId/knowledge/adopt", brandKnowledgeController.adoptFromDraft);
router.post("/:brandId/knowledge/revisions/:revisionId/approve", brandKnowledgeController.approve);
router.post("/:brandId/knowledge/revisions/:revisionId/reject", brandKnowledgeController.reject);
router.put("/:brandId/knowledge/fields", brandKnowledgeController.ownerEdit);

router.get("/:brandId", brandController.getBrandProfile);
router.put("/:brandId", brandController.updateBrand);
router.delete("/:brandId", brandController.deleteBrand);

module.exports = router;
