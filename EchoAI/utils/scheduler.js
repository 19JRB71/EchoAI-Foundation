const cron = require("node-cron");
const db = require("../config/db");
const { ENVIRONMENT, ENVIRONMENT_BASIS } = require("../config/environment");
const { getSwitch, backgroundAiAllowedHere } = require("../config/aiControls");
const { runWithWorkflow } = require("./aiContext");
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
const {
  publishDuePosts,
  reverifySocialConnections,
} = require("../controllers/socialController");
const { triggerWebhook } = require("../controllers/zapierController");
const mobilePushController = require("../controllers/mobilePushController");
const {
  autoSendSurvey,
  generateFeedbackReportForBrand,
} = require("../controllers/feedbackController");
const { executeDueTouchpoints } = require("../controllers/followUpController");
const {
  sendDueDripEmails,
  sendDueScheduledCampaigns,
} = require("../controllers/emailMarketingController");
const { generateWeeklyRoiSnapshot } = require("../controllers/roiDashboardController");
const {
  generateWeeklyIntelligence,
} = require("../controllers/customerIntelligenceController");
const {
  runWeeklyOpportunityScanForBrand,
} = require("../controllers/capitalFundingController");
const {
  runCompetitorAdScanForBrand,
  runWeeklyCompetitorAdReportForBrand,
} = require("../controllers/competitorAdSpyController");
const {
  runSiteMonitorForBrand,
  runWeeklyDigestForBrand,
} = require("../controllers/competitorSiteController");
const { runHourlyHealthSweep } = require("../controllers/healthMonitorController");
const { runApiQuotaSweep } = require("./apiQuotaMonitor");
const { runDailyGoalTracking } = require("./goalAlerts");
const { runBetaProgramSweep } = require("./betaProgram");
const { runWeeklyAutopilot } = require("../controllers/autopilotController");
const { buildWeeklyBriefingForBrand } = require("../controllers/sageBriefingController");
const {
  runListingPromotionSweep,
  runSellerLeadAdSweep,
  runOpenHouseSweep,
  runRealEstateContentRun,
} = require("./realEstateAutomation");
const {
  activeBrandsForSage,
  runDeepCycleForBrand,
  runUrgentScanForBrand,
  claimRun,
  finishRun,
} = require("../controllers/sageController");
const { runPatternCycleForBrand } = require("./patternIntelligence");
const { warmMorningBriefings } = require("../controllers/echoVoiceController");
const {
  sweepDueReminders,
  enqueueClosingSummaries,
} = require("./echoVoiceReminders");
const {
  sweepPersonalReminders,
  runDailyTaskSweep,
} = require("./echoPersonal");
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
const jobQueue = require("./jobQueue");
const { gateJob } = require("./skipGates");

/**
 * Sage V2 job-queue path (behind SAGE_V2_JOB_QUEUE, default OFF). When ON, a
 * Sage sweep ENQUEUES one row per brand (unique per job_type+brand+run_key,
 * so overlapping ticks are no-ops) and immediately DRAINS them serially via
 * FOR UPDATE SKIP LOCKED claims — behavior identical at current scale, but
 * the claim table gives horizontal headroom and stuck-claim visibility.
 * Returns true when the queue handled the sweep (caller skips its legacy loop).
 */
async function runSageSweepViaQueue(jobType, brands, runKey, worker) {
  if (!(await jobQueue.enabled().catch(() => false))) return false;
  const rescued = await jobQueue.rescueStaleClaims().catch(() => []);
  if (rescued.length) {
    console.error(`Job queue: rescued ${rescued.length} stale ${jobType} claim(s) → marked failed.`);
  }
  for (const brand of brands) {
    await jobQueue.enqueue(jobType, brand.brand_id, runKey).catch((err) => {
      console.error(`Job queue enqueue failed (${jobType}, ${brand.brand_id}):`, err.message);
    });
  }
  const byId = new Map(brands.map((b) => [b.brand_id, b]));
  const processed = await jobQueue.drain(jobType, async (job) => {
    let brand = byId.get(job.brand_id);
    if (!brand) {
      const r = await db.query("SELECT * FROM brands WHERE brand_id = $1", [job.brand_id]);
      brand = r.rows[0];
    }
    if (!brand) throw new Error("Brand no longer exists");
    return worker(brand);
  });
  console.log(`${jobType} (queue mode): ${processed} job(s) processed for run ${runKey}.`);
  return true;
}

/**
 * The most recent stored weekly analytics row for a brand. Used when the
 * skip gate says the inputs are unchanged: the expensive re-aggregation is
 * skipped, but the owner-facing weekly report must still go out, built from
 * this stored (still-accurate) snapshot. Returns null only when the brand
 * has never had an analytics row — the same case the legacy path had nothing
 * to report on.
 */
