const express = require("express");

const authMiddleware = require("../middleware/auth");
const adminMiddleware = require("../middleware/admin");
const { ENVIRONMENT } = require("../config/environment");
const stagingProofController = require("../controllers/stagingProofController");

const router = express.Router();

// STRUCTURAL ENVIRONMENT GUARD (owner deployment condition 1): these routes
// exist ONLY in a server whose detected environment is exactly 'staging'
// (config/environment.js — staging sets APP_ENV=staging; production detects
// as 'production' via Railway markers, the Replit workspace as 'development').
// Everywhere else every request 403s before auth even runs, so the proof
// runner is structurally unable to execute outside staging.
router.use((req, res, next) => {
  if (ENVIRONMENT !== "staging") {
    return res.status(403).json({
      error: `External-proof runner is staging-only (this server is '${ENVIRONMENT}')`,
    });
  }
  return next();
});

// Platform-owner only: a valid session (auth) AND an admin role (admin).
// Preflight is read-only; the run endpoints record real provider actions
// into external_proofs.
router.use(authMiddleware);
router.use(adminMiddleware);

router.get("/preflight", stagingProofController.preflight);
router.post("/post", stagingProofController.createProofPost);
router.post("/facebook", stagingProofController.runFacebook);
router.post("/email", stagingProofController.runEmail);
router.get("/runs/:runKey", stagingProofController.getRun);

module.exports = router;
