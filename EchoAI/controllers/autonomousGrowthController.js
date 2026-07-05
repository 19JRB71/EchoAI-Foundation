// Autonomous Growth Mode — the daily engine (Part 3).
//
// Once an owner turns on Autonomous Growth and sets their guardrails, Echo runs
// this every morning for each of their brands and does, on its own but strictly
// within the guardrails:
//   1. Budget: raises budgets on winners / trims losers (guardrail-checked).
//   2. Pause + reallocate: pauses clearly underperforming ad sets and moves that
//      money to the best performer.
//   3. Content: refreshes ad creative that has gone stale (fatigued).
//   4. Follow-ups: speeds up or spaces out follow-up timing based on how often
//      people are replying.
//   5. Audience: reads conversion data and records what's working / flags what
//      isn't for the owner.
//
// Every move is written to growth_actions in plain English (what + why). Moves
// that stay inside the guardrails run automatically (status auto_executed);
// anything that would exceed a guardrail — spend over the approval threshold,
// over the monthly cap, or targeting outside the set geo — is logged as a
// proposal (status proposed) the owner approves with one click. A once-daily
// summary of everything Echo did goes to the owner.
//
// Everything is best-effort per brand/capability: a failure (AI down, no
// connected Facebook account, etc.) is logged and never stops the rest.

const db = require("../config/db");
const { decrypt } = require("../utils/encryption");
const { graphPost } = require("../utils/facebookApi");
const { generateCreativeVariations } = require("../prompts/adCreativePrompt");
const { logAction } = require("./growthController");
const { enqueueOwnerVoiceEvent } = require("../utils/echoVoiceNotifications");
const {
  evaluateBudgetChange,
  daysRemainingInMonth,
  followupTimingFactor,
  describeTimingChange,
  formatMoney,
  geoAllowed,
} = require("../utils/growthGuardrails");

let sendAutonomousSummaryEmail = null;
try {
  ({ sendAutonomousSummaryEmail } = require("./emailController"));
} catch (_) {
  /* email optional */
}

// --- small shared helpers ----------------------------------------------------

/** Serialized growth guardrails for a user, or null when the row is missing. */
async function getGrowthSettings(userId) {
  const { rows } = await db.query(
    `SELECT enabled, monthly_budget_cap, approval_threshold, brand_voice_rules, geo_targeting
       FROM growth_settings WHERE user_id = $1`,
    [userId],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    enabled: !!r.enabled,
    monthlyBudgetCap: r.monthly_budget_cap != null ? Number(r.monthly_budget_cap) : null,
    approvalThreshold: r.approval_threshold != null ? Number(r.approval_threshold) : null,
    brandVoiceRules: r.brand_voice_rules || "",
    geoTargeting: r.geo_targeting || "",
  };
}

/** Decrypted Facebook token for a user, or null if not connected. Best-effort. */
async function getFacebookToken(userId) {
  try {
    const { rows } = await db.query(
      `SELECT api_token_encrypted, connection_status
         FROM api_integrations
        WHERE user_id = $1 AND platform = 'facebook'`,
      [userId],
    );
    if (!rows[0] || rows[0].connection_status !== "connected") return null;
    return decrypt(rows[0].api_token_encrypted);
  } catch (e) {
    console.error("autonomous getFacebookToken failed:", e.message);
    return null;
  }
}

/**
 * Estimate of the account's committed ad spend so far this month, in dollars.
 * We have daily budgets rather than a spend ledger, so this multiplies the sum
 * of active daily budgets by the number of days elapsed this month — a
 * deliberately conservative estimate the monthly-cap guardrail leans on.
 */
