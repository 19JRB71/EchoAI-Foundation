/**
 * Shared priority classification for Echo's notification badge system.
 *
 * Every spoken/queued event in `echo_voice_notifications` is mapped to one of
 * three visual priorities used by the brand-tab badges and the notification
 * panel:
 *   - "red"    urgent — needs immediate attention (hot leads, budget/campaign
 *              emergencies, critical system/competitor threats).
 *   - "yellow" important — worth reviewing soon (Sage intelligence, warm-lead
 *              follow-ups, approvals/reminders/appointments, campaign updates).
 *   - "green"  informational — FYI (auto-fixed issues, daily/weekly summaries).
 *
 * The map is the single server-side source of truth. A notification may override
 * its derived priority by setting `payload.priority` to a valid value (e.g. a
 * genuinely critical health issue can escalate to "red").
 */
const PRIORITY_RED = "red";
const PRIORITY_YELLOW = "yellow";
const PRIORITY_GREEN = "green";

const PRIORITY_RANK = { red: 0, yellow: 1, green: 2 };

// event_type (config/echoVoice EVENT_TYPES) -> visual priority.
const EVENT_PRIORITY = {
  // RED — urgent, immediate attention.
  hot_lead: PRIORITY_RED,
  autonomous_hot_lead: PRIORITY_RED,
  budget_low: PRIORITY_RED,
  competitor_ad_threat: PRIORITY_RED,

  // YELLOW — important, review soon.
  sage_urgent: PRIORITY_YELLOW,
  goal_alert: PRIORITY_YELLOW,
  rep_completed: PRIORITY_YELLOW,
  email_alert: PRIORITY_YELLOW,
  followup_due: PRIORITY_YELLOW,
  appointment_15m: PRIORITY_YELLOW,
  appointment_5m: PRIORITY_YELLOW,
  task_alert: PRIORITY_YELLOW,
  task_checkin: PRIORITY_YELLOW,
  personal_reminder: PRIORITY_YELLOW,

  // GREEN — informational.
  sentinel_fixed: PRIORITY_GREEN,
  day_summary: PRIORITY_GREEN,
  morning_briefing: PRIORITY_GREEN,
};

/**
 * Resolve the visual priority for a notification. A valid `payload.priority`
 * always wins (lets a caller escalate/de-escalate a specific alert); otherwise
 * the event-type map decides; unknown event types default to "yellow" so a new
 * event still surfaces on the badge rather than silently vanishing.
 */
function priorityForEvent(eventType, payload) {
  const override =
    payload && typeof payload === "object" ? payload.priority : null;
  if (override && Object.prototype.hasOwnProperty.call(PRIORITY_RANK, override)) {
    return override;
  }
  return EVENT_PRIORITY[eventType] || PRIORITY_YELLOW;
}

/**
 * A SQL `CASE` expression that yields the priority rank (0=red,1=yellow,2=green)
 * for an `event_type` column, honoring a `payload->>'priority'` override. Used to
 * order pending alerts red-first. `col` is the event_type column reference and
 * `payloadCol` the jsonb payload column reference.
 */
function priorityRankSql(col = "event_type", payloadCol = "payload") {
  const overrideCases = Object.entries(PRIORITY_RANK)
    .map(([p, rank]) => `WHEN ${payloadCol}->>'priority' = '${p}' THEN ${rank}`)
    .join("\n           ");
  const eventCases = Object.entries(EVENT_PRIORITY)
    .map(([evt, p]) => `WHEN ${col} = '${evt}' THEN ${PRIORITY_RANK[p]}`)
    .join("\n           ");
  return `CASE
           ${overrideCases}
           ${eventCases}
           ELSE 1
         END`;
}

module.exports = {
  PRIORITY_RED,
  PRIORITY_YELLOW,
  PRIORITY_GREEN,
  PRIORITY_RANK,
  EVENT_PRIORITY,
  priorityForEvent,
  priorityRankSql,
};
