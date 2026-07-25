// ---------------------------------------------------------------------------
// Spoken tour narration — Echo personally walks a new team member through the
// platform. Each step id maps to a warm, conversational script (addressing the
// owner as "Sir") that introduces the responsible AI team member by name, what
// the tool does, why it matters, and what to do with it.
//
// Variety comes from rotating pools (pickVariant): openings, transitions and
// "ready?" prompts never repeat back-to-back, so replaying the tour doesn't
// sound like a recording. Steps without a script fall back to reading the
// card's title + body, so new tour steps can never break narration.
// ---------------------------------------------------------------------------

import { pickVariant } from "../voice/phraseVariety.js";

// ---- Openings (played once when the tour starts) ---------------------------
const GREETINGS = [
  "Welcome aboard, Sir. I'm Echo, your Marketing Director — and I could not be happier you're here. Let me personally show you around and introduce you to the team.",
  "Sir, it's a genuine pleasure. I'm Echo, your Marketing Director, and this is your new headquarters. Come with me — I'll walk you through everything and introduce the whole team.",
  "Right this way, Sir. I'm Echo — I run your marketing department. Before you dive in, let me give you the grand tour and show you what your new team can do.",
  "Welcome to the team, Sir. I'm Echo, your Marketing Director. Everything here was built to work for you around the clock — let me show you exactly how.",
];

// ---- Transitions between sections ------------------------------------------
const TRANSITIONS = [
  "Right this way, Sir.",
  "Now, let me show you this.",
  "Moving on — you'll like this one.",
  "Next up, Sir.",
  "Over here now.",
  "Now this is one of my favorites.",
  "Follow me, Sir.",
  "On to the next stop.",
];

// ---- "Ready for the next one?" prompts --------------------------------------
const READY_PROMPTS = [
  "Ready to see the next one, Sir?",
  "Shall we move on to the next stop, Sir?",
  "Whenever you're ready, Sir — shall we continue?",
  "Ready to keep going, Sir?",
  "Say yes when you'd like to see the next one, Sir.",
  "Shall I show you what's next, Sir?",
];

// ---- Stop acknowledgements ---------------------------------------------------
const STOP_ACKS = [
  "Of course, Sir. We'll pick the tour back up whenever you like — just tap Take the Tour.",
  "Understood, Sir. The tour will be right here when you want it. Enjoy exploring.",
  "No problem at all, Sir. Come back to the tour any time from the button in the corner.",
  "As you wish, Sir. I'll be here whenever you'd like to continue.",
];

