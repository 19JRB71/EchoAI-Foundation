/**
 * Guided setup status engine.
 *
 * Computes, for one owner + brand, which features are fully set up and which
 * still have unfinished steps. This powers:
 *  - the per-section guided Setup Guide banners in the client, and
 *  - Echo's "you still haven't finished setting up X" reminders.
 *
 * Every check is a read-only probe against real account state — nothing is
 * ever assumed or fabricated. A probe failure is reported honestly as
 * `status: "unknown"` for that feature (never silently marked done or not
 * done), so a transient DB error can't produce a false reminder.
 */
const db = require("../config/db");

async function exists(sql, params) {
  const { rows } = await db.query(sql, params);
  return rows.length > 0;
}

// The catalog of guided setups. `section` is the client nav key the "take me
// there" button opens. Each feature lists its steps in order; a feature is
// "done" when every step is done. Ordered by how foundational the feature is.
const SETUP_CATALOG = [
  {
    key: "brand",
    label: "Brand profile",
    section: "campaigns",
    async steps(userId, brandId) {
      const { rows } = await db.query(
        `SELECT brand_name, brand_personality, voice_description, target_audience
           FROM brands WHERE brand_id = $1`,
        [brandId]
      );
      const b = rows[0] || {};
      const filled = (v) =>
        v != null && String(typeof v === "object" ? JSON.stringify(v) : v).trim().length > 0;
      return [
        { label: "Name your brand", done: filled(b.brand_name) },
        { label: "Describe your brand personality", done: filled(b.brand_personality) },
        { label: "Describe your brand voice", done: filled(b.voice_description) },
        { label: "Describe your target audience", done: filled(b.target_audience) },
      ];
    },
  },
  {
    key: "facebook",
    label: "Facebook connection",
    section: "settings",
    async steps(userId) {
      const connected = await exists(
        `SELECT 1 FROM api_integrations
          WHERE user_id = $1 AND platform = 'facebook' AND connection_status = 'connected' LIMIT 1`,
        [userId]
      );
      return [
        { label: "Connect Facebook — one login enables ads and posting", done: connected },
      ];
    },
  },
  {
    key: "social",
    label: "Social media accounts",
    section: "social",
    async steps(userId, brandId) {
      // Distinguish "never connected" from "connected but broken": a row with
      // connection_status = 'error' means the owner DID connect an account but
      // it now needs attention — telling them to "connect one" would be
      // confusing and wrong.
      const { rows } = await db.query(
        "SELECT connection_status FROM social_accounts WHERE brand_id = $1",
        [brandId]
      );
      const connected = rows.some((r) => r.connection_status === "connected");
      const hasBroken = !connected && rows.length > 0;
      const posted = await exists(
        "SELECT 1 FROM social_posts WHERE brand_id = $1 LIMIT 1",
        [brandId]
      );
      return [
        {
          label: hasBroken
            ? "Reconnect your social account — it needs attention"
            : "Connect at least one social account",
          done: connected,
        },
        { label: "Schedule your first post", done: posted },
      ];
    },
  },
  {
    key: "contentcalendar",
    label: "Content calendar",
    section: "contentcalendar",
    async steps(userId, brandId) {
      const hasCalendar = await exists(
        "SELECT 1 FROM content_calendars WHERE brand_id = $1 LIMIT 1",
        [brandId]
      );
      return [{ label: "Generate your first 30-day calendar", done: hasCalendar }];
    },
  },
  {
    key: "chatbot",
    label: "Website chatbot",
    section: "chatbot",
    async steps(userId, brandId) {
      const configured = await exists(
        "SELECT 1 FROM chatbot_config WHERE brand_id = $1 LIMIT 1",
        [brandId]
      );
      const hasChats = await exists(
        "SELECT 1 FROM chatbot_sessions WHERE brand_id = $1 LIMIT 1",
        [brandId]
      );
      return [
        { label: "Set up your chatbot", done: configured },
        { label: "Install the widget on your website (first visitor chat)", done: hasChats },
      ];
    },
  },
  {
    key: "appointments",
    label: "Appointment booking",
    section: "appointments",
    async steps(userId, brandId) {
      const hasSchedule = await exists(
        "SELECT 1 FROM availability_schedules WHERE brand_id = $1 LIMIT 1",
        [brandId]
      );
      return [{ label: "Set your weekly availability", done: hasSchedule }];
    },
  },
  {
    key: "phone",
    label: "AI phone agent",
    section: "phone",
    async steps(userId, brandId) {
      const configured = await exists(
        "SELECT 1 FROM twilio_config WHERE brand_id = $1 LIMIT 1",
        [brandId]
      );
      return [{ label: "Connect a phone number (Twilio)", done: configured }];
    },
  },
  {
    key: "sms",
    label: "SMS marketing",
    section: "sms",
    async steps(userId, brandId) {
      const configured = await exists(
        "SELECT 1 FROM twilio_config WHERE brand_id = $1 LIMIT 1",
        [brandId]
      );
      const sent = await exists(
        "SELECT 1 FROM sms_campaigns WHERE brand_id = $1 LIMIT 1",
        [brandId]
      );
      return [
        { label: "Connect a phone number (Twilio)", done: configured },
        { label: "Send your first SMS campaign", done: sent },
      ];
    },
  },
  {
    key: "email",
    label: "Email marketing",
    section: "email",
    async steps(userId, brandId) {
      const sent = await exists(
        "SELECT 1 FROM email_marketing_campaigns WHERE brand_id = $1 LIMIT 1",
        [brandId]
      );
      return [{ label: "Create your first email campaign", done: sent }];
    },
  },
  {
    key: "google",
    label: "Google connection",
    section: "googleseo",
    async steps(userId) {
      const connected = await exists(
        `SELECT 1 FROM google_integrations
          WHERE user_id = $1 AND connection_status = 'connected' LIMIT 1`,
        [userId]
      );
      return [{ label: "Connect your Google account", done: connected }];
    },
  },
  {
    key: "push",
    label: "Lead alerts on your phone",
    section: "settings",
    async steps(userId) {
      const subscribed = await exists(
        "SELECT 1 FROM push_subscriptions WHERE user_id = $1 LIMIT 1",
        [userId]
      );
      return [{ label: "Turn on push notifications", done: subscribed }];
    },
  },
];

