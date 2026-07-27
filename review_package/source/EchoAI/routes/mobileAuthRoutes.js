/**
 * Mobile authentication routes — mounted at /api/v2/auth.
 *
 * Public:    register, login, refresh, biometric/login (token-based exchanges).
 * Protected: biometric (mint a biometric token), logout (revoke refresh tokens).
 */

const express = require("express");
const auth = require("../middleware/auth");
const mobileAuthController = require("../controllers/mobileAuthController");

const router = express.Router();

router.post("/register", mobileAuthController.register);
router.post("/login", mobileAuthController.login);
router.post("/refresh", mobileAuthController.refresh);
router.post("/biometric/login", mobileAuthController.biometricLogin);

router.post("/biometric", auth, mobileAuthController.biometricToken);
router.post("/logout", auth, mobileAuthController.logout);

module.exports = router;