// ---- Per-step scripts --------------------------------------------------------
// Keyed by step id from tourSteps.js. Written to be SPOKEN, not read: shorter
// sentences, contractions, direct address. Team-member intros follow the
// "This is Atlas, your Advertising Manager…" pattern the first time an agent's
// territory comes up.
const STEP_SCRIPTS = {
  // ----- Starter -----
  dashboard:
    "This is your command center, Sir. The three numbers up top — active leads, ad spend, and return on investment — are the pulse of your entire operation. I keep them current for you around the clock. Make this your first stop each morning, and you'll always know exactly how the business is doing.",
  brand:
    "See this selector, Sir? If you run more than one business or location, this is how you switch between them. Every screen — leads, campaigns, content — follows whichever brand you pick here. One team, every business you own.",
  leads:
    "Now, this is Pulse's territory. Pulse is your CRM Manager — every lead your chatbot, your ads, and your phone agent capture lands right here. Pulse scores each one hot, warm, or cold, so you always know exactly who to call first. When you see a hot lead, Sir, don't wait — that's money on the table.",
  campaigns:
    "This is Atlas, your Advertising Manager. Atlas handles all your Facebook and Google campaigns automatically, so you never have to worry about your ads again. Once you connect your ad account, Atlas builds the campaigns, watches them daily, and shifts budget toward whatever's winning. You approve, Atlas executes.",
  chatbot:
    "Meet Voice, your AI Receptionist — well, one half of Voice's job anyway. Drop one small snippet of code on your website, and this chatbot greets every visitor, answers their questions, and qualifies them as leads twenty-four hours a day. The moment a conversation turns hot, Sir, you get an alert.",
  social:
    "This is Nova, your Social Media Manager. Nova writes on-brand posts for every platform and publishes them on schedule, so your feeds stay alive without you lifting a finger. Give Nova a quick review each week, approve the posts you like, and consider social media handled.",
  googleseo:
    "Here's where Scout works — your Research Specialist. Connect Google and Scout pulls in your real search performance, then writes keyword-optimized content designed to climb the rankings. It's the slow, steady engine of free traffic, Sir — and Scout never stops digging.",
  roi:
    "This one matters, Sir — your return on investment. Atlas and I turn everything the team does into a clear picture of the value we're generating: leads, conversions, and revenue impact, tracked week over week. When you wonder whether it's all working, the answer lives right here.",
  settings:
    "And this is Settings — think of it as the back office. Your brand profile, your Facebook and phone connections, billing, and your human team all live here. One tip from me, Sir: run brand discovery in here whenever your business evolves, and the whole team instantly sharpens its voice.",

  // ----- Professional -----
  phone:
    "Now for the other half of Voice's job, Sir — the phone. Voice answers your inbound calls and dials your hot leads automatically: qualifying, booking appointments, and logging every conversation. Connect your phone number in Settings, and you'll never miss another call.",
  adstudio:
    "Back in Atlas's department — this is the Ad Creative Studio. Atlas and Forge, your Creative Director, team up here to produce complete ad packages: image concepts, video scripts, copy variations, audiences, the works. Pick the ones you love, Sir, and launch them straight into your campaigns.",
  contentcalendar:
    "Nova again, Sir — and this is where Nova really shines. One click, and Nova plans an entire month of posts across all your platforms. Activate the calendar and everything publishes itself, right on schedule. You can pause or edit any post, any time.",
  followups:
    "Pulse's follow-up sequences, Sir. No lead ever goes cold on this team's watch. Pulse writes and sends multi-touch follow-ups over email and text, nurturing every lead until they're ready to buy. You close the deals — Pulse keeps them warm.",
  email:
    "Email marketing — another one of Pulse's tools. The campaign writer drafts your subject lines, previews, and the full email itself. Send one-off announcements or set up automated drip sequences, with opens, clicks, and unsubscribes all tracked for you, Sir.",
  sms:
    "And here's text messaging, Sir. Pulse runs two-way text campaigns over your own number — writing the messages, replying to inbound texts automatically, and honoring every opt-out without you thinking about it. Texts get read in minutes; it's a powerful channel.",

  // ----- Enterprise -----
  intelligence:
    "This is where Scout and I collaborate, Sir — your Customer Intelligence engine. Every week we study all your channels and deliver a strategy brief: a trajectory score and five ranked recommendations, each grounded in your real data. It gets sharper every single week.",
  "roi-advanced":
    "Your Enterprise ROI view, Sir — the full financial picture. Every dollar attributed across ads, phone, text, email, and your website, with cost per lead and return for each channel, plus an executive summary written for you. This is boardroom-grade reporting.",
  agency:
    "The white label program, Sir. Resell this entire platform as your own product — your branding, your domain, your pricing. Your clients never see our name. Manage all of it from the agency portal right here.",
  affiliate:
    "Your affiliate program. Share your link, and you earn a commission on every customer you bring in. Referrals, conversions, and payouts are all tracked on this page, Sir.",
  feedback:
    "Customer feedback, Sir. The team designs short surveys and sends them automatically after calls and chats, then analyzes the sentiment and writes you a thirty-day report. It's how you hear what customers really think — without chasing anyone.",
  "enterprise-perks":
    "One more thing, Sir — as an Enterprise member, you have every feature this platform offers, plus priority support. Your plan includes one seat, and you can invite your whole human team from Settings, with extra seats just fifty dollars each per month.",

  // ----- Wrap-up -----
  "section-help":
    "Almost done, Sir. See a little question mark next to any section title? Click it and you'll get a quick explainer of that tool — what it does and a pro tip — right when you need it. Help is never more than one click away.",
  "tour-button":
    "And this button right here is me, Sir — always on call. Click Take the Tour whenever you'd like a refresher, or restart it from Settings any time.",
  finish:
    "And that, Sir, is your team: Atlas on advertising, Nova on social, Pulse on your leads, Voice on the phones, Scout on research, Forge on creative, Sentinel keeping watch — and me, Echo, running the department. Everything you've seen is working for you right now, around the clock. Pick a section and dive in. Welcome aboard, Sir — we're genuinely glad you're here.",

  // ----- Admin -----
  "admin-panel":
    "Welcome to the admin control center, Sir — your view across the entire platform. From here you manage every customer, monitor system health, and oversee agencies and affiliates.",
  "admin-overview":
    "The Overview tab, Sir — platform-wide numbers at a glance. Total customers, active subscriptions, revenue, and growth trends, so you always know how the business itself is performing.",
  "admin-customers":
    "The Customers tab lists every account on the platform. Click any customer to open their detail view — subscription, usage, and billing status, all in one place, Sir.",
  "admin-lock":
    "From a customer's detail view you can lock or unlock their account — handy for past-due situations or manually granting access, Sir.",
  "admin-tier":
    "Need to comp an account or fix a billing edge case? You can override any customer's plan directly from their detail view, and it applies instantly.",
  "admin-whitelabel":
    "The White Label tab is where you create and oversee reseller agencies, Sir — set them up, see their customers, and track the revenue they generate.",
  "admin-affiliates":
    "Affiliates live here: review sign-ups, approve commissions, mark payouts as paid, and suspend bad actors — the whole lifecycle in one tab.",
  "admin-health":
    "Platform Health, Sir. System status and the key operational signals, so you can spot and resolve issues before customers ever feel them.",
  "admin-help":
    "You have full access to every customer feature too, Sir. Look for the question-mark icons throughout the app for a quick explanation of any tool.",
  "admin-finish":
    "That's the admin tour, Sir. Replay it any time from the floating button or Settings. You now have everything you need to run the platform.",
};

/** Opening line when the tour begins. */
export function tourGreeting() {
  return pickVariant("tour.greeting", GREETINGS);
}

/**
 * Spoken narration for a step. First step skips the transition (the greeting
 * already flows into it); unknown ids fall back to the card's title + body so
 * narration can never break when steps are added.
 */
export function narrationForStep(step, index) {
  if (!step) return "";
  const script =
    STEP_SCRIPTS[step.id] ||
    `${step.title ? `${step.title}. ` : ""}${step.body || ""}`.trim();
  if (index === 0) return script;
  return `${pickVariant("tour.transition", TRANSITIONS)} ${script}`;
}

/** The pause-between-sections question. */
export function readyPrompt() {
  return pickVariant("tour.ready", READY_PROMPTS);
}

/** Spoken acknowledgement when the user stops the tour early. */
export function stopAck() {
  return pickVariant("tour.stop", STOP_ACKS);
}