const VALID_SETUP_KEYS = new Set(SETUP_CATALOG.map((c) => c.key));

/**
 * Computes the full guided-setup status for a brand. Returns
 * { features: [{ key, label, section, status: "done"|"incomplete"|"unknown",
 *   steps: [{ label, done }] }], doneCount, totalCount } where counts cover
 * only successfully probed features.
 */
async function computeSetupStatus(userId, brandId) {
  const features = [];
  for (const item of SETUP_CATALOG) {
    try {
      const steps = await item.steps(userId, brandId);
      const done = steps.every((s) => s.done);
      features.push({
        key: item.key,
        label: item.label,
        section: item.section,
        status: done ? "done" : "incomplete",
        steps,
      });
    } catch (e) {
      // Honest failure: report the probe error, never guess.
      features.push({
        key: item.key,
        label: item.label,
        section: item.section,
        status: "unknown",
        steps: [],
        error: "Could not check this setup right now.",
      });
    }
  }
  const probed = features.filter((f) => f.status !== "unknown");
  return {
    features,
    doneCount: probed.filter((f) => f.status === "done").length,
    totalCount: probed.length,
  };
}

/**
 * The single most important unfinished setup across the owner's real (non-demo)
 * brands, for Echo's briefing reminder. Returns { key, label, section,
 * brandName, nextStep } or null when everything probed is done (or nothing can
 * be said honestly). Never throws.
 */
async function topIncompleteSetup(userId) {
  try {
    const { rows } = await db.query(
      "SELECT brand_id, brand_name FROM brands WHERE user_id = $1 AND is_demo = false ORDER BY created_at ASC",
      [userId]
    );
    for (const brand of rows) {
      const status = await computeSetupStatus(userId, brand.brand_id);
      const first = status.features.find((f) => f.status === "incomplete");
      if (first) {
        const nextStep = first.steps.find((s) => !s.done);
        return {
          key: first.key,
          label: first.label,
          section: first.section,
          brandName: brand.brand_name,
          nextStep: nextStep ? nextStep.label : null,
        };
      }
    }
    return null;
  } catch (_e) {
    return null;
  }
}

module.exports = { SETUP_CATALOG, VALID_SETUP_KEYS, computeSetupStatus, topIncompleteSetup };