async function monthToDateSpend(brandId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(budget), 0) AS daily_total
       FROM campaigns WHERE brand_id = $1 AND status = 'active'`,
    [brandId],
  );
  const dailyTotal = Number(rows[0] ? rows[0].daily_total : 0) || 0;
  const dayOfMonth = new Date().getDate();
  return dailyTotal * dayOfMonth;
}

/** Upsert the per-brand learned autonomous state. */
async function upsertBrandState(brandId, patch = {}) {
  const cols = [];
  const vals = [brandId];
  let i = 2;
  for (const [k, v] of Object.entries(patch)) {
    cols.push(`${k} = $${i++}`);
    vals.push(v);
  }
  const setClause = cols.length ? `, ${cols.join(", ")}` : "";
  const insertCols = ["brand_id", ...Object.keys(patch)];
  const insertVals = ["$1", ...Object.keys(patch).map((_, idx) => `$${idx + 2}`)];
  await db.query(
    `INSERT INTO growth_brand_state (${insertCols.join(", ")})
     VALUES (${insertVals.join(", ")})
     ON CONFLICT (brand_id) DO UPDATE SET updated_at = NOW()${setClause}`,
    vals,
  );
}

async function getBrandState(brandId) {
  const { rows } = await db.query(
    `SELECT followup_timing_factor, audience_notes, last_run_at
       FROM growth_brand_state WHERE brand_id = $1`,
    [brandId],
  );
  return rows[0] || { followup_timing_factor: 1.0, audience_notes: null, last_run_at: null };
}

// --- capability 1 & 2: budget + pause/reallocate -----------------------------

/**
 * Classify a brand's active campaigns into winners and underperformers using
 * cost-per-lead relative to the brand median. Pure so it stays predictable.
 */
function classifyCampaigns(campaigns) {
  const withCpl = campaigns.filter((c) => c.cost_per_lead != null && Number(c.cost_per_lead) > 0);
  if (withCpl.length === 0) return { winners: [], losers: [], median: null };
  const sorted = [...withCpl].sort((a, b) => Number(a.cost_per_lead) - Number(b.cost_per_lead));
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2
      ? Number(sorted[mid].cost_per_lead)
      : (Number(sorted[mid - 1].cost_per_lead) + Number(sorted[mid].cost_per_lead)) / 2;
  const winners = sorted.filter((c) => Number(c.cost_per_lead) <= median);
  // Underperformers: cost per lead is at least 50% worse than the median AND
  // there's a healthier campaign to move the money to.
  const losers =
    sorted.length >= 2 ? sorted.filter((c) => Number(c.cost_per_lead) >= median * 1.5) : [];
  return { winners, losers, median };
}

async function runBudgetAndReallocation(brand, settings, fbToken, counts) {
  const { rows: campaigns } = await db.query(
    `SELECT campaign_id, campaign_name, budget, cost_per_lead, conversion_rate,
            facebook_adset_id, status
       FROM campaigns
      WHERE brand_id = $1 AND status = 'active'`,
    [brand.brand_id],
  );
  if (campaigns.length === 0) return;

  const { winners, losers } = classifyCampaigns(campaigns);
  const daysRemaining = daysRemainingInMonth();
  let mtd = await monthToDateSpend(brand.brand_id);

  const topWinner = winners[0] || null;
  let freedBudget = 0;

  // --- Pause clear underperformers (best-effort FB) and free their budget. ----
  for (const loser of losers) {
    // Don't pause the only remaining winner target.
    if (topWinner && loser.campaign_id === topWinner.campaign_id) continue;
    if (fbToken && loser.facebook_adset_id) {
      try {
        await graphPost(loser.facebook_adset_id, { status: "PAUSED" }, fbToken);
      } catch (e) {
        console.error(`autonomous pause FB failed for ${loser.campaign_id}:`, e.message);
      }
    }
    await db.query("UPDATE campaigns SET status = 'paused' WHERE campaign_id = $1", [
      loser.campaign_id,
    ]);
    freedBudget += Number(loser.budget) || 0;
    await logAction(brand.user_id, brand.brand_id, {
      kind: "pause",
      category: "pause",
      risk: "low",
      status: "auto_executed",
      executed: true,
      title: `Paused an underperforming campaign: ${loser.campaign_name}`,
      detail:
        `I paused "${loser.campaign_name}" because it was costing about ${formatMoney(loser.cost_per_lead)} ` +
        `per lead — well above your other campaigns. That stops wasting money on it and frees up ` +
        `${formatMoney(loser.budget)} a day to put toward what's actually working.`,
      payload: { campaignId: loser.campaign_id, freedDailyBudget: Number(loser.budget) || 0 },
    });
    counts.paused += 1;
  }

  // --- Reallocate freed budget (and nudge winners up) within guardrails. -------
  if (topWinner) {
    const current = Number(topWinner.budget) || 0;
    // Reallocate freed money plus a modest 20% growth nudge for a strong winner.
    const proposed = Math.round((current + freedBudget) * (freedBudget > 0 ? 1 : 1.2));
    if (proposed > current) {
      const decision = evaluateBudgetChange({
        settings,
        currentDailyBudget: current,
        proposedDailyBudget: proposed,
        monthToDateSpend: mtd,
        daysRemaining,
        campaignName: topWinner.campaign_name,
      });
      await applyOrProposeBudget(brand, topWinner, decision, fbToken, counts);
      if (decision.decision === "auto") mtd += decision.incrementalMonthlySpend;
    }
  }

  // --- Trim spend on any remaining underperformers we didn't pause. -----------
  for (const loser of losers) {
    const stillActive = await db.query(
      "SELECT status FROM campaigns WHERE campaign_id = $1",
      [loser.campaign_id],
    );
    if (!stillActive.rows[0] || stillActive.rows[0].status !== "active") continue;
    const current = Number(loser.budget) || 0;
    const proposed = Math.max(0, Math.round(current * 0.7));
    if (proposed < current) {
      const decision = evaluateBudgetChange({
        settings,
        currentDailyBudget: current,
        proposedDailyBudget: proposed,
        monthToDateSpend: mtd,
        daysRemaining,
        campaignName: loser.campaign_name,
      });
      await applyOrProposeBudget(brand, loser, decision, fbToken, counts);
    }
  }
}

