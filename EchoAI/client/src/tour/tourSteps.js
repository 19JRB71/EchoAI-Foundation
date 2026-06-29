// Tier-aware tour sequences.
//
// Each step is { id, section?, target?, title, body, placement? }:
//   - section : sidebar section key to navigate to BEFORE showing the step, so the
//               highlighted element is on screen and feels like a real walkthrough.
//   - target  : the `data-tour="<value>"` attribute the spotlight points at. When the
//               element isn't on the page, TourEngine shows a centered card instead
//               (never breaks the tour).
//   - placement : preferred tooltip side ("right"|"left"|"top"|"bottom"|"center").
//
// Tours are composed so the wrap-up beats are always last:
//   starter    = STARTER(9) + WRAP_UP(3)                       = 12 steps
//   pro        = STARTER(9) + PRO_EXTRA(6) + WRAP_UP(3)        = 18 steps
//   enterprise = STARTER(9) + PRO_EXTRA(6) + ENT_EXTRA(6) + WRAP_UP(3) = 24 steps
//   admin      = ADMIN(10)                                     = 10 steps

import { meetsTier } from "../lib/tiers.js";

// ---- Starter feature steps (every paid plan) -------------------------------
const STARTER_STEPS = [
  {
    id: "dashboard",
    section: "overview",
    target: "nav-overview",
    title: "Your command center",
    body: "This is your dashboard. The three headline metrics — active leads, ad spend, and ROI — give you the pulse of every campaign at a glance. Check here first each day to see what's working.",
    placement: "right",
  },
  {
    id: "brand",
    section: "overview",
    target: "brand-selector",
    title: "Switch between businesses",
    body: "Manage more than one business or location? Use the brand selector to switch context. Every section — leads, campaigns, content — is scoped to the brand you pick here.",
    placement: "bottom",
  },
  {
    id: "leads",
    section: "leads",
    target: "nav-leads",
    title: "Your lead inbox",
    body: "Every lead your chatbot, ads, and phone agent capture lands here. Leads are auto-scored hot, warm, or cold so you always know who to call first. Click any lead for the full conversation history.",
    placement: "right",
  },
  {
    id: "campaigns",
    section: "campaigns",
    target: "nav-campaigns",
    title: "Automated Facebook ads",
    body: "EchoAI builds, launches, and optimizes your Facebook ad campaigns automatically. Connect an ad account and the AI handles targeting and weekly budget shifts toward your best performers.",
    placement: "right",
  },
  {
    id: "chatbot",
    section: "chatbot",
    target: "nav-chatbot",
    title: "Website chatbot widget",
    body: "Drop one snippet of code on your site and a 24/7 AI chatbot qualifies visitors, answers questions, and captures leads. It alerts you the moment a conversation turns into a hot lead.",
    placement: "right",
  },
  {
    id: "social",
    section: "social",
    target: "nav-social",
    title: "Social media on autopilot",
    body: "Generate on-brand posts for every platform and schedule them ahead of time. EchoAI publishes automatically at the times you choose, so your feeds stay active without the daily grind.",
    placement: "right",
  },
  {
    id: "googleseo",
    section: "googleseo",
    target: "nav-googleseo",
    title: "Google & SEO tools",
    body: "Connect Google to pull in real performance data, then use the SEO writer to generate keyword-optimized content that ranks. Great for steadily growing free, organic traffic.",
    placement: "right",
  },
  {
    id: "roi",
    section: "roi",
    target: "nav-roi",
    title: "See your return",
    body: "The ROI dashboard turns all your activity into a clear estimate of the value EchoAI is generating — leads, conversions, and revenue impact — tracked week over week.",
    placement: "right",
  },
  {
    id: "settings",
    section: "settings",
    target: "nav-settings",
    title: "Settings & connections",
    body: "Manage your brand profile, connect Facebook and Twilio, handle billing, and invite your team — all from Settings. Run brand discovery here any time to sharpen the AI's voice.",
    placement: "right",
  },
];

