const cron = require("node-cron");
const db = require("../config/db");
const {
  recordWeeklyAnalyticsForBrand,
  generateWeeklyReport,
} = require("../controllers/analyticsController");
const {
  autoOptimizeCampaignsForBrand,
  runCompetitorAnalysisForBrand,
} = require("../controllers/optimizationController");
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
const {
  runWeeklyOpportunityScanForBrand,
} = require("../controllers/capitalFundingController");
const { runHourlyHealthSweep } = require("../controllers/healthMonitorController");
const { runDailyGoalTracking } = require("./goalAlerts");
const { warmMorningBriefings } = require("../controllers/echoVoiceController");
const {
  sweepDueReminders,
  enqueueClosingSummaries,
} = require("./echoVoiceReminders");
const {
  runDailyAutonomousGrowth,
  sendDailyAutonomousSummary,
} = require("../controllers/autonomousGrowthController");
const {
  snapshotHealth,
  ownersWithRealBrands,
  portfolioBusinessesForAI,
  weekDateFor,
} = require("./portfolio");
const {
  generateCrossBusinessIntelligence,
} = require("../prompts/crossBusinessPrompt");

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

    // Scout's Capital & Funding scan (Enterprise-gated at the source): refresh
    // funding opportunities and this week's ranked opportunity briefing. Best-
    // effort — an AI failure is logged and never stops the rest of the run.
    try {
      await runWeeklyOpportunityScanForBrand(brand);
    } catch (err) {
      console.error(`Weekly opportunity scan failed for brand ${brand.brand_id}:`, err.message);
    }
  }

  console.log(
    `Weekly run complete: ${succeeded}/${brands.rows.length} analytics updated, ` +
      `${optimized}/${brands.rows.length} brands optimized.`
  );
}

/**
 * Scout's competitor intelligence scan. Runs every 6 hours so each active brand
 * always has a fresh competitor/market briefing ready without any manual trigger
 * (the manual "Run analysis" button still works on top of this). Scoped to
 * brands with at least one active campaign — the same "active work" scope the
 * weekly run uses — and demo brands are excluded. Best-effort per brand: one
 * failure (e.g. AI down, no niche) is logged and never stops the rest of the run.
 */
async function runCompetitorScan() {
  const { rows } = await db.query(
    `SELECT * FROM brands
     WHERE is_demo = false
       AND brand_id IN (SELECT DISTINCT brand_id FROM campaigns WHERE status = 'active')`
  );
  let ok = 0;
  for (const brand of rows) {
    try {
      await runCompetitorAnalysisForBrand(brand, [], null);
      ok += 1;
    } catch (err) {
      console.error(`Competitor scan failed for brand ${brand.brand_id}:`, err.message);
    }
  }
  console.log(`Competitor scan complete: ${ok}/${rows.length} brands scanned.`);
}

/**
 * Daily portfolio health snapshot (Part 5). Computes a deterministic 1-10 score
 * for every REAL brand (demo excluded) so the 12-week trajectory keeps building
 * without any manual action. Scoring is deterministic (no AI), so a single
 * brand's failure is logged and never stops the sweep.
 */
async function runDailyHealthSnapshots() {
  const { rows } = await db.query(
    `SELECT brand_id FROM brands WHERE is_demo = false`,
  );
  let ok = 0;
  for (const b of rows) {
    try {
      await snapshotHealth(b.brand_id);
      ok += 1;
    } catch (err) {
      console.error(`Portfolio health snapshot failed for brand ${b.brand_id}:`, err.message);
    }
  }
  console.log(`Portfolio health snapshots complete: ${ok}/${rows.length} brands scored.`);
}

/**
 * Weekly cross-business intelligence (Part 3). For every owner with 2+ real
 * businesses, Echo synthesizes an AI report of the connections across them and
 * upserts it for the current ISO week. Best-effort per owner: an AI failure is
 * logged and never stops the rest of the run.
 */
