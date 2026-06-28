const cron = require("node-cron");
const db = require("../config/db");
const {
  recordWeeklyAnalyticsForBrand,
  generateWeeklyReport,
} = require("../controllers/analyticsController");
const { autoOptimizeCampaignsForBrand } = require("../controllers/optimizationController");
const { updateCreativePerformanceForBrand } = require("../controllers/adCreativeStudioController");
const { sendWeeklyReportEmail } = require("../controllers/emailController");
const { publishDuePosts } = require("../controllers/socialController");
const { triggerWebhook } = require("../controllers/zapierController");
const mobilePushController = require("../controllers/mobilePushController");

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
    let analytics = null;
    try {
      analytics = await recordWeeklyAnalyticsForBrand(brand);
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

    // Refresh real Facebook performance for this brand's launched ad creatives so
    // the Ad Studio performance tab stays current. Best-effort — a failure here
    // (e.g. no connected Facebook account) must not stop the rest of the run.
    try {
      await updateCreativePerformanceForBrand(brand);
    } catch (err) {
      console.error(`Creative performance refresh failed for brand ${brand.brand_id}:`, err.message);
    }

    // Deliver the AI-generated weekly report to the brand owner's inbox. Kept
    // best-effort so an email failure doesn't disrupt the rest of the run.
    if (analytics) {
      try {
        const profileResult = await db.query(
          "SELECT brand_name, voice_description FROM brands WHERE brand_id = $1",
          [brand.brand_id]
        );
        const ownerResult = await db.query(
          "SELECT email FROM users WHERE user_id = $1",
          [brand.user_id]
        );
        const brandProfile = profileResult.rows[0];
        const owner = ownerResult.rows[0];
        if (brandProfile && owner) {
          const { subject, body } = await generateWeeklyReport(brandProfile, analytics);
          await sendWeeklyReportEmail({
            email: owner.email,
            brandName: brandProfile.brand_name,
            reportBody: body,
            subject,
          });

          // Outbound webhook (Zapier etc.) with the weekly report. Fire-and-forget.
          triggerWebhook(brand.brand_id, "weekly_report_generated", {
            brandName: brandProfile.brand_name,
            subject,
            report: body,
          });

          // Push the "report ready" alert to the owner's native mobile devices
          // via FCM. Best-effort — never blocks or fails the weekly run.
          mobilePushController
            .sendToUser(brand.user_id, {
              title: "📊 Weekly report ready",
              body: `Your latest performance report for ${brandProfile.brand_name} is ready.`,
              data: { type: "weekly_report", brandId: String(brand.brand_id) },
            })
            .catch((err) => console.error("Weekly report mobile push failed:", err.message));
        }
      } catch (err) {
        console.error(`Weekly report email failed for brand ${brand.brand_id}:`, err.message);
      }
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

  // Every minute: publish any scheduled social posts that are now due.
  cron.schedule("* * * * *", () => {
    publishDuePosts().catch((err) => {
      console.error("Scheduled social post publish run errored:", err.message);
    });
  });

  console.log(
    "Schedulers started (weekly analytics: Mondays 08:00; social posts: every minute)."
  );
}

module.exports = { startScheduler, runWeeklyAnalytics };