// ---- Professional feature steps --------------------------------------------
const PRO_EXTRA_STEPS = [
  {
    id: "phone",
    section: "phone",
    target: "nav-phone",
    title: "AI phone agent",
    body: "Your AI agent answers inbound calls and dials hot leads automatically — qualifying, booking, and logging every call. Connect your Twilio number in Settings to put it to work.",
    placement: "right",
  },
  {
    id: "adstudio",
    section: "adstudio",
    target: "nav-adstudio",
    title: "Ad creative studio",
    body: "Generate five complete ad creative packages per brand — image concepts, video scripts, copy variations, audiences, and placements. Launch the winners straight into your Facebook campaigns.",
    placement: "right",
  },
  {
    id: "contentcalendar",
    section: "contentcalendar",
    target: "nav-contentcalendar",
    title: "Content calendar",
    body: "Let the AI plan a full month of social posts across your platforms in one click. Activate the calendar and EchoAI auto-publishes everything on schedule — pause or edit any post any time.",
    placement: "right",
  },
  {
    id: "followups",
    section: "followups",
    target: "nav-followups",
    title: "Follow-up sequences",
    body: "Never let a lead go cold. EchoAI writes and sends multi-touch follow-up sequences over email and SMS, nurturing each lead until they're ready to buy.",
    placement: "right",
  },
  {
    id: "email",
    section: "email",
    target: "nav-email",
    title: "Email marketing",
    body: "The AI Email Campaign Writer drafts subject-line variations, previews, and full HTML. Send one-off blasts or design automated drip sequences — with opens, clicks, and unsubscribes all tracked.",
    placement: "right",
  },
  {
    id: "sms",
    section: "sms",
    target: "nav-sms",
    title: "SMS marketing",
    body: "Run two-way text campaigns over your own number. The AI writes message variations and auto-replies to inbound texts, while STOP/START opt-outs are honored automatically.",
    placement: "right",
  },
];

// ---- Enterprise feature steps ----------------------------------------------
const ENT_EXTRA_STEPS = [
  {
    id: "intelligence",
    section: "intelligence",
    target: "nav-intelligence",
    title: "Customer intelligence engine",
    body: "An AI strategist studies every channel and delivers a growing weekly intelligence brief — a trajectory score plus five ranked, data-grounded recommendations. It gets sharper every week.",
    placement: "right",
  },
  {
    id: "roi-advanced",
    section: "roi",
    target: "nav-roi",
    title: "Revenue attribution",
    body: "Your Enterprise ROI view adds full multi-channel dollar attribution — ads, phone, SMS, email, and website — with cost-per-lead and ROI per channel, plus an AI-written executive summary.",
    placement: "right",
  },
  {
    id: "agency",
    section: "agency",
    target: "nav-agency",
    title: "White label",
    body: "Resell EchoAI as your own product. Apply your branding, domain, and pricing, then manage your customers and revenue from the agency portal — your clients never see EchoAI.",
    placement: "right",
  },
  {
    id: "affiliate",
    section: "affiliate",
    target: "nav-affiliate",
    title: "Affiliate program",
    body: "Earn by referring others. Share your link and collect commission on every customer you bring in — track referrals, conversions, and payouts right here.",
    placement: "right",
  },
  {
    id: "feedback",
    section: "feedback",
    target: "nav-feedback",
    title: "Customer feedback",
    body: "The AI Survey Designer builds short surveys sent automatically after calls and chats, then the Feedback Analyst scores sentiment and writes a 30-day report so you can act on what customers really think.",
    placement: "right",
  },
  {
    id: "enterprise-perks",
    target: null,
    title: "Unlimited seats & priority support",
    body: "Enterprise unlocks unlimited team seats, priority support, and every feature EchoAI offers. Invite your whole team from Settings — there's no per-seat ceiling on your plan.",
    placement: "center",
  },
];

