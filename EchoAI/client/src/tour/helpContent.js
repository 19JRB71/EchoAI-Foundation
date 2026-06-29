// Contextual help shown by the "?" icon next to a section title.
// Keyed by section key. Each entry: { title, what, features[], tip }.

export const HELP_CONTENT = {
  overview: {
    title: "Dashboard",
    what: "Your at-a-glance view of how every campaign and channel is performing right now.",
    features: [
      "Headline metrics: active leads, ad spend, and estimated ROI",
      "Recent activity across all your channels",
      "Quick links to the tools you use most",
    ],
    tip: "Check the dashboard first each morning to spot what needs your attention.",
  },
  leads: {
    title: "Leads",
    what: "Every lead captured by your chatbot, ads, and phone agent, automatically scored by intent.",
    features: [
      "Hot / warm / cold temperature scoring",
      "Full conversation history per lead",
      "Filter to focus on your hottest prospects",
    ],
    tip: "Call hot leads within minutes — speed-to-lead is the single biggest driver of conversions.",
  },
  campaigns: {
    title: "Facebook Campaigns",
    what: "Automated ad campaigns that EchoAI builds, launches, and optimizes for you.",
    features: [
      "AI targeting and creative selection",
      "Weekly budget shifts toward top performers",
      "Real performance metrics from your ad account",
    ],
    tip: "Connect a Facebook ad account in Settings to let the AI start optimizing.",
  },
  social: {
    title: "Social Media",
    what: "Generate on-brand posts and schedule them to publish automatically.",
    features: [
      "AI content tailored to each platform",
      "Schedule ahead and auto-publish",
      "Connect your accounts for direct posting",
    ],
    tip: "Batch a week of posts at once to keep your feeds active without daily effort.",
  },
  googleseo: {
    title: "Google & SEO",
    what: "Connect Google for real data and generate SEO content that ranks.",
    features: [
      "Google Business, Ads, and Analytics insights",
      "Keyword research and content generation",
      "SEO scoring on every piece you create",
    ],
    tip: "Target long-tail keywords first — they're easier to rank for and convert well.",
  },
  roi: {
    title: "ROI Dashboard",
    what: "Turns your activity into a clear estimate of the value EchoAI is generating.",
    features: [
      "Lead, conversion, and revenue impact estimates",
      "Week-over-week tracking",
      "Enterprise: full multi-channel dollar attribution",
    ],
    tip: "Watch the trend, not a single week — momentum is what matters.",
  },
  chatbot: {
    title: "Website Chatbot",
    what: "A 24/7 AI assistant that qualifies visitors and captures leads on your site.",
    features: [
      "One-snippet embeddable widget",
      "Auto-qualifies and answers questions",
      "Hot-lead alerts the moment intent spikes",
    ],
    tip: "Add the widget to your highest-traffic page first for the biggest lift.",
  },
  adstudio: {
    title: "Ad Creative Studio",
    what: "AI-generated ad creative packages ready to launch.",
    features: [
      "Image concepts, video scripts, and copy variations",
      "Suggested audiences and placements",
      "One-click launch into Facebook campaigns",
    ],
    tip: "Test two very different concepts at once to learn what your audience responds to.",
  },
  image: {
    title: "Image Studio",
    what: "On-brand AI imagery designed around your style guide.",
    features: [
      "AI prompt engineer designs detailed prompts",
      "Multiple variations per concept",
      "Sized for every platform and purpose",
    ],
    tip: "Set up your brand style guide first so every image stays on-brand.",
  },
  contentcalendar: {
    title: "Content Calendar",
    what: "A full month of social content planned and auto-published in one click.",
    features: [
      "AI plans posts by frequency, platform, and theme",
      "Activate to auto-publish on schedule",
      "Edit or pause any post anytime",
    ],
    tip: "Review the generated calendar before activating to fine-tune the messaging.",
  },
  video: {
    title: "Video Content",
    what: "Complete AI video packages — hook, scenes, CTA, and thumbnail.",
    features: [
      "Platform-specific scripts and pacing",
      "Hook and call-to-action suggestions",
      "Saved scripts you can reuse and edit",
    ],
    tip: "Lead with a strong 3-second hook — it decides whether viewers keep watching.",
  },
  followups: {
    title: "Follow-Up Sequences",
    what: "Automated multi-touch nurture that keeps leads warm until they convert.",
    features: [
      "AI-written email and SMS sequences",
      "Triggered automatically per lead",
      "Stops when a lead converts or opts out",
    ],
    tip: "Most sales happen after several touches — let the sequence do the persistent follow-up.",
  },
  phone: {
    title: "AI Phone Agent",
    what: "An AI voice agent that answers inbound calls and dials hot leads.",
    features: [
      "Qualifies, books, and logs every call",
      "Inbound answering and outbound dialing",
      "Powered by your own Twilio number",
    ],
    tip: "Connect Twilio in Settings, then point your number's voice webhook at EchoAI.",
  },
  appointments: {
    title: "Appointments",
    what: "AI-driven booking that fills your calendar from your real availability.",
    features: [
      "Set availability and block-out times",
      "Open-slot calculation for leads",
      "Bookings created automatically",
    ],
    tip: "Keep your availability current so the AI never books a slot you can't make.",
  },
  reputation: {
    title: "Reputation",
    what: "Monitor and respond to reviews across Google and Facebook.",
    features: [
      "Pulls in reviews automatically",
      "AI-drafted, on-brand reply suggestions",
      "Respond without leaving EchoAI",
    ],
    tip: "Reply to every review — responsiveness is what future customers notice most.",
  },
  zapier: {
    title: "Zapier & Webhooks",
    what: "Send EchoAI events to thousands of other apps via outbound webhooks.",
    features: [
      "Fire events like new-lead to any endpoint",
      "Secure, retrying delivery",
      "Per-attempt delivery logs",
    ],
    tip: "Pipe new hot leads straight into your CRM or Slack for instant visibility.",
  },
  sales: {
    title: "Sales Scripts",
    what: "AI-generated sales scripts tailored to your offer and audience.",
    features: [
      "Scripts by sale type and persona",
      "Objection handling built in",
      "Save and refine your best performers",
    ],
    tip: "Feed in the objections you hear most so the script answers them up front.",
  },
  email: {
    title: "Email Marketing",
    what: "AI email campaigns and automated drip sequences.",
    features: [
      "Subject-line variations, preview, and HTML",
      "One-off blasts or multi-step drips",
      "Open, click, and unsubscribe tracking",
    ],
    tip: "Segment your list — targeted emails far outperform one-size-fits-all blasts.",
  },
  sms: {
    title: "SMS Marketing",
    what: "Two-way text campaigns over your own number.",
    features: [
      "AI-written message variations",
      "Automatic replies to inbound texts",
      "STOP/START opt-outs honored automatically",
    ],
    tip: "Keep texts short and personal — SMS is the most immediate channel you have.",
  },
  intelligence: {
    title: "Customer Intelligence",
    what: "A weekly AI strategic brief synthesized from every channel.",
    features: [
      "Trajectory score and executive analysis",
      "Five ranked, data-grounded recommendations",
      "Trends and continuity tracked week over week",
    ],
    tip: "Apply one recommendation each week and log the outcome — the engine learns from it.",
  },
  affiliate: {
    title: "Affiliate Program",
    what: "Earn commission by referring new customers to EchoAI.",
    features: [
      "Your personal referral link",
      "Referral and conversion tracking",
      "Request payouts when you're ready",
    ],
    tip: "Share your link where your audience already trusts your recommendations.",
  },
  agency: {
    title: "White Label",
    what: "Resell EchoAI as your own branded product.",
    features: [
      "Your branding, domain, and pricing",
      "Manage your own customers",
      "Track the revenue you generate",
    ],
    tip: "Set your prices with room above your EchoAI cost to build a healthy margin.",
  },
  feedback: {
    title: "Customer Feedback",
    what: "AI surveys and sentiment analysis to hear what customers really think.",
    features: [
      "AI-designed short surveys",
      "Auto-sent after calls and chats",
      "Sentiment scoring and a 30-day report",
    ],
    tip: "Act on a recurring theme quickly — fixing it visibly builds loyalty.",
  },
  settings: {
    title: "Settings",
    what: "Manage your brand, connections, billing, team, and the product tour.",
    features: [
      "Brand profile and discovery",
      "Facebook and Twilio connections",
      "Billing, team seats, and Tour & Help",
    ],
    tip: "Re-run brand discovery whenever your positioning changes to keep the AI on-voice.",
  },
};

export function helpFor(sectionKey) {
  return HELP_CONTENT[sectionKey] || null;
}