async function runWeeklyCrossBusinessIntelligence() {
  const owners = await ownersWithRealBrands();
  const weekDate = weekDateFor();
  let generated = 0;
  for (const userId of owners) {
    try {
      const businesses = await portfolioBusinessesForAI(userId);
      if (businesses.length < 2) continue;
      const result = await generateCrossBusinessIntelligence(businesses);
      await db.query(
        `INSERT INTO cross_business_intelligence (user_id, week_date, report, ai_analysis)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, week_date)
         DO UPDATE SET report = EXCLUDED.report, ai_analysis = EXCLUDED.ai_analysis`,
        [userId, weekDate, JSON.stringify(result), result.summary],
      );
      generated += 1;
    } catch (err) {
      console.error(`Cross-business intelligence failed for owner ${userId}:`, err.message);
    }
  }
  console.log(`Cross-business intelligence complete: ${generated} owner report(s) generated.`);
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

  // 07:00 daily: Autonomous Growth Mode. For every owner who turned it on, Echo
  // reviews each brand's campaigns and — strictly within the owner's guardrails —
  // adjusts budgets, pauses losers and reallocates to winners, refreshes fatigued
  // ads, tunes follow-up timing, and learns from conversion data. Anything beyond
  // a guardrail is logged as a proposal instead of acted on.
  cron.schedule("0 7 * * *", () => {
    console.log("Autonomous Growth: starting the daily review of every enabled brand.");
    runDailyAutonomousGrowth().catch((err) => {
      console.error("Scheduled Autonomous Growth run errored:", err.message);
    });
  });

  // 20:00 daily: send each owner the plain-English recap of everything Echo did
  // autonomously today (deduped per owner per day).
  cron.schedule("0 20 * * *", () => {
    sendDailyAutonomousSummary().catch((err) => {
      console.error("Scheduled Autonomous Growth summary errored:", err.message);
    });
  });

  // 06:00 daily: snapshot every real business's portfolio health score so the
  // Multi-Business Chief of Staff's 12-week trajectory keeps building itself.
  cron.schedule("0 6 * * *", () => {
    runDailyHealthSnapshots().catch((err) => {
      console.error("Scheduled portfolio health snapshot run errored:", err.message);
    });
    // Faster Echo: pre-generate every owner's morning briefing at 06:00 so the
    // first login of the day plays it instantly instead of synthesizing on demand.
    warmMorningBriefings().catch((err) => {
      console.error("Scheduled morning briefing warm run errored:", err.message);
    });
  });

  // 05:45 daily: snapshot every brand's goal progress (trend + history) and
  // alert owners on at-risk / hit / exceeding goals via voice + push. Runs
  // BEFORE the 06:00 briefing warm so the pre-generated morning briefing reads
  // that morning's fresh goal snapshots (not yesterday's).
  cron.schedule("45 5 * * *", () => {
    runDailyGoalTracking().catch((err) => {
      console.error("Scheduled goal tracking run errored:", err.message);
    });
  });

  // Mondays 08:15 (after the weekly analytics run at 08:00): generate each
  // multi-business owner's weekly cross-business intelligence report.
  cron.schedule("15 8 * * 1", () => {
    runWeeklyCrossBusinessIntelligence().catch((err) => {
      console.error("Scheduled cross-business intelligence run errored:", err.message);
    });
  });

  // Every 6 hours (00:00, 06:00, 12:00, 18:00): Scout scans competitor/market
  // activity for every active brand and refreshes its intelligence briefing.
  cron.schedule("0 */6 * * *", () => {
    runCompetitorScan().catch((err) => {
      console.error("Scheduled competitor scan run errored:", err.message);
    });
  });

  console.log(
    "Schedulers started (weekly analytics: Mondays 08:00; social posts: every minute; " +
      "follow-up touchpoints: every 5 minutes; drip emails: hourly; health monitor: hourly; " +
      "Echo voice reminders: every minute; Echo closing summary: daily 18:00; " +
      "Autonomous Growth: daily 07:00, summary daily 20:00; portfolio health: daily 06:00; " +
      "goal tracking: daily 05:45; " +
      "cross-business intelligence: Mondays 08:15; competitor scan: every 6 hours)."
  );
}

module.exports = {
  startScheduler,
  runWeeklyAnalytics,
  runDailyHealthSnapshots,
  runWeeklyCrossBusinessIntelligence,
  runCompetitorScan,
  runDailyGoalTracking,
};
