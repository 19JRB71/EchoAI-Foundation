const express = require("express");

const authMiddleware = require("../middleware/auth");
const adminMiddleware = require("../middleware/admin");
const stagingProofController = require("../controllers/stagingProofController");

const router = express.Router();

// External-proof runner endpoints are platform-owner only: a valid session
// (auth) AND an admin role (admin). Preflight is read-only; the run endpoints
// record real provider actions into external_proofs.
router.use(authMiddleware);
router.use(adminMiddleware);

router.get("/preflight", stagingProofController.preflight);
router.post("/post", stagingProofController.createProofPost);
router.post("/facebook", stagingProofController.runFacebook);
router.post("/email", stagingProofController.runEmail);
router.get("/runs/:runKey", stagingProofController.getRun);

module.exports = router;