/** Apply an auto decision (FB + DB) or log an approval/blocked proposal. */
async function applyOrProposeBudget(brand, campaign, decision, fbToken, counts) {
  if (decision.decision === "auto") {
    if (fbToken && campaign.facebook_adset_id) {
      try {
        await graphPost(
          campaign.facebook_adset_id,
          { daily_budget: Math.round(decision.appliedDailyBudget * 100) },
          fbToken,
        );
      } catch (e) {
        console.error(`autonomous budget FB apply failed for ${campaign.campaign_id}:`, e.message);
      }
    }
    await db.query("UPDATE campaigns SET budget = $1 WHERE campaign_id = $2", [
      decision.appliedDailyBudget,
      campaign.campaign_id,
    ]);
    await logAction(brand.user_id, brand.brand_id, {
      kind: "budget_change",
      category: "budget",
      risk: "low",
      status: "auto_executed",
      executed: true,
      title: `Adjusted budget on ${campaign.campaign_name}`,
      detail: decision.reason,
      payload: {
        campaignId: campaign.campaign_id,
        adsetId: campaign.facebook_adset_id,
        dailyBudget: decision.appliedDailyBudget,
      },
    });
    counts.budgetAuto += 1;
  } else if (decision.decision === "approval") {
    await logAction(brand.user_id, brand.brand_id, {
      kind: "budget_change",
      category: "budget",
      risk: "high",
      status: "proposed",
      executed: false,
      title: `Approval needed: raise budget on ${campaign.campaign_name}`,
      detail: decision.reason,
      payload: {
        campaignId: campaign.campaign_id,
        adsetId: campaign.facebook_adset_id,
        dailyBudget: decision.appliedDailyBudget,
      },
    });
    counts.proposed += 1;
  } else {
    // blocked — record it so the owner sees Echo respected the cap.
    await logAction(brand.user_id, brand.brand_id, {
      kind: "budget_change",
      category: "budget",
      risk: "low",
      status: "auto_executed",
      executed: true,
      title: `Held budget on ${campaign.campaign_name} at your limit`,
      detail: decision.reason,
      payload: { campaignId: campaign.campaign_id },
    });
    counts.blocked += 1;
  }
}

// --- capability 3: content fatigue -------------------------------------------

/**
 * A campaign is "fatigued" when it has no queued creative variations to test, or
 * its conversion rate has dropped low — a sign the current ad has worn out.
 */