// ---- Wrap-up beats (shown at the end of every customer tour) ----------------
const WRAP_UP_STEPS = [
  {
    id: "section-help",
    target: "section-help",
    title: "Help is always one click away",
    body: "See a question-mark icon next to a section title? Click it for a quick explainer of what that tool does, its key features, and a pro tip — right when you need it.",
    placement: "bottom",
  },
  {
    id: "tour-button",
    target: "tour-help-button",
    title: "Replay the tour anytime",
    body: "This floating button is always here. Click \"Take the Tour\" whenever you want a refresher, or restart it from Settings → Tour & Help.",
    placement: "left",
  },
  {
    id: "finish",
    target: null,
    title: "You're ready to grow",
    body: "That's the tour! Everything you've seen is ready to use now. Pick a section from the sidebar to dive in — and remember, EchoAI is working for your business around the clock.",
    placement: "center",
  },
];

// ---- Admin tour ------------------------------------------------------------
const ADMIN_STEPS = [
  {
    id: "admin-panel",
    section: "admin",
    target: "nav-admin",
    title: "The admin control center",
    body: "Welcome to the admin panel — your view across the entire platform. From here you manage every customer, monitor health, and oversee agencies and affiliates.",
    placement: "right",
  },
  {
    id: "admin-overview",
    section: "admin",
    target: "admin-overview",
    title: "Platform stats",
    body: "The Overview tab shows platform-wide metrics — total customers, active subscriptions, revenue, and growth trends — so you always know how the business is performing.",
    placement: "bottom",
  },
  {
    id: "admin-customers",
    section: "admin",
    target: "admin-customers",
    title: "Customer management",
    body: "The Customers tab lists every account. Click any customer to open their detail view, where you can inspect their subscription, usage, and billing status.",
    placement: "bottom",
  },
  {
    id: "admin-lock",
    section: "admin",
    target: "admin-customers",
    title: "Lock & unlock accounts",
    body: "From a customer's detail view you can lock or unlock their account and adjust their tier — useful for handling past-due accounts or manually granting access.",
    placement: "bottom",
  },
  {
    id: "admin-tier",
    section: "admin",
    target: "admin-customers",
    title: "Change a customer's tier",
    body: "Need to comp an account or fix a billing edge case? You can override any customer's subscription tier directly from their detail view — changes apply instantly.",
    placement: "bottom",
  },
  {
    id: "admin-whitelabel",
    section: "admin",
    target: "admin-whitelabel",
    title: "Agency management",
    body: "The White Label tab is where you create and oversee reseller agencies — set them up, see their customers, and track the revenue they generate on the platform.",
    placement: "bottom",
  },
  {
    id: "admin-affiliates",
    section: "admin",
    target: "admin-affiliates",
    title: "Affiliate management",
    body: "Review affiliate sign-ups, approve commissions, mark payouts as paid, and suspend bad actors — the full affiliate lifecycle lives in the Affiliates tab.",
    placement: "bottom",
  },
  {
    id: "admin-health",
    section: "admin",
    target: "admin-health",
    title: "Platform health",
    body: "The Platform Health tab surfaces system status and key operational signals so you can spot and resolve issues before they affect customers.",
    placement: "bottom",
  },
  {
    id: "admin-help",
    target: "section-help",
    title: "Contextual help everywhere",
    body: "As an admin you have full access to every customer feature too. Look for the question-mark help icons throughout the app for quick explanations of any tool.",
    placement: "bottom",
  },
  {
    id: "admin-finish",
    target: null,
    title: "You're all set",
    body: "That's the admin tour. You can replay it anytime from the floating button or Settings → Tour & Help. You now have everything you need to run the platform.",
    placement: "center",
  },
];

// Map a user's tier to the customer tour type they should see.
export function tourTypeForTier(tier) {
  if (meetsTier(tier, "enterprise")) return "enterprise";
  if (meetsTier(tier, "pro")) return "pro";
  return "starter";
}

// Build the ordered step list for a tour type.
export function buildTour(tourType) {
  if (tourType === "admin") return ADMIN_STEPS;
  if (tourType === "enterprise")
    return [...STARTER_STEPS, ...PRO_EXTRA_STEPS, ...ENT_EXTRA_STEPS, ...WRAP_UP_STEPS];
  if (tourType === "pro")
    return [...STARTER_STEPS, ...PRO_EXTRA_STEPS, ...WRAP_UP_STEPS];
  return [...STARTER_STEPS, ...WRAP_UP_STEPS];
}
