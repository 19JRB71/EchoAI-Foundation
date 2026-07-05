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
const {
  autoSendSurvey,
  generateFeedbackReportForBrand,
} = require("../controllers/feedbackController");
const { executeDueTouchpoints } = require("../controllers/followUpController");
const { sendDueDripEmails } = require("../controllers/emailMarketingController");
const { generateWeeklyRoiSnapshot } = require("../controllers/roiDashboardController");
const {
  generateWeeklyIntelligence,
} = require("../controllers/customerIntelligenceController");
const { runHourlyHealthSweep } = require("../controllers/healthMonitorController");
const {
  sweepDueReminders,
  enqueueClosingSummaries,
} = require("./echoVoiceReminders");

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
     WHERE c.status = 'active'
       AND b.is_demo = false`
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

          // After the weekly report goes out, ask the owner for a quick check-in.
          // Fire-and-forget; autoSendSurvey dedupes and never throws.
          autoSendSurvey({
            brandId: brand.brand_id,
            surveyType: "general",
            email: owner.email,
          });
        }
      } catch (err) {
        console.error(`Weekly report email failed for brand ${brand.brand_id}:`, err.message);
      }
    }

    // Generate a fresh AI feedback-analysis report for the brand alongside the
    // weekly run. Best-effort: a failure (e.g. no responses, AI down) is logged
    // and never stops the rest of the weekly job.
    try {
      const reportBrand = await db.query(
        "SELECT brand_id, brand_name FROM brands WHERE brand_id = $1",
        [brand.brand_id]
      );
      if (reportBrand.rows[0]) {
        await generateFeedbackReportForBrand(reportBrand.rows[0]);
      }
    } catch (err) {
      console.error(`Weekly feedback report failed for brand ${brand.brand_id}:`, err.message);
    }

    // Persist a weekly Advanced ROI snapshot (multi-channel attribution + AI
    // executive summary) so owners get a running history without asking. Best-
    // effort: a failure (e.g. AI down) is logged and never stops the weekly job.
    try {
      await generateWeeklyRoiSnapshot(brand);
    } catch (err) {
      console.error(`Weekly ROI snapshot failed for brand ${brand.brand_id}:`, err.message);
    }

    // Customer Intelligence Engine runs LAST so it synthesizes the freshest data
    // produced by every job above (analytics, optimization, creative perf,
    // feedback report, ROI snapshot) into this week's growing intelligence
    // profile. Best-effort: an AI failure is logged and never stops the run.
    try {
      await generateWeeklyIntelligence(brand);
    } catch (err) {
      console.error(`Weekly intelligence build failed for brand ${brand.brand_id}:`, err.message);
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

  // Every 5 minutes: send any due follow-up touchpoints (email/SMS/phone).
  cron.schedule("*/5 * * * *", () => {
    executeDueTouchpoints().catch((err) => {
      console.error("Scheduled follow-up touchpoint run errored:", err.message);
    });
  });

  // Top of every hour: send any due drip-sequence emails.
  cron.schedule("0 * * * *", () => {
    sendDueDripEmails().catch((err) => {
      console.error("Scheduled drip email run errored:", err.message);
    });
  });

  // Top of every hour: run the AI Health Monitor sweep over every active brand,
  // silently auto-fixing safe issues and alerting owners only on critical ones.
  cron.schedule("0 * * * *", () => {
    runHourlyHealthSweep().catch((err) => {
      console.error("Scheduled health monitor sweep errored:", err.message);
    });
  });

  // Every minute: enqueue any due Echo voice reminders (appointment 15m/5m,
  // follow-up-call-due). Idempotent dedup keys make overlapping ticks safe.
  cron.schedule("* * * * *", () => {
    sweepDueReminders().catch((err) => {
      console.error("Scheduled Echo voice reminder sweep errored:", err.message);
    });
  });

  // 18:00 daily: enqueue Echo's end-of-day closing summary for every owner.
  cron.schedule("0 18 * * *", () => {
    enqueueClosingSummaries().catch((err) => {
      console.error("Scheduled Echo closing summary run errored:", err.message);
    });
  });

  console.log(
    "Schedulers started (weekly analytics: Mondays 08:00; social posts: every minute; " +
      "follow-up touchpoints: every 5 minutes; drip emails: hourly; health monitor: hourly; " +
      "Echo voice reminders: every minute; Echo closing summary: daily 18:00)."
  );
}

module.exports = { startScheduler, runWeeklyAnalytics };