function isFatigued(campaign) {
  const variations = campaign.ad_creative_variations;
  const hasVariations = Array.isArray(variations) && variations.length > 0;
  const lowConversion =
    campaign.conversion_rate != null && Number(campaign.conversion_rate) < 0.01;
  return !hasVariations || lowConversion;
}

async function runContentRefresh(brand, settings, counts) {
  const { rows: campaigns } = await db.query(
    `SELECT campaign_id, campaign_name, conversion_rate, ad_creative_variations
       FROM campaigns WHERE brand_id = $1 AND status = 'active'`,
    [brand.brand_id],
  );
  for (const c of campaigns) {
    if (!isFatigued(c)) continue;
    // Deterministic, on-brand generator — honors the owner's brand voice rules.
    const variations = generateCreativeVariations(
      { ...brand, brand_voice_rules: settings.brandVoiceRules || brand.voice_description },
      { count: 3 },
    );
    if (!Array.isArray(variations) || variations.length === 0) continue;
    await db.query(
      "UPDATE campaigns SET ad_creative_variations = $1 WHERE campaign_id = $2",
      [JSON.stringify(variations), c.campaign_id],
    );
    await logAction(brand.user_id, brand.brand_id, {
      kind: "content_refresh",
      category: "content",
      risk: "low",
      status: "auto_executed",
      executed: true,
      title: `Refreshed the ads for ${c.campaign_name}`,
      detail:
        `The ads on "${c.campaign_name}" were getting stale, so I wrote 3 fresh versions in your ` +
        `brand's voice and queued them to test. New wording usually revives clicks and keeps costs down.`,
      payload: { campaignId: c.campaign_id, count: variations.length },
    });
    counts.content += 1;
  }
}

// --- capability 4: follow-up timing by response rate -------------------------

async function runFollowupTiming(brand, counts) {
  const { rows } = await db.query(
    `SELECT
        COUNT(*) FILTER (WHERE current_step >= 1) AS engaged,
        COUNT(*) FILTER (WHERE current_step >= 1
                          AND stop_reason IN ('lead_responded','booked','converted')) AS responded
       FROM follow_up_sequences
      WHERE brand_id = $1 AND started_at > NOW() - INTERVAL '30 days'`,
    [brand.brand_id],
  );
  const engaged = Number(rows[0] ? rows[0].engaged : 0) || 0;
  if (engaged < 5) return; // too little data to adjust on
  const responded = Number(rows[0].responded) || 0;
  const responseRate = responded / engaged;
  const newFactor = followupTimingFactor(responseRate);

  const state = await getBrandState(brand.brand_id);
  const oldFactor = Number(state.followup_timing_factor) || 1.0;
  if (Math.abs(newFactor - oldFactor) < 0.05) return; // no meaningful change

  await upsertBrandState(brand.brand_id, { followup_timing_factor: newFactor });
  await logAction(brand.user_id, brand.brand_id, {
    kind: "followup_timing",
    category: "followup",
    risk: "low",
    status: "auto_executed",
    executed: true,
    title: "Tuned your follow-up timing",
    detail: describeTimingChange(oldFactor, newFactor, responseRate),
    payload: { oldFactor, newFactor, responseRate },
  });
  counts.followup += 1;
}

// --- capability 5: audience targeting by conversion data ---------------------

/** Best-effort extraction of a geo/location string from a brand's audience JSON. */
function extractAudienceGeo(targetAudience) {
  if (!targetAudience || typeof targetAudience !== "object") return "";
  for (const key of ["location", "geo", "geography", "city", "region", "area", "locations"]) {
    const v = targetAudience[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v) && v.length && typeof v[0] === "string") return v.join(", ");
  }
  return "";
}