async function latestStoredAnalytics(brandId) {
  const latest = await db.query(
    `SELECT * FROM analytics
     WHERE brand_id = $1
     ORDER BY week_date DESC
     LIMIT 1`,
    [brandId]
  );
  return latest.rows[0] || null;
}

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
      const gate = await gateJob("weekly-analytics", brand.brand_id);
      if (gate.run) {
        analytics = await recordWeeklyAnalyticsForBrand(brand);
        await gate.done();
        succeeded += 1;
      } else {
        await gate.skip();
        // Skip gate suppresses only the COST (re-fetching Facebook insights +
        // re-aggregating), never the owner-facing weekly report. Reuse the most
        // recent stored analytics row so the report/email/push still go out.
        analytics = await latestStoredAnalytics(brand.brand_id);
      }
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

    // Scout's Competitor Ad Spy weekly report (Enterprise-gated at the source):
    // refresh each confirmed competitor's live ads and write this week's ad
    // intelligence report. Best-effort — logged, never stops the rest of the run.
    try {
      await runWeeklyCompetitorAdReportForBrand(brand);
    } catch (err) {
      console.error(`Weekly competitor ad report failed for brand ${brand.brand_id}:`, err.message);
    }

    // Sage V2 P1 (SAGE_V2_WEEKLY_BRIEFING flag, default off): consolidate this
    // week's reports into ONE briefing. Runs LAST so it aggregates everything
    // above. No-op while the flag is off. Best-effort — never stops the run.
    try {
      await buildWeeklyBriefingForBrand(brand);
    } catch (err) {
      console.error(`Weekly Sage briefing failed for brand ${brand.brand_id}:`, err.message);
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
      const gate = await gateJob("competitor-scan", brand.brand_id);
      if (!gate.run) {
        await gate.skip();
        continue;
      }
      await runCompetitorAnalysisForBrand(brand, [], null);
      await gate.done();
      ok += 1;
    } catch (err) {
      console.error(`Competitor scan failed for brand ${brand.brand_id}:`, err.message);
    }
  }
  console.log(`Competitor scan complete: ${ok}/${rows.length} brands scanned.`);
}

/**
 * Scout's Competitor Ad Spy scan. Runs every 6 hours: for each active (non-demo)
 * brand it pulls each CONFIRMED competitor's live Facebook ads, records brand-new
 * ones, classifies them, and alerts the owner on aggressive new ads. Enterprise-
 * gated at the source (background path). Best-effort per brand: one failure is
 * logged and never stops the rest of the sweep. No-ops entirely with no Facebook
 * token (honesty rule — nothing fabricated).
 */
async function runCompetitorAdScan() {
  const { rows } = await db.query(
    `SELECT * FROM brands
     WHERE is_demo = false
       AND brand_id IN (SELECT DISTINCT brand_id FROM campaigns WHERE status = 'active')`
  );
  let ok = 0;
  for (const brand of rows) {
    try {
      const gate = await gateJob("competitor-ad-scan", brand.brand_id);
      if (!gate.run) {
        await gate.skip();
        continue;
      }
      await runCompetitorAdScanForBrand(brand);
      await gate.done();
      ok += 1;
    } catch (err) {
      console.error(`Competitor ad scan failed for brand ${brand.brand_id}:`, err.message);
    }
  }
  console.log(`Competitor ad scan complete: ${ok}/${rows.length} brands scanned.`);
}

/**
 * Scout's Competitor Website Analysis sweep. Runs daily for every real (non-demo)
 * brand that tracks at least one competitor website: re-reads each due URL,
 * records only MEANINGFUL changes and pages the owner. The controller enforces
 * the Enterprise tier per brand (admin bypasses) and claims each site atomically
 * so overlapping ticks can't double-run. Per-brand failures are logged, never
 * stopping the sweep.
 */
async function runCompetitorSiteMonitor() {
  const { rows } = await db.query(
    `SELECT DISTINCT b.*
       FROM brands b
       JOIN competitor_websites w ON w.brand_id = b.brand_id
      WHERE b.is_demo = false`
  );
  let ok = 0;
  for (const brand of rows) {
    try {
      await runSiteMonitorForBrand(brand);
      ok += 1;
    } catch (err) {
      console.error(`Competitor site monitor failed for brand ${brand.brand_id}:`, err.message);
    }
  }
  console.log(`Competitor site monitor complete: ${ok}/${rows.length} brands checked.`);
}

/**
 * Scout's weekly competitor-website change digest. Runs once a week for every
 * real (non-demo) brand that tracks at least one competitor website: rolls up the
 * meaningful changes recorded over the last week across all its sites into ONE
 * summary and pages the owner once (voice + push). The controller enforces the
 * Enterprise tier per brand (admin bypasses), skips weeks with no changes
 * (honest — never buzzes to say nothing happened), and guards the summary
 * at-most-once per ISO week. Per-brand failures are logged, never stopping the
 * sweep. The digest shown in the section is recomputed live on load.
 */
