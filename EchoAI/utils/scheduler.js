const cron = require("node-cron");
const db = require("../config/db");
const { recordWeeklyAnalyticsForBrand } = require("../controllers/analyticsController");
const { autoOptimizeCampaignsForBrand } = require("../controllers/optimizationController");

/**
 * Records weekly analytics for every active brand (a brand with at least one
 * active campaign), then auto-optimizes that brand's campaigns so the system
 * continuously improves without any manual intervention. Errors for an
 * individual brand (e.g. no connected Facebook account) are caught so one
 * failure doesn't stop the rest.
 */
async function runWeeklyAnalytics() {
  const brands = await db.query(
    `SELECT DISTINCT b.brand_id, b.user_id
     FROM brands b
     JOIN campaigns c ON c.brand_id = b.brand_id
     WHERE c.status = 'active'`
  );

  let succeeded = 0;
  let optimized = 0;
  for (const brand of brands.rows) {
    try {
      await recordWeeklyAnalyticsForBrand(brand);
      succeeded += 1;
    } catch (err) {
      console.error(`Weekly analytics failed for brand ${brand.brand_id}:`, err.message);
    }

    // Auto-optimize after recording analytics. Kept separate so an analytics
    // failure doesn't block optimization and vice versa.
    try {
      await autoOptimizeCampaignsForBrand(brand);
      optimized += 1;
    } catch (err) {
      console.error(`Auto optimization failed for brand ${brand.brand_id}:`, err.message);
    }
  }

  console.log(
    `Weekly run complete: ${succeeded}/${brands.rows.length} analytics updated, ` +
      `${optimized}/${brands.rows.length} brands optimized.`
  );
}

/**
 * Schedules the weekly analytics job for every Monday at 08:00.
 */
function startScheduler() {
  // Minute 0, hour 8, any day of month, any month, Monday (1).
  cron.schedule("0 8 * * 1", () => {
    runWeeklyAnalytics().catch((err) => {
      console.error("Scheduled weekly analytics run errored:", err.message);
    });
  });

  console.log("Weekly analytics scheduler started (Mondays at 08:00).");
}

module.exports = { startScheduler, runWeeklyAnalytics };