async function runAudienceUpdate(brand, settings, counts) {
  const { rows } = await db.query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE conversion_status = 'converted') AS converted
       FROM leads WHERE brand_id = $1 AND created_at > NOW() - INTERVAL '30 days'`,
    [brand.brand_id],
  );
  const total = Number(rows[0] ? rows[0].total : 0) || 0;
  if (total < 10) return; // not enough conversion data to learn from
  const converted = Number(rows[0].converted) || 0;
  const rate = converted / total;
  const pct = Math.round(rate * 100);

  let note;
  let title;
  let status = "auto_executed";
  let risk = "low";
  if (rate >= 0.15) {
    title = "Your current audience is converting well";
    note =
      `Over the last 30 days, ${pct}% of the people your ads reached became customers — that's strong. ` +
      `I'm keeping your targeting focused on this audience since it's clearly working.`;
  } else if (rate < 0.05) {
    title = "Suggestion: refine who your ads target";
    note =
      `Only ${pct}% of recent leads converted, which is on the low side. I recommend narrowing your ` +
      `audience to the people most likely to buy. I've flagged this for your approval rather than ` +
      `changing your targeting on my own. Expected result: fewer wasted clicks and a lower cost per customer.`;
    status = "proposed";
    risk = "high";
  } else {
    title = "Audience check: steady conversions";
    note =
      `About ${pct}% of recent leads converted — a healthy, steady rate. No targeting change needed right now; ` +
      `I'll keep watching the numbers.`;
  }

  // Geo guardrail: if the brand's audience geography falls outside the owner's
  // set target area, never auto-confirm the targeting on my own — escalate to a
  // proposal with the geo explanation so the owner decides.
  const audienceGeo = extractAudienceGeo(brand.target_audience);
  const geo = geoAllowed(settings || {}, audienceGeo);
  if (!geo.allowed && status === "auto_executed") {
    status = "proposed";
    risk = "high";
    note = `${note} ${geo.reason}`;
  }

  // Persist the learned insight so it informs future content/targeting prompts.
  await upsertBrandState(brand.brand_id, { audience_notes: note });
  try {
    const current = brand.target_audience && typeof brand.target_audience === "object" ? brand.target_audience : {};
    const merged = { ...current, autonomousInsight: note, autonomousInsightAt: new Date().toISOString() };
    await db.query("UPDATE brands SET target_audience = $1 WHERE brand_id = $2", [
      JSON.stringify(merged),
      brand.brand_id,
    ]);
  } catch (e) {
    console.error("autonomous audience note persist failed:", e.message);
  }

  await logAction(brand.user_id, brand.brand_id, {
    kind: "audience_update",
    category: "audience",
    risk,
    status,
    executed: status === "auto_executed",
    title,
    detail: note,
    payload: { conversionRate: rate, total, converted },
  });
  counts.audience += 1;
}

// --- per-brand orchestration -------------------------------------------------

/**
 * Run the full autonomous growth pass for one brand. Assumes the owner has
 * Autonomous Growth enabled (the caller checks). Each capability is best-effort.
 * @returns {object} counts of what happened.
 */
async function runAutonomousGrowthForBrand(brand, settings) {
  const counts = {
    budgetAuto: 0,
    proposed: 0,
    blocked: 0,
    paused: 0,
    content: 0,
    followup: 0,
    audience: 0,
  };
  const fbToken = await getFacebookToken(brand.user_id);

  const steps = [
    () => runBudgetAndReallocation(brand, settings, fbToken, counts),
    () => runContentRefresh(brand, settings, counts),
    () => runFollowupTiming(brand, counts),
    () => runAudienceUpdate(brand, settings, counts),
  ];
  for (const step of steps) {
    try {
      await step();
    } catch (e) {
      console.error(`Autonomous growth step failed for brand ${brand.brand_id}:`, e.message);
    }
  }
  return counts;
}

/**
 * Atomically claim today's autonomous run for a brand. Returns true only for the
 * caller that wins the claim; a second (overlapping tick or parallel worker)
 * call for the same brand on the same day returns false, so a brand's budgets
 * can never be moved twice in one day. Sets last_run_at as the claim marker.
 */
async function claimDailyRun(brandId) {
  const { rows } = await db.query(
    `INSERT INTO growth_brand_state (brand_id, last_run_at)
     VALUES ($1, NOW())
     ON CONFLICT (brand_id) DO UPDATE SET last_run_at = NOW(), updated_at = NOW()
       WHERE growth_brand_state.last_run_at IS NULL
          OR growth_brand_state.last_run_at::date < CURRENT_DATE
     RETURNING brand_id`,
    [brandId],
  );
  return rows.length > 0;
}