async function runCompetitorSiteDigest() {
  const { rows } = await db.query(
    `SELECT DISTINCT b.*
       FROM brands b
       JOIN competitor_websites w ON w.brand_id = b.brand_id
      WHERE b.is_demo = false`
  );
  let ok = 0;
  for (const brand of rows) {
    try {
      const gate = await gateJob("competitor-site-digest", brand.brand_id);
      if (!gate.run) {
        await gate.skip();
        continue;
      }
      await runWeeklyDigestForBrand(brand);
      await gate.done();
      ok += 1;
    } catch (err) {
      console.error(`Competitor site digest failed for brand ${brand.brand_id}:`, err.message);
    }
  }
  console.log(`Competitor site digest complete: ${ok}/${rows.length} brands summarized.`);
}

/**
 * Sage's deep industry-research cycle. Runs every 6 hours for every real
 * (non-demo) brand: refreshes the rolling industry brief, persists the findings
 * feed, and pages the owner on urgent signals. Each brand is claimed atomically
 * for the hour bucket so overlapping ticks can't double-run, and a per-brand
 * failure (AI down, no industry) is logged and never stops the sweep.
 */
async function sageDeepWorker(brand) {
  const gate = await gateJob("sage-deep-research", brand.brand_id);
  if (!gate.run) {
    await gate.skip();
    return { skipped: true, inputHash: gate.hash };
  }
  await runDeepCycleForBrand(brand);
  await gate.done();
  return { inputHash: gate.hash };
}

async function runSageDeepCycle() {
  const brands = await activeBrandsForSage();
  const runKey = `deep:${new Date().toISOString().slice(0, 13)}`;
  if (await runSageSweepViaQueue("sage-deep-research", brands, runKey, sageDeepWorker)) return;
  let ok = 0;
  for (const brand of brands) {
    let claimed = false;
    try {
      claimed = await claimRun(brand.brand_id, "deep", runKey);
      if (!claimed) continue;
      await sageDeepWorker(brand);
      await finishRun(brand.brand_id, "deep", runKey, "done");
      ok += 1;
    } catch (err) {
      if (claimed) await finishRun(brand.brand_id, "deep", runKey, "failed");
      console.error(`Sage deep cycle failed for brand ${brand.brand_id}:`, err.message);
    }
  }
  console.log(`Sage deep research complete: ${ok}/${brands.length} brands researched.`);
}

/**
 * Sage's fast urgent scan. Runs every 30 minutes for every real brand to catch
 * breaking, time-sensitive developments and page the owner (deduped per signal
 * per day). Claimed atomically per 30-minute bucket; per-brand failures are
 * logged and never stop the sweep. An empty result is normal, not an error.
 */
async function sageUrgentWorker(brand) {
  const gate = await gateJob("sage-urgent-scan", brand.brand_id);
  if (!gate.run) {
    await gate.skip();
    return { skipped: true, inputHash: gate.hash };
  }
  await runUrgentScanForBrand(brand);
  await gate.done();
  return { inputHash: gate.hash };
}

async function runSageUrgentScan() {
  const brands = await activeBrandsForSage();
  const now = new Date();
  const half = now.getUTCMinutes() < 30 ? "00" : "30";
  const runKey = `urgent:${now.toISOString().slice(0, 13)}:${half}`;
  if (await runSageSweepViaQueue("sage-urgent-scan", brands, runKey, sageUrgentWorker)) return;
  let ok = 0;
  for (const brand of brands) {
    let claimed = false;
    try {
      claimed = await claimRun(brand.brand_id, "urgent", runKey);
      if (!claimed) continue;
      await sageUrgentWorker(brand);
      await finishRun(brand.brand_id, "urgent", runKey, "done");
      ok += 1;
    } catch (err) {
      if (claimed) await finishRun(brand.brand_id, "urgent", runKey, "failed");
      console.error(`Sage urgent scan failed for brand ${brand.brand_id}:`, err.message);
    }
  }
  console.log(`Sage urgent scan complete: ${ok}/${brands.length} brands scanned.`);
}

/** ISO-week key (e.g. "2026-W29") — one pattern study per brand per week. */
function isoWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Sage's weekly Pattern Intelligence study. For every real brand: gathers
 * publicly available industry campaigns (Meta Ad Library — nothing gathered
 * without a token, never fabricated), analyzes the craft, aggregates real
 * prevalence patterns, and refreshes the industry report + Forge Creative
 * Brief. Claimed atomically per ISO week; per-brand failures are logged and
 * never stop the sweep.
 */
async function sagePatternWorker(brand) {
  const gate = await gateJob("sage-pattern-study", brand.brand_id);
  if (!gate.run) {
    await gate.skip();
    return { skipped: true, inputHash: gate.hash };
  }
  await runPatternCycleForBrand(brand);
  await gate.done();
  return { inputHash: gate.hash };
}

