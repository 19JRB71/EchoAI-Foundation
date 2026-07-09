const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const brandController = require("../controllers/brandController");
const brandDiscoveryController = require("../controllers/brandDiscoveryController");

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

router.get("/:brandId", brandController.getBrandProfile);
router.put("/:brandId", brandController.updateBrand);
router.delete("/:brandId", brandController.deleteBrand);

module.exports = router;