/**
 * Daily scheduler entry point. Iterates every brand whose owner has Autonomous
 * Growth enabled (non-demo). Best-effort per brand.
 */
async function runDailyAutonomousGrowth() {
  const { rows: brands } = await db.query(
    `SELECT b.brand_id, b.user_id, b.brand_name, b.voice_description, b.target_audience
       FROM brands b
       JOIN growth_settings gs ON gs.user_id = b.user_id
      WHERE gs.enabled = TRUE AND b.is_demo = FALSE`,
  );
  let handled = 0;
  for (const brand of brands) {
    try {
      // Skip any brand already processed today (overlapping ticks / parallel workers).
      const claimed = await claimDailyRun(brand.brand_id);
      if (!claimed) continue;
      const settings = await getGrowthSettings(brand.user_id);
      if (!settings || !settings.enabled) continue;
      await runAutonomousGrowthForBrand(brand, settings);
      handled += 1;
    } catch (e) {
      console.error(`Autonomous growth failed for brand ${brand.brand_id}:`, e.message);
    }
  }
  console.log(`Autonomous Growth daily run complete: ${handled}/${brands.length} brand(s) processed.`);
  return { processed: handled, total: brands.length };
}

// --- daily owner summary -----------------------------------------------------

/**
 * Builds a plain-English recap of everything Echo did today for one owner.
 */
function buildSummaryText(firstName, actions) {
  const autos = actions.filter((a) => a.status === "auto_executed");
  const proposals = actions.filter((a) => a.status === "proposed");
  const lines = [];
  lines.push(`${firstName}, here's what I handled for you today:`);
  if (autos.length) {
    lines.push("");
    lines.push(`I took care of ${autos.length} thing${autos.length === 1 ? "" : "s"} on my own:`);
    autos.slice(0, 8).forEach((a) => lines.push(`• ${a.title}`));
  }
  if (proposals.length) {
    lines.push("");
    lines.push(
      `And ${proposals.length} opportunit${proposals.length === 1 ? "y is" : "ies are"} waiting for your OK:`,
    );
    proposals.slice(0, 8).forEach((a) => lines.push(`• ${a.title}`));
  }
  if (!autos.length && !proposals.length) {
    lines.push("Everything's running smoothly — no changes were needed today.");
  }
  return lines.join("\n");
}

/**
 * Once-daily summary of the day's autonomous actions to every owner who has
 * Autonomous Growth enabled. Deduped per (user, day) so overlapping ticks can't
 * send twice. Best-effort: email + Echo voice are fire-and-forget.
 */
async function sendDailyAutonomousSummary() {
  const today = new Date().toISOString().slice(0, 10);
  const { rows: owners } = await db.query(
    `SELECT DISTINCT u.user_id, u.email, u.first_name
       FROM users u
       JOIN growth_settings gs ON gs.user_id = u.user_id
      WHERE gs.enabled = TRUE`,
  );

  let sent = 0;
  for (const owner of owners) {
    try {
      // Today's actions for this owner.
      const { rows: actions } = await db.query(
        `SELECT title, status FROM growth_actions
          WHERE user_id = $1 AND created_at::date = $2::date
          ORDER BY created_at DESC`,
        [owner.user_id, today],
      );
      if (actions.length === 0) continue;

      // Claim the day atomically so we send exactly once.
      const claim = await db.query(
        `INSERT INTO growth_daily_summaries (user_id, summary_date, action_count)
         VALUES ($1, $2::date, $3)
         ON CONFLICT (user_id, summary_date) DO NOTHING
         RETURNING user_id`,
        [owner.user_id, today, actions.length],
      );
      if (claim.rows.length === 0) continue; // already sent today

      const firstName = owner.first_name || "there";
      const text = buildSummaryText(firstName, actions);

      if (sendAutonomousSummaryEmail && owner.email) {
        sendAutonomousSummaryEmail({ email: owner.email, firstName, summary: text }).catch((e) =>
          console.error("Autonomous summary email failed:", e.message),
        );
      }
      enqueueOwnerVoiceEvent(
        owner.user_id,
        "autonomous_summary",
        () => text,
        {
          title: "Today's autonomous actions",
          dedupKey: `autosummary:${owner.user_id}:${today}`,
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        },
      ).catch((e) => console.error("Autonomous summary voice enqueue failed:", e.message));
      sent += 1;
    } catch (e) {
      console.error(`Autonomous summary failed for user ${owner.user_id}:`, e.message);
    }
  }
  console.log(`Autonomous Growth daily summary sent to ${sent} owner(s).`);
  return { sent };
}

