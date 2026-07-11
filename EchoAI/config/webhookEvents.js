/**
 * Catalog of Zorecho outbound webhook (Zapier) trigger events.
 *
 * This is the single source of truth for the event names a brand can subscribe a
 * webhook to. The internal triggerWebhook() validates against these keys, and the
 * dashboard's "Add Webhook" dropdown mirrors the same list.
 *
 * Events that Zorecho currently emits automatically are wired into the relevant
 * controllers (see triggerWebhook callers). The remaining events are available to
 * subscribe to and will fire as their producing flows are wired up.
 */

const WEBHOOK_EVENTS = [
  { key: "new_lead_created", label: "New lead created" },
  { key: "lead_temperature_hot", label: "Lead temperature changed to hot" },
  { key: "new_campaign_created", label: "New campaign created" },
  { key: "campaign_performance_updated", label: "Campaign performance updated (weekly)" },
  { key: "new_review_received", label: "New review received" },
  { key: "review_response_posted", label: "Review response posted" },
  { key: "sales_script_generated", label: "Sales script generated" },
  { key: "social_post_published", label: "Social media post published" },
  { key: "weekly_report_generated", label: "Weekly report generated" },
  { key: "inbound_call_received", label: "Inbound call received" },
  { key: "outbound_call_completed", label: "Outbound call completed" },
];

const WEBHOOK_EVENT_KEYS = WEBHOOK_EVENTS.map((e) => e.key);

function isValidEvent(eventName) {
  return WEBHOOK_EVENT_KEYS.includes(eventName);
}

module.exports = { WEBHOOK_EVENTS, WEBHOOK_EVENT_KEYS, isValidEvent };
