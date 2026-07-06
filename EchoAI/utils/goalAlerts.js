/**
 * Daily goal tracking + alert monitoring. Once a day the scheduler calls
 * `runDailyGoalTracking()`, which snapshots every REAL (non-demo) brand that has
 * active goals (giving trend + history) and alerts the owner via Echo voice +
 * web push + mobile push. A goal can raise more than one alert in a day:
 *   - a status alert — goal hit, exceeding, or behind pace (early vs urgent), and
 *   - a momentum alert — a large single-day swing in percent-to-goal (up/down),
 * which surfaces sudden changes long before the slow status buckets would.
 * Mission Control's live attention panel reads the overview endpoint directly, so
 * no separate attention store is needed here.
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

// A single-day change in percent-to-goal of at least this many points (up or
// down) is worth a proactive momentum alert.
const SWING_THRESHOLD = 20;
// A behind-pace goal projected below this percent for the month is "urgent"
// rather than an early heads-up.
const URGENT_PROJECTED_PCT = 60;

/** Human-readable value for a metric (currency / ratio / count). */
function formatValue(value, unit) {
  if (value == null || !Number.isFinite(Number(value))) return "no data";
  const n = Number(value);
  if (unit === "currency") return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (unit === "ratio") return `${n}x`;
  return `${Math.round(n)}`;
}

/**
 * Decide which alert kinds a goal warrants today. A goal can warrant both a
 * status alert (achieved / behind pace, split into early vs urgent) and a
 * momentum alert (a large day-over-day swing in percent-to-goal).
 * `priorPercent` is yesterday's percent-to-goal (or null when unknown).
 */
function deriveAlertKinds(goal, priorPercent) {
  const kinds = [];

  if (goal.status === "exceeding") kinds.push({ kind: "exceeding" });
  else if (goal.status === "hit") kinds.push({ kind: "hit" });
  else if (goal.status === "at_risk") {
    const proj =
      goal.projectedPercent == null ? goal.percentToGoal : goal.projectedPercent;
    const urgent = proj != null && Number(proj) < URGENT_PROJECTED_PCT;
    kinds.push({ kind: urgent ? "at_risk_urgent" : "at_risk_early" });
  }

  // Momentum: needs a measurable reading both today and yesterday.
  if (
    priorPercent != null &&
    Number.isFinite(Number(priorPercent)) &&
    goal.percentToGoal != null &&
    Number.isFinite(Number(goal.percentToGoal))
  ) {
    const delta = Number(goal.percentToGoal) - Number(priorPercent);
    if (delta >= SWING_THRESHOLD) kinds.push({ kind: "swing_up", delta });
    else if (delta <= -SWING_THRESHOLD) kinds.push({ kind: "swing_down", delta });
  }

  return kinds;
}

/**
 * Build the deterministic spoken line + short push body for a goal alert.
 * `kind` defaults to the goal's own status so older callers keep working;
 * `extra.delta` carries the swing size for momentum alerts.
 */
function buildAlertCopy(goal, brandName, kind = goal.status, extra = {}) {
  const meta = getMetric(goal.metricKey);
  const unit = meta ? meta.unit : "count";
  const label = goal.label || (meta ? meta.label : goal.metricKey);
  const pct = goal.percentToGoal == null ? null : Math.round(goal.percentToGoal);
  const target = formatValue(goal.targetValue, unit);
  const current = formatValue(goal.currentValue, unit);
  const delta = extra.delta == null ? null : Math.abs(Math.round(Number(extra.delta)));

  switch (kind) {
    case "exceeding":
      return {
        speak: (name) =>
          `Great news ${name} — you're exceeding your ${label} goal for ${brandName}. ` +
          `You're at ${current}, which is ${pct}% of your ${target} target.`,
        title: "Goal exceeded 🎉",
        body: `${brandName}: ${label} at ${pct}% of target (${current}).`,
      };
    case "hit":
      return {
        speak: (name) =>
          `${name}, you just hit your ${label} goal for ${brandName} — ${current} against your ${target} target. Nicely done.`,
        title: "Goal hit ✅",
        body: `${brandName}: ${label} goal reached (${current}).`,
      };
    case "at_risk_urgent":
      return {
        speak: (name) =>
          `${name}, your ${label} goal for ${brandName} needs attention now. ` +
          `You're at ${current}, only ${pct}% of your ${target} target, and projected to fall well short this month.`,
        title: "Goal urgently behind 🚨",
        body: `${brandName}: ${label} urgently behind (${pct}% of target).`,
      };
    case "at_risk_early":
    case "at_risk":
      return {
        speak: (name) =>
          `Heads up ${name} — your ${label} goal for ${brandName} is starting to slip. ` +
          `You're at ${current}, about ${pct}% of your ${target} target, and pacing a little behind for the month.`,
        title: "Goal at risk ⚠️",
        body: `${brandName}: ${label} behind pace (${pct}% of target).`,
      };
    case "swing_up":
      return {
        speak: (name) =>
          `${name}, your ${label} for ${brandName} jumped ${delta} points toward goal in a day — ` +
          `now at ${pct}% of target. Something's working; worth leaning in.`,
        title: "Big goal jump 📈",
        body: `${brandName}: ${label} up ${delta} points in a day (now ${pct}%).`,
      };
    case "swing_down":
      return {
        speak: (name) =>
          `${name}, your ${label} for ${brandName} dropped ${delta} points toward goal in a day — ` +
          `now at ${pct}% of target. Worth a look.`,
        title: "Goal dropped 📉",
        body: `${brandName}: ${label} down ${delta} points in a day (now ${pct}%).`,
      };
    default:
      return {
        speak: (name) =>
          `${name}, an update on your ${label} goal for ${brandName}: ${current} against your ${target} target (${pct}%).`,
        title: "Goal update",
        body: `${brandName}: ${label} at ${pct}% of target.`,
      };
  }
}