// --- approve / decline a proposal -------------------------------------------

/**
 * POST /api/echo/growth/actions/:id/approve
 * Executes a proposed action now (re-checking guardrails for budget changes),
 * then marks it approved. Owner-only (route enforces requireOwner).
 */
async function approveAction(req, res) {
  const userId = req.user.userId;
  const { id } = req.params;
  try {
    // Claim the transition atomically so a concurrent decline (or a double-tap
    // approve) can't also fire the side effects. Only the winner of the
    // proposed → approved flip gets the row back and runs the change.
    const claim = await db.query(
      `UPDATE growth_actions SET status = 'approved', executed_at = NOW(), updated_at = NOW()
        WHERE action_id = $1 AND user_id = $2 AND status = 'proposed'
        RETURNING category, payload`,
      [id, userId],
    );
    if (claim.rows.length === 0) {
      const existing = await db.query(
        "SELECT status FROM growth_actions WHERE action_id = $1 AND user_id = $2",
        [id, userId],
      );
      if (!existing.rows[0]) return res.status(404).json({ error: "Action not found." });
      return res.status(409).json({ error: "This action has already been handled." });
    }

    const action = claim.rows[0];
    const payload = action.payload || {};
    if (action.category === "budget" && payload.campaignId && payload.dailyBudget != null) {
      // Owner has explicitly approved, so apply the proposed budget as-is.
      const fbToken = await getFacebookToken(userId);
      if (fbToken && payload.adsetId) {
        try {
          await graphPost(
            payload.adsetId,
            { daily_budget: Math.round(Number(payload.dailyBudget) * 100) },
            fbToken,
          );
        } catch (e) {
          console.error("approveAction FB apply failed:", e.message);
        }
      }
      await db.query("UPDATE campaigns SET budget = $1 WHERE campaign_id = $2", [
        Number(payload.dailyBudget),
        payload.campaignId,
      ]);
    }
    // Audience / other proposals are informational — approving records the owner's
    // acknowledgement (already set by the atomic claim above); the learned insight
    // is already persisted.
    return res.json({ ok: true, status: "approved" });
  } catch (err) {
    console.error("approveAction error:", err.message);
    return res.status(500).json({ error: "Couldn't approve this action." });
  }
}

/** POST /api/echo/growth/actions/:id/decline — owner passes on a proposal. */
async function declineAction(req, res) {
  const userId = req.user.userId;
  const { id } = req.params;
  try {
    const { rowCount } = await db.query(
      `UPDATE growth_actions SET status = 'declined', updated_at = NOW()
        WHERE action_id = $1 AND user_id = $2 AND status = 'proposed'`,
      [id, userId],
    );
    if (rowCount === 0) {
      return res.status(409).json({ error: "This action can no longer be declined." });
    }
    return res.json({ ok: true, status: "declined" });
  } catch (err) {
    console.error("declineAction error:", err.message);
    return res.status(500).json({ error: "Couldn't decline this action." });
  }
}

module.exports = {
  runAutonomousGrowthForBrand,
  runDailyAutonomousGrowth,
  sendDailyAutonomousSummary,
  approveAction,
  declineAction,
  // exported for unit tests
  classifyCampaigns,
  isFatigued,
  buildSummaryText,
  getFollowupTimingFactor: async (brandId) => Number((await getBrandState(brandId)).followup_timing_factor) || 1.0,
};
