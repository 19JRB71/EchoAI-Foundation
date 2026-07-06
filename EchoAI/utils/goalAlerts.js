/**
 * Daily goal tracking + alert monitoring. Once a day the scheduler calls
 * `runDailyGoalTracking()`, which snapshots every brand that has active goals
 * (giving trend + history) and, for goals that are at risk / hit / exceeding,
 * alerts the owner via Echo voice + web push + mobile push. Mission Control's
 * live attention panel reads the overview endpoint directly, so no separate
 * attention store is needed here.
 *
 * Best-effort throughout: a failure for one brand/goal never aborts the rest,
 * and alert delivery never throws into the snapshot loop.
 */

const db = require("../config/db");
const { snapshotBrandGoals, monthWindow } = require("./goalMetrics");
const { getMetric } = require("../config/goals");
const { enqueueOwnerVoiceEvent } = require("./echoVoiceNotifications");
const pushController = require("../controllers/pushController");
const mobilePushController = require("../controllers/mobilePushController");

/** Human-readable value for a metric (currency / ratio / count). */
function formatValue(value, unit) {
  if (value == null || !Number.isFinite(Number(value))) return "no data";
  const n = Number(value);
  if (unit === "currency") return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (unit === "ratio") return `${n}x`;
  return `${Math.round(n)}`;
}

/** Build the deterministic spoken line + short push body for a goal alert. */
function buildAlertCopy(goal, brandName) {
  const meta = getMetric(goal.metricKey);
  const unit = meta ? meta.unit : "count";
  const label = goal.label || (meta ? meta.label : goal.metricKey);
  const pct = goal.percentToGoal == null ? null : Math.round(goal.percentToGoal);
  const target = formatValue(goal.targetValue, unit);
  const current = formatValue(goal.currentValue, unit);

  if (goal.status === "exceeding") {
    return {
      speak: (name) =>
        `Great news ${name} — you're exceeding your ${label} goal for ${brandName}. ` +
        `You're at ${current}, which is ${pct}% of your ${target} target.`,
      title: "Goal exceeded 🎉",
      body: `${brandName}: ${label} at ${pct}% of target (${current}).`,
    };
  }
  if (goal.status === "hit") {
    return {
      speak: (name) =>
        `${name}, you just hit your ${label} goal for ${brandName} — ${current} against your ${target} target. Nicely done.`,
      title: "Goal hit ✅",
      body: `${brandName}: ${label} goal reached (${current}).`,
    };
  }
  // at_risk
  return {
    speak: (name) =>
      `Heads up ${name} — your ${label} goal for ${brandName} is at risk. ` +
      `You're at ${current}, about ${pct}% of your ${target} target, and pacing behind for the month.`,
    title: "Goal at risk ⚠️",
    body: `${brandName}: ${label} behind pace (${pct}% of target).`,
  };
}

/** Alert-worthy statuses. */
const ALERT_STATUSES = new Set(["at_risk", "hit", "exceeding"]);

/**
 * Snapshot all brands with active goals and dispatch daily alerts. Returns a
 * small summary for logging/testing.
 */
async function runDailyGoalTracking() {
  const win = monthWindow();
  const today = new Date().toISOString().slice(0, 10);

  // Brands that actually have active goals, with their owner.
  const { rows: brands } = await db.query(
    `SELECT DISTINCT b.brand_id, b.brand_name, b.user_id
       FROM brand_goals g
       JOIN brands b ON b.brand_id = g.brand_id
      WHERE g.status = 'active'`
  );

  let brandsProcessed = 0;
  let alertsSent = 0;

  for (const brand of brands) {
    let goals = [];
    try {
      ({ goals } = await snapshotBrandGoals(brand.brand_id, win));
      brandsProcessed += 1;
    } catch (err) {
      console.error(`Goal snapshot failed for brand ${brand.brand_id}:`, err.message);
      continue;
    }

    for (const goal of goals) {
      if (!ALERT_STATUSES.has(goal.status)) continue;
      const copy = buildAlertCopy(goal, brand.brand_name);
      // Once per goal per status per day.
      const dedupKey = `goal_alert:${goal.goalId}:${goal.status}:${today}`;

      try {
        const enqueued = await enqueueOwnerVoiceEvent(
          brand.user_id,
          "goal_alert",
          copy.speak,
          {
            brandId: brand.brand_id,
            title: copy.title,
            dedupKey,
            payload: {
              goalId: goal.goalId,
              metricKey: goal.metricKey,
              status: goal.status,
              percentToGoal: goal.percentToGoal,
            },
          }
        );
        if (enqueued) alertsSent += 1;

        // Web + mobile push run best-effort alongside voice.
        const pushPayload = {
          title: copy.title,
          body: copy.body,
          data: { type: "goal_alert", brandId: brand.brand_id, goalId: goal.goalId },
        };
        pushController.sendPushToUser(brand.user_id, pushPayload).catch(() => {});
        mobilePushController.sendToUser(brand.user_id, pushPayload).catch(() => {});
      } catch (err) {
        console.error(`Goal alert dispatch failed for goal ${goal.goalId}:`, err.message);
      }
    }
  }

  return { brandsProcessed, alertsSent };
}

module.exports = { runDailyGoalTracking, buildAlertCopy };