/**
 * Snapshot all real brands with active goals and dispatch daily alerts. Returns a
 * small summary for logging/testing.
 */
async function runDailyGoalTracking() {
  const win = monthWindow();
  const today = new Date().toISOString().slice(0, 10);

  // Real brands (never demo/sample data) that actually have active goals, with
  // their owner. Demo brands must never generate real owner alerts.
  const { rows: brands } = await db.query(
    `SELECT DISTINCT b.brand_id, b.brand_name, b.user_id
       FROM brand_goals g
       JOIN brands b ON b.brand_id = g.brand_id
      WHERE g.status = 'active' AND b.is_demo = false`
  );

  let brandsProcessed = 0;
  let alertsSent = 0;

  for (const brand of brands) {
    // Yesterday's percent-to-goal per goal, read BEFORE writing today's snapshot,
    // so momentum (swing) detection compares today against the prior reading.
    const prior = new Map();
    try {
      const { rows } = await db.query(
        `SELECT DISTINCT ON (goal_id) goal_id, percent_to_goal
           FROM goal_snapshots
          WHERE brand_id = $1 AND snapshot_date < CURRENT_DATE
          ORDER BY goal_id, snapshot_date DESC`,
        [brand.brand_id]
      );
      for (const r of rows) {
        prior.set(r.goal_id, r.percent_to_goal == null ? null : Number(r.percent_to_goal));
      }
    } catch (err) {
      console.error(
        `Prior goal snapshot lookup failed for brand ${brand.brand_id}:`,
        err.message
      );
    }

    let goals = [];
    try {
      ({ goals } = await snapshotBrandGoals(brand.brand_id, win));
      brandsProcessed += 1;
    } catch (err) {
      console.error(`Goal snapshot failed for brand ${brand.brand_id}:`, err.message);
      continue;
    }

    for (const goal of goals) {
      const priorPercent = prior.has(goal.goalId) ? prior.get(goal.goalId) : null;
      const kinds = deriveAlertKinds(goal, priorPercent);

      for (const { kind, delta } of kinds) {
        // Atomically CLAIM this (goal, kind, day) before dispatching ANY channel.
        // The unique PK + ON CONFLICT DO NOTHING means only the first tick to
        // reach a given alert wins the claim; overlapping/re-run ticks get no row
        // and skip the whole fan-out, so push/mobile can never be double-sent.
        // This claim is channel-agnostic (independent of the per-user voice dedup
        // key) so push delivery is not coupled to voice-notification settings.
        let claimed = false;
        try {
          const { rowCount } = await db.query(
            `INSERT INTO goal_alert_log (goal_id, kind, alert_date)
               VALUES ($1, $2, CURRENT_DATE)
             ON CONFLICT (goal_id, kind, alert_date) DO NOTHING`,
            [goal.goalId, kind]
          );
          claimed = rowCount > 0;
        } catch (err) {
          console.error(`Goal alert claim failed for goal ${goal.goalId}:`, err.message);
          continue;
        }
        if (!claimed) continue;

        const copy = buildAlertCopy(goal, brand.brand_name, kind, { delta });
        // Voice dedup key backstops the claim above (overlapping voice enqueues).
        const dedupKey = `goal_alert:${goal.goalId}:${kind}:${today}`;

        try {
          await enqueueOwnerVoiceEvent(brand.user_id, "goal_alert", copy.speak, {
            brandId: brand.brand_id,
            title: copy.title,
            dedupKey,
            payload: {
              goalId: goal.goalId,
              metricKey: goal.metricKey,
              status: goal.status,
              kind,
              percentToGoal: goal.percentToGoal,
            },
          });

          // Web + mobile push run best-effort; they fan out exactly once because
          // the claim above already guaranteed this is the only winning tick.
          const pushPayload = {
            title: copy.title,
            body: copy.body,
            data: { type: "goal_alert", brandId: brand.brand_id, goalId: goal.goalId, kind },
          };
          pushController.sendPushToUser(brand.user_id, pushPayload).catch(() => {});
          mobilePushController.sendToUser(brand.user_id, pushPayload).catch(() => {});
          alertsSent += 1;
        } catch (err) {
          console.error(`Goal alert dispatch failed for goal ${goal.goalId}:`, err.message);
        }
      }
    }
  }

  return { brandsProcessed, alertsSent };
}

module.exports = { runDailyGoalTracking, buildAlertCopy, deriveAlertKinds };
