/**
 * Tier configuration — the single source of truth that maps every gated Zorecho
 * feature to the subscription tier required to use it.
 *
 * Tier hierarchy (TIER_RANK): free < starter < pro < enterprise. The retired
 * `growth` tier is mapped to the starter rank so any legacy account keeps at
 * least Starter-level access.
 *
 * The client mirrors the gating-relevant parts of this in
 * `client/src/lib/tiers.js` (keep the two in sync).
 */

const TIER_RANK = {
  free: 0,
  starter: 1,
  growth: 1, // retired tier — treat as Starter-equivalent
  pro: 2,
  enterprise: 3,
};

/**
 * Every gated feature → { name, tier, description }. `name`/`description` feed
 * the 403 upgrade message and the client upgrade prompt; `tier` is the minimum
 * tier required.
 *
 * Starter-tier features (facebook_ads, basic_crm, lead_chatbot, weekly_reports,
 * website_chatbot, email_notifications, social_basic) are included on every paid
 * plan and are not individually gated above Starter — they are listed here for
 * completeness / the feature catalog.
 */
const FEATURES = {
  // --- Starter (baseline) ---
  facebook_ads: { name: "Facebook Ad Automation", tier: "starter", description: "Automated Facebook ad campaign creation and management." },
  basic_crm: { name: "Basic CRM", tier: "starter", description: "Lead capture, scoring, and pipeline tracking." },
  lead_chatbot: { name: "Lead Qualification Chatbot", tier: "starter", description: "AI text chatbot that qualifies and scores leads." },
  weekly_reports: { name: "Weekly Reports", tier: "starter", description: "Automated weekly performance analytics." },
  website_chatbot: { name: "Website Chatbot", tier: "starter", description: "Embeddable lead-capture chat widget for your site." },
  email_notifications: { name: "Email Notifications", tier: "starter", description: "Email alerts for leads and account activity." },
  social_basic: { name: "Social Posting (2 platforms)", tier: "starter", description: "Schedule and publish to up to two social platforms." },

  // --- Professional ---
  voice_chatbot: { name: "Voice Chatbot", tier: "pro", description: "Voice-driven AI conversations with prospects." },
  phone_agent: { name: "AI Phone Agent", tier: "pro", description: "Twilio-powered AI phone agent for inbound and outbound calls." },
  reputation: { name: "Reputation Management", tier: "pro", description: "Fetch reviews and post AI-assisted replies across platforms." },
  sales_scripts: { name: "Sales Script Generator", tier: "pro", description: "AI-generated sales scripts for calls, follow-ups, and meetings." },
  content_calendar: { name: "Content Calendar", tier: "pro", description: "AI-generated month of scheduled social content." },
  social_all: { name: "All 6 Social Platforms", tier: "pro", description: "Connect and post to all six supported social platforms." },
  zapier: { name: "Zapier Integration", tier: "pro", description: "Outbound webhooks to Zapier, Make, Slack, and more." },
  video: { name: "Video Script Generator", tier: "pro", description: "AI video packages: hook, scenes, CTA, and thumbnail." },
  ad_studio: { name: "AI Ad Creative Studio", tier: "pro", description: "AI-generated ad creative packages, one-click launch into Facebook." },
  image_studio: { name: "AI Image Studio", tier: "pro", description: "AI Image Prompt Engineer plus DALL-E generation of on-brand marketing visuals." },
  appointments: { name: "AI Appointment Booking", tier: "pro", description: "AI books appointments for hot leads, syncs Google Calendar, and sends confirmations." },
  followups: { name: "AI Follow-Up Sequences", tier: "pro", description: "Automated multi-step email, SMS, and phone follow-up that runs until a lead responds, books, or converts." },
  sms_marketing: { name: "Two-Way SMS Marketing", tier: "pro", description: "Bulk AI-written SMS campaigns with two-way inbound auto-replies and platform-wide opt-out handling." },
  email_marketing: { name: "AI Email Marketing", tier: "pro", description: "AI-written one-time email blasts and automated drip sequences with open/click tracking and unsubscribe handling." },

  // --- Enterprise ---
  white_label: { name: "White-Label Agency", tier: "enterprise", description: "Resell Zorecho under your own brand and domain." },
  affiliate: { name: "Affiliate Program", tier: "enterprise", description: "Earn commission by referring new Zorecho customers." },
  mobile_api: { name: "Mobile App API", tier: "enterprise", description: "Native iOS/Android backend access (mobile v2 API)." },
  advanced_analytics: { name: "Advanced Analytics", tier: "enterprise", description: "Deeper reporting and ROI analytics." },
  advanced_roi: { name: "Advanced ROI Dashboard", tier: "enterprise", description: "Multi-channel dollar attribution, AI ROI analyst, and weekly ROI snapshot history." },
  customer_intelligence: { name: "Customer Intelligence Engine", tier: "enterprise", description: "An AI brain that studies every channel weekly to build a growing strategic intelligence profile with ranked recommendations and a trajectory score." },
  capital_funding: { name: "Capital & Funding Intelligence", tier: "enterprise", description: "Scout scans grants and funding programs weekly, ranks business opportunities, and Echo drafts complete grant applications from your brand and story." },
  competitor_ad_spy: { name: "Competitor Ad Spy", tier: "enterprise", description: "Scout watches every confirmed competitor's live Facebook ads, alerts you to aggressive new ads, and delivers a weekly ad intelligence report with counter-campaign drafts." },
  competitor_sites: { name: "Competitor Website Analysis", tier: "enterprise", description: "Scout reads competitor websites you add, analyzes their pricing, offers, messaging and CTAs, then monitors them and alerts you to meaningful changes." },
  api_marketplace: { name: "API Marketplace Access", tier: "enterprise", description: "Access the Zorecho API marketplace." },
  feedback: { name: "Customer Feedback & Surveys", tier: "enterprise", description: "AI survey designer and feedback analyst." },
  priority_support: { name: "Priority Support", tier: "enterprise", description: "Priority access to the Zorecho support team." },
};

function tierRank(tier) {
  return TIER_RANK[tier] != null ? TIER_RANK[tier] : 0;
}

/** True when `userTier` is at or above `requiredTier`. */
function meetsTier(userTier, requiredTier) {
  return tierRank(userTier) >= tierRank(requiredTier);
}

/** Resolves a feature key (or a raw tier string) to { name, tier }. */
function resolveRequirement(featureKeyOrTier) {
  const feature = FEATURES[featureKeyOrTier];
  if (feature) return { name: feature.name, tier: feature.tier, description: feature.description };
  // Allow passing a raw tier (e.g. "pro") when no catalog entry is needed.
  return { name: featureKeyOrTier, tier: featureKeyOrTier, description: null };
}

module.exports = { TIER_RANK, FEATURES, tierRank, meetsTier, resolveRequirement };
