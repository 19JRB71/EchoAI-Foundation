const express = require("express");

const router = express.Router();

const auth = require("../middleware/auth");
const lockout = require("../middleware/lockout");
const propertyController = require("../controllers/propertyController");

// Property CRM — available on every tier for real-estate brands.
// Auth + lockout only; ownership is enforced per-brand in the controller.
router.use(auth, lockout);

// Listings
router.get("/:brandId/listings", propertyController.listListings);
router.post("/:brandId/listings", propertyController.createListing);
router.put("/:brandId/listings/:listingId", propertyController.updateListing);
router.delete("/:brandId/listings/:listingId", propertyController.deleteListing);

// Buyer & seller leads
router.get("/:brandId/leads", propertyController.listLeads);
router.post("/:brandId/leads", propertyController.createLead);
router.put("/:brandId/leads/:leadId", propertyController.updateLead);
router.delete("/:brandId/leads/:leadId", propertyController.deleteLead);

// Open houses (+ attendees)
router.get("/:brandId/open-houses", propertyController.listOpenHouses);
router.post("/:brandId/open-houses", propertyController.createOpenHouse);
router.put("/:brandId/open-houses/:openHouseId", propertyController.updateOpenHouse);
router.delete("/:brandId/open-houses/:openHouseId", propertyController.deleteOpenHouse);
router.get("/:brandId/open-houses/:openHouseId/attendees", propertyController.listAttendees);
router.post("/:brandId/open-houses/:openHouseId/attendees", propertyController.createAttendee);
router.delete(
  "/:brandId/open-houses/:openHouseId/attendees/:attendeeId",
  propertyController.deleteAttendee
);

module.exports = router;