async function runSagePatternStudy() {
  const brands = await activeBrandsForSage();
  const runKey = `weekly:${isoWeekKey()}`;
  if (await runSageSweepViaQueue("sage-pattern-study", brands, runKey, sagePatternWorker)) return;
  let ok = 0;
  for (const brand of brands) {
    let claimed = false;
    try {
      claimed = await claimRun(brand.brand_id, "patterns", runKey);
      if (!claimed) continue;
      await sagePatternWorker(brand);
      await finishRun(brand.brand_id, "patterns", runKey, "done");
      ok += 1;
    } catch (err) {
      if (claimed) await finishRun(brand.brand_id, "patterns", runKey, "failed");
      console.error(`Sage pattern study failed for brand ${brand.brand_id}:`, err.message);
    }
  }
  console.log(`Sage pattern study complete: ${ok}/${brands.length} brands studied.`);
}

/**
 * Sage V2 Phase 5 — Monday opportunity synthesis. Flag-gated (default off);
 * when SAGE_V2_OPPORTUNITIES is dark this is a no-op. Runs BEFORE the 06:00
 * briefing warm so the morning briefing can surface this week's new
 * opportunities. Per-brand: diagnostics first (deterministic decomposition),
 * then ONE AI synthesis call; AI failure marks the brand's run failed —
 * nothing fabricated — and never stops the sweep.
 */
async function runSageOpportunitySynthesis() {
  if (!(await getSwitch("SAGE_V2_OPPORTUNITIES"))) return;
  const { runSynthesisForBrand } = require("./opportunitySynthesis");
  const brands = await activeBrandsForSage();
  const runKey = `opps:${isoWeekKey()}`;
  let ok = 0;
  for (const brand of brands) {
    let claimed = false;
    try {
      claimed = await claimRun(brand.brand_id, "opps", runKey);
      if (!claimed) continue;
      await runSynthesisForBrand(brand);
      await finishRun(brand.brand_id, "opps", runKey, "done");
      ok += 1;
    } catch (err) {
      if (claimed) await finishRun(brand.brand_id, "opps", runKey, "failed");
      console.error(`Sage opportunity synthesis failed for brand ${brand.brand_id}:`, err.message);
    }
  }
  console.log(`Sage opportunity synthesis complete: ${ok}/${brands.length} brands.`);
}

/**
 * Sage V2 Phase 5 — nightly deterministic maintenance: join measured analytics
 * onto completed directives (no AI) and expire stale open opportunities.
 * Each half is guarded so one failure never blocks the other.
 */
