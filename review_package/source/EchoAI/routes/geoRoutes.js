const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const geoController = require("../controllers/geoTargetingController");

router.use(auth, lockout);

router.get("/:brandId", geoController.getGeoTargeting);
router.put("/:brandId", geoController.updateGeoTargeting);

module.exports = router;