async function runSageOpportunityMaintenance() {
  if (await getSwitch("SAGE_V2_DIRECTIVES")) {
    try {
      const { runMeasurementJoin } = require("./directiveBus");
      await runMeasurementJoin();
    } catch (err) {
      console.error("Sage directive measurement join failed:", err.message);
    }
  }
  if (await getSwitch("SAGE_V2_OPPORTUNITIES")) {
    try {
      const { runExpirySweep } = require("./opportunitySynthesis");
      await runExpirySweep();
    } catch (err) {
      console.error("Sage opportunity expiry sweep failed:", err.message);
    }
  }
  // Sage V2 P6: refresh self-eval caches (deterministic SQL only, zero AI).
  // refreshSelfEvalCaches no-ops when SAGE_V2_SELF_EVAL is dark.
  try {
    const { refreshSelfEvalCaches } = require("./sageSelfEval");
    await refreshSelfEvalCaches();
  } catch (err) {
    console.error("Sage self-eval cache refresh failed:", err.message);
  }
  // Collab Stage 0: bus maintenance (expire overdue requests, rescue stale
  // claims, purge past 180-day retention). runBusMaintenance no-ops while
  // COLLAB_BUS is dark. Guarded so a failure never blocks the other halves.
  try {
    const { runBusMaintenance } = require("./collaborationBus");
    await runBusMaintenance();
  } catch (err) {
    console.error("Collaboration bus maintenance failed:", err.message);
  }
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

// ---------------------------------------------------------------------------
// Launch-sprint cost controls: every job is registered through scheduleJob so
// (a) ALL jobs run inside a background AI context — any AI call a job makes is
//     attributed to it in the usage ledger and gated as "background", and
// (b) AI-consuming jobs are skipped — with an honest, non-spammy log — when
//     background AI is not allowed here (non-production environment, emergency
//     shutoff, BACKGROUND_AI_ENABLED off) or their specific control switch is
//     off. Switches live in config/aiControls.js (admin-tunable, no redeploy).
// ---------------------------------------------------------------------------

const JOBS = []; // registry for the admin status endpoint / Sentinel dashboard

// Log a skip only when the reason CHANGES for a job, so a 30-minute cron that
// stays disabled doesn't flood the log — but the first skip is always visible.
const lastSkipReason = new Map();

async function executeJob({ name, ai, control, run }) {
  if (ai) {
    const gate = await backgroundAiAllowedHere();
    let reason = gate.allowed ? null : gate.reason;
    if (!reason && control && !(await getSwitch(control))) {
      reason = `its control switch is off (${control}=false)`;
    }
    if (reason) {
      if (lastSkipReason.get(name) !== reason) {
        console.log(`Scheduler: skipping "${name}" — ${reason}.`);
        lastSkipReason.set(name, reason);
      }
      const job = JOBS.find((j) => j.name === name);
      if (job) {
        job.lastSkippedAt = new Date().toISOString();
        job.lastSkipReason = reason;
      }
      return { ran: false, reason };
    }
    if (lastSkipReason.has(name)) {
      console.log(`Scheduler: "${name}" is enabled again; resuming.`);
      lastSkipReason.delete(name);
    }
  }
  const job = JOBS.find((j) => j.name === name);
  if (job) job.lastRanAt = new Date().toISOString();
  // Every job tick gets its own workflow id so all paid calls made during the
  // tick roll up into one traceable chain in the usage ledger.
  await runWithWorkflow({ triggeredBy: "background", jobName: name }, run);
  return { ran: true };
}

function scheduleJob({ name, cronExpr, run, ai = false, control = null }) {
  JOBS.push({ name, cronExpr, ai, control });
  cron.schedule(cronExpr, () => {
    executeJob({ name, ai, control, run }).catch((err) => {
      console.error(`Scheduled job "${name}" errored:`, err.message);
    });
  });
}

function listScheduledJobs() {
  return JOBS.map((j) => ({ ...j }));
}

/**
 * Registers every recurring job. AI-consuming jobs carry ai: true (skipped
 * outside production / when switched off); operational jobs (publishing,
 * reminders, sweeps) always run so scheduled work is never silently dropped.
 */
function startScheduler() {
  console.log(
    `Scheduler starting — environment: ${ENVIRONMENT} (detected via ${ENVIRONMENT_BASIS}). ` +
      "Background AI jobs run only when allowed by the AI controls."
  );

  // Mondays 08:00: weekly analytics + optimization + reports for every active
  // brand. Part of the Monday AI stack — OFF by default during the launch
  // sprint (WEEKLY_AI_STACK_ENABLED).
  scheduleJob({
    name: "weekly-analytics",
    cronExpr: "0 8 * * 1",
    ai: true,
    control: "WEEKLY_AI_STACK_ENABLED",
    run: runWeeklyAnalytics,
  });

  // Every minute: publish any scheduled social posts that are now due.
  scheduleJob({ name: "social-publish", cronExpr: "* * * * *", run: publishDuePosts });

  // Every 5 minutes: send any due follow-up touchpoints (email/SMS/phone).
  scheduleJob({ name: "follow-up-touchpoints", cronExpr: "*/5 * * * *", run: executeDueTouchpoints });

  // Top of every hour: send any due drip-sequence emails.
  scheduleJob({ name: "drip-emails", cronExpr: "0 * * * *", run: sendDueDripEmails });

  // Every 5 minutes: send any scheduled one-time email blasts that are now
  // due. On total failure the blast flips to 'failed' and the owner is alerted.
  scheduleJob({ name: "email-blasts", cronExpr: "*/5 * * * *", run: sendDueScheduledCampaigns });

  // Top of every hour: run the AI Health Monitor sweep over every active brand,
  // silently auto-fixing safe issues and alerting owners only on critical ones.
  // Registered ai:false on purpose: detection is deterministic and must keep
  // running; its CONDITIONAL AI analysis is gated at the provider wrapper.
  scheduleJob({ name: "health-monitor-sweep", cronExpr: "0 * * * *", run: runHourlyHealthSweep });

  // Top of every hour: Sentinel checks the platform's third-party API credit /
  // quota levels (ElevenLabs, OpenAI, Anthropic, Twilio, Google Cloud) and alerts
  // the platform owner by voice + push the moment any drops below 20% remaining or
  // a critical threshold — so no service ever runs out silently.
  scheduleJob({
    name: "api-quota-sweep",
    cronExpr: "0 * * * *",
    run: () => runApiQuotaSweep({ notify: true }),
  });

  // Monthly (1st, 04:30): mine last month's real customer conversations for
  // recurring objections/questions (Sage V2 P4; flag-gated inside the runner,
  // skip-gated per brand/month — safe no-op while SAGE_V2_TRUTH_INPUTS is off).
  scheduleJob({
    name: "objections-mining",
    cronExpr: "30 4 1 * *",
    ai: true,
    run: () => {
      const { runMonthlyObjectionsMining } = require("./objectionsMining");
      return runMonthlyObjectionsMining();
    },
  });

  // Nightly 03:30: Sage V2 data-quality sentry — deterministic SQL rules only
  // (zero AI): conflicting active intel items, stale approved Company Truth,
  // analytics coverage gaps. No-ops entirely with SAGE_V2_DQ_SENTRY off.
  scheduleJob({
    name: "data-quality-sentry",
    cronExpr: "30 3 * * *",
    run: () => {
      const { runNightlySentry } = require("./dataQualitySentry");
      return runNightlySentry();
    },
  });

  // Every 15 minutes: close any autonomous lead conversation whose lead has
  // gone 48h without replying (a terminal condition of the Two-Way Autonomous
  // Conversation system). Atomic + status-guarded so it never double-acts.
  scheduleJob({
    name: "autonomous-timeout-sweep",
    cronExpr: "*/15 * * * *",
    run: () => {
      const {
        runAutonomousTimeoutSweep,
      } = require("../controllers/autonomousConversationController");
      return runAutonomousTimeoutSweep();
    },
  });

  // Every 15 minutes: Echo Email Assistant inbox sweep — fetch new mail on
  // every connected account, AI-triage it, alert on urgent/contract/payment,
  // capture leads into the CRM. Per-account guards keep one bad mailbox from
  // blocking the rest. AI triage is the core of the sweep, so it pauses when
  // background AI is off.
  scheduleJob({
    name: "email-inbox-sweep",
    cronExpr: "*/15 * * * *",
    ai: true,
    run: () => {
      const { sweepAllEmailAccounts } = require("./emailMonitor");
      return sweepAllEmailAccounts();
    },
  });

  // Every minute: enqueue any due Echo voice reminders (appointment 15m/5m,
  // follow-up-call-due). Idempotent dedup keys make overlapping ticks safe.
  scheduleJob({ name: "voice-reminders", cronExpr: "* * * * *", run: sweepDueReminders });

  // Every minute: deliver due personal reminders (voice first, SMS fallback a
  // few minutes later if the spoken copy wasn't picked up).
  scheduleJob({ name: "personal-reminders", cronExpr: "* * * * *", run: sweepPersonalReminders });

  // 09:00 daily: task housekeeping — auto-tasks from hot leads waiting 24h,
  // SMS alerts for overdue high-priority tasks, and 3-day stale-task check-ins.
  scheduleJob({ name: "daily-task-sweep", cronExpr: "0 9 * * *", run: runDailyTaskSweep });

  // 18:00 daily: enqueue Echo's end-of-day closing summary for every owner.
  // AI-written, so it pauses when background AI is off.
  scheduleJob({
    name: "closing-summaries",
    cronExpr: "0 18 * * *",
    ai: true,
    run: enqueueClosingSummaries,
  });

  // 07:00 daily: Autonomous Growth Mode. For every owner who turned it on, Echo
  // reviews each brand's campaigns and — strictly within the owner's guardrails —
  // adjusts budgets, pauses losers and reallocates to winners, refreshes fatigued
  // ads, tunes follow-up timing, and learns from conversion data. OFF by default
  // during the launch sprint (AUTONOMOUS_GROWTH_ENABLED).
  scheduleJob({
    name: "autonomous-growth",
    cronExpr: "0 7 * * *",
    ai: true,
    control: "AUTONOMOUS_GROWTH_ENABLED",
    run: () => {
      console.log("Autonomous Growth: starting the daily review of every enabled brand.");
      return runDailyAutonomousGrowth();
    },
  });

  // 20:00 daily: send each owner the plain-English recap of everything Echo did
  // autonomously today (deduped per owner per day). Tied to the same switch —
  // with growth off there is nothing to recap.
  scheduleJob({
    name: "autonomous-growth-summary",
    cronExpr: "0 20 * * *",
    ai: true,
    control: "AUTONOMOUS_GROWTH_ENABLED",
    run: sendDailyAutonomousSummary,
  });

  // 06:00 daily: snapshot every real business's portfolio health score so the
  // Multi-Business Chief of Staff's 12-week trajectory keeps building itself.
  // Deterministic scoring (no AI) — always runs.
  scheduleJob({
    name: "portfolio-health-snapshots",
    cronExpr: "0 6 * * *",
    run: runDailyHealthSnapshots,
  });

  // 06:00 daily: pre-generate every owner's morning briefing so the first
  // login of the day plays it instantly instead of synthesizing on demand.
  // AI-written — pauses when background AI is off (the briefing then falls
  // back to on-demand generation at login, a user-triggered call).
  scheduleJob({
    name: "morning-briefing-warm",
    cronExpr: "0 6 * * *",
    ai: true,
    run: warmMorningBriefings,
  });

  // 05:45 daily: snapshot every brand's goal progress (trend + history) and
  // alert owners on at-risk / hit / exceeding goals via voice + push. Runs
  // BEFORE the 06:00 briefing warm so the pre-generated morning briefing reads
  // that morning's fresh goal snapshots (not yesterday's).
  scheduleJob({ name: "goal-tracking", cronExpr: "45 5 * * *", run: runDailyGoalTracking });

  // 09:30 daily: beta program sweep — email friendly warnings to beta testers
  // who've gone quiet, and notify the waitlist when slots open up.
  scheduleJob({ name: "beta-program-sweep", cronExpr: "30 9 * * *", run: runBetaProgramSweep });

  // Mondays 08:15 (after the weekly analytics run at 08:00): generate each
  // multi-business owner's weekly cross-business intelligence report.
  scheduleJob({
    name: "cross-business-intelligence",
    cronExpr: "15 8 * * 1",
    ai: true,
    control: "WEEKLY_AI_STACK_ENABLED",
    run: runWeeklyCrossBusinessIntelligence,
  });

  // Mondays 05:00 (before the 06:30 autopilot batch): Sage studies the week's
  // accumulated approve/decline/revise decisions and distills them into
  // learnings — so this morning's batch already reflects what Echo learned.
  scheduleJob({
    name: "weekly-learning-study",
    cronExpr: "0 5 * * 1",
    ai: true,
    control: "WEEKLY_AI_STACK_ENABLED",
    run: () => {
      const { runWeeklyLearningStudy } = require("./learningEngine");
      return runWeeklyLearningStudy();
    },
  });

  // Mondays 07:15 (after the learning study and the autopilot batch): Sage
  // studies the past week of REAL platform data (failures, feedback, feature
  // asks, quotas, adoption) and writes an evidence-based improvement report
  // for the admin. Recommendation-only — it never changes any system.
  scheduleJob({
    name: "weekly-self-review",
    cronExpr: "15 7 * * 1",
    ai: true,
    control: "WEEKLY_AI_STACK_ENABLED",
    run: () => {
      const { runWeeklySelfReview } = require("./selfReview");
      return runWeeklySelfReview();
    },
  });

  // Mondays 06:30: Autopilot drafts each enabled brand's week in one batch —
  // posts with graphics plus test ads — then alerts the owner to review.
  // Early on purpose: the batch should be waiting when the owner logs in.
  scheduleJob({
    name: "weekly-autopilot",
    cronExpr: "30 6 * * 1",
    ai: true,
    control: "WEEKLY_AI_STACK_ENABLED",
    run: runWeeklyAutopilot,
  });

  // Mondays 05:30 (before the 06:00 briefing warm): Sage V2 Phase 5 —
  // per-brand Change Diagnostics + opportunity synthesis. Flag-gated inside
  // (SAGE_V2_OPPORTUNITIES, default OFF) so the job is a silent no-op until
  // the flag is turned on.
  scheduleJob({
    name: "sage-opportunity-synthesis",
    cronExpr: "30 5 * * 1",
    ai: true,
    control: "WEEKLY_AI_STACK_ENABLED",
    run: runSageOpportunitySynthesis,
  });

  // 02:20 nightly: deterministic Phase 5 maintenance — join real analytics
  // onto completed directives and expire stale open opportunities. No AI.
  scheduleJob({
    name: "sage-opportunity-maintenance",
    cronExpr: "20 2 * * *",
    run: runSageOpportunityMaintenance,
  });

  // 05:00 daily (launch cadence — was every 6 hours): Scout scans competitor/
  // market activity for every active brand and refreshes its briefing.
  scheduleJob({
    name: "competitor-scan",
    cronExpr: "0 5 * * *",
    ai: true,
    control: "COMPETITOR_RESEARCH_ENABLED",
    run: runCompetitorScan,
  });

  // 05:45 daily (launch cadence — was every 6 hours): Scout's Competitor Ad
  // Spy pulls each confirmed competitor's live Facebook ads for every active
  // brand, records brand-new ones, and alerts the owner on aggressive new ads.
  scheduleJob({
    name: "competitor-ad-scan",
    cronExpr: "45 5 * * *",
    ai: true,
    control: "COMPETITOR_RESEARCH_ENABLED",
    run: runCompetitorAdScan,
  });

  // 04:00 daily: Scout re-reads every tracked competitor website and alerts the
  // owner to meaningful changes (new price/offer/messaging/redesign). Enterprise
  // gate + atomic per-site claim are enforced inside the controller.
  scheduleJob({
    name: "competitor-site-monitor",
    cronExpr: "0 4 * * *",
    ai: true,
    control: "COMPETITOR_RESEARCH_ENABLED",
    run: runCompetitorSiteMonitor,
  });

  // 04:30 daily: Vision studies each real brand's visual landscape — Scout's
  // competitor ad observations + the brand's own image library, distilled with
  // Claude's industry expertise into the growing visual knowledge base Forge
  // consults before every image. Honest sources only; per-brand guard inside.
  scheduleJob({
    name: "vision-daily-study",
    cronExpr: "30 4 * * *",
    ai: true,
    run: () => {
      const { runDailyVisionStudy } = require("./visionEngine");
      return runDailyVisionStudy();
    },
  });

  // Mondays 08:30 (non-AI: deterministic roll-up): Scout rolls up the week's
  // meaningful competitor-website changes across each brand's tracked sites
  // into one owner summary (voice + push). Enterprise gate + at-most-once-per-
  // week guard are enforced inside the controller; weeks with no changes are
  // skipped (never a "nothing happened" buzz). Offset from the 08:00 weekly
  // analytics run so they don't collide.
  scheduleJob({
    name: "competitor-site-digest",
    cronExpr: "30 8 * * 1",
    run: runCompetitorSiteDigest,
  });

  // Every 6 hours at :30 (non-AI): re-verify every stored social connection so
  // an expired/revoked login is flagged ('error') on the calendar views BEFORE
  // the next scheduled post fails.
  scheduleJob({
    name: "social-connection-reverify",
    cronExpr: "30 */6 * * *",
    run: reverifySocialConnections,
  });

  // 06:15 daily (launch cadence — was every 6 hours): Sage runs a deep
  // live-web-search industry-research cycle for every real brand, refreshing the
  // rolling brief + findings feed and paging owners on urgent signals.
  scheduleJob({
    name: "sage-deep-research",
    cronExpr: "15 6 * * *",
    ai: true,
    control: "SAGE_RESEARCH_ENABLED",
    run: runSageDeepCycle,
  });

  // Every 30 minutes: Sage's fast urgent scan for breaking, time-sensitive
  // developments. OFF by default during the launch sprint (SAGE_URGENT_ENABLED)
  // — this was the single biggest credit burner (48 ticks/day × every brand).
  scheduleJob({
    name: "sage-urgent-scan",
    cronExpr: "*/30 * * * *",
    ai: true,
    control: "SAGE_URGENT_ENABLED",
    run: runSageUrgentScan,
  });

  // Tuesday 05:45 — Sage's weekly Pattern Intelligence study: learns WHY
  // public industry campaigns work and refreshes the Creative Brief that
  // steers Forge (claimed per ISO week, so a restart never double-runs).
  scheduleJob({
    name: "sage-pattern-study",
    cronExpr: "45 5 * * 2",
    ai: true,
    control: "SAGE_RESEARCH_ENABLED",
    run: runSagePatternStudy,
  });

  // Real-estate automations (real_estate brands only, demo brands excluded):
  // Hourly at :20 — Atlas drafts a listing-promotion ad within 24h of a new
  // active listing (idempotent via property_listings.ad_promoted_at).
  scheduleJob({
    name: "re-listing-promotion",
    cronExpr: "20 * * * *",
    ai: true,
    run: runListingPromotionSweep,
  });

  // 07:30 daily — Atlas keeps a fresh seller-lead ad draft (per brand / 30
  // days). AI drafting, so it pauses when background AI is off.
  scheduleJob({
    name: "re-seller-lead-ads",
    cronExpr: "30 7 * * *",
    ai: true,
    run: runSellerLeadAdSweep,
  });

  // 07:30 daily — open-house automation: promote 1 week out, remind interested
  // buyers the day before, follow up with attendees the day after. Reminder
  // messaging keeps running even when background AI is paused.
  scheduleJob({ name: "re-open-house", cronExpr: "30 7 * * *", run: runOpenHouseSweep });

  // 09:00 / 13:00 / 17:00 daily — Nova schedules one real-estate post per
  // connected platform (3x/day, deduped per slot).
  scheduleJob({
    name: "re-content-morning",
    cronExpr: "0 9 * * *",
    ai: true,
    run: () => runRealEstateContentRun(0),
  });
  scheduleJob({
    name: "re-content-midday",
    cronExpr: "0 13 * * *",
    ai: true,
    run: () => runRealEstateContentRun(1),
  });
  scheduleJob({
    name: "re-content-evening",
    cronExpr: "0 17 * * *",
    ai: true,
    run: () => runRealEstateContentRun(2),
  });

  const aiJobs = JOBS.filter((j) => j.ai).length;
  console.log(
    `Schedulers started: ${JOBS.length} jobs registered (${aiJobs} AI-consuming, ` +
      `gated by the AI controls; ${JOBS.length - aiJobs} operational). ` +
      "Launch cadence: Sage deep research daily 06:15, competitor scan daily 05:00, " +
      "ad spy daily 05:45, site monitor daily 04:00; Sage urgent scan and the Monday " +
      "AI stack (analytics/learning/autopilot/self-review/cross-business) are " +
      "switched off until re-enabled via the AI controls."
  );
}

module.exports = {
  startScheduler,
  listScheduledJobs,
  executeJob,
  runWeeklyAnalytics,
  latestStoredAnalytics,
  runDailyHealthSnapshots,
  runWeeklyCrossBusinessIntelligence,
  runCompetitorScan,
  runDailyGoalTracking,
  runApiQuotaSweep,
  runBetaProgramSweep,
  runSageDeepCycle,
  runSageUrgentScan,
  runListingPromotionSweep,
  runSellerLeadAdSweep,
  runOpenHouseSweep,
  runRealEstateContentRun,
  runCompetitorSiteDigest,
};
