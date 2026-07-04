import { useState, useEffect } from "react";
import { useBranding } from "../lib/BrandingContext.jsx";
import {
  requiredTierForSection,
  tierForSection,
  meetsTier,
  tierName,
  tierRank,
  accentColor,
} from "../lib/tiers.js";

// Dark text reads better on the gold (enterprise) accent; white on blue/purple.
function onAccentText(tier) {
  return tier === "enterprise" ? "#1c1500" : "#ffffff";
}

// Full tier label for the pill shown next to each tiered nav item.
function tierPillLabel(tier) {
  if (tier === "enterprise") return "ENT";
  if (tier === "pro") return "PRO";
  if (tier === "starter") return "STARTER";
  return "";
}

// Bold tier pill next to an item label: STARTER (blue), PRO (purple), ENT (gold).
// When the row is active it sits on a solid accent background, so the pill flips
// to a white chip with accent-colored text to stay legible. A lock glyph is
// added when the user's plan can't access the item yet.
function TierPill({ tier, active = false, locked = false }) {
  const color = accentColor(tier);
  const style = active
    ? { backgroundColor: "#ffffff", color }
    : { backgroundColor: color, color: onAccentText(tier) };
  return (
    <span
      className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold leading-none tracking-wide"
      style={style}
    >
      {locked && (
        <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 0h10.5a2.25 2.25 0 012.25 2.25v6.75a2.25 2.25 0 01-2.25 2.25H6.75a2.25 2.25 0 01-2.25-2.25v-6.75a2.25 2.25 0 012.25-2.25z"
          />
        </svg>
      )}
      {tierPillLabel(tier)}
    </span>
  );
}

// Five collapsible navigation groups. The color coding + tier pill for each item
// is derived from tierForSection() (which mirrors the backend feature catalog);
// lock state is driven separately by SECTION_GATES.
const NAV_GROUPS = [
  {
    key: "command",
    label: "Command Center",
    icon: "g-command",
    alwaysOpen: true,
    items: [
      { key: "missioncontrol", label: "Mission Control", icon: "missioncontrol" },
      { key: "aiteam", label: "AI Team", icon: "aiteam" },
    ],
  },
  {
    key: "overview",
    label: "Overview",
    icon: "g-overview",
    alwaysOpen: true,
    items: [
      { key: "overview", label: "Dashboard", icon: "overview" },
      { key: "leads", label: "Leads", icon: "leads" },
    ],
  },
  {
    key: "marketing",
    label: "Marketing",
    icon: "g-marketing",
    items: [
      { key: "campaigns", label: "Campaigns", icon: "campaigns" },
      { key: "adstudio", label: "Ad Studio", icon: "adstudio" },
      { key: "social", label: "Social Media", icon: "social" },
      { key: "contentcalendar", label: "Content Calendar", icon: "contentcalendar" },
      { key: "email", label: "Email Marketing", icon: "email" },
      { key: "sms", label: "SMS Marketing", icon: "sms" },
      { key: "video", label: "Video Content", icon: "video" },
      { key: "followups", label: "Follow-Up Sequences", icon: "followups" },
    ],
  },
  {
    key: "customer",
    label: "Customer Management",
    icon: "g-customer",
    items: [
      { key: "phone", label: "Phone Agent", icon: "phone" },
      { key: "chatbot", label: "Website Chatbot", icon: "chatbot" },
      { key: "appointments", label: "Appointments", icon: "appointments" },
      { key: "reputation", label: "Reputation", icon: "reputation" },
      { key: "feedback", label: "Feedback", icon: "feedback" },
      { key: "zapier", label: "Zapier", icon: "zapier" },
    ],
  },
  {
    key: "content",
    label: "Content & Tools",
    icon: "g-content",
    items: [
      { key: "sales", label: "Sales Scripts", icon: "sales" },
      { key: "image", label: "Image Studio", icon: "image" },
      { key: "googleseo", label: "Google & SEO", icon: "googleseo" },
    ],
  },
  {
    key: "business",
    label: "Business",
    icon: "g-business",
    items: [
      { key: "roi", label: "ROI Dashboard", icon: "roi" },
      { key: "intelligence", label: "Intelligence Engine", icon: "intelligence" },
      { key: "affiliate", label: "Affiliate Program", icon: "affiliate" },
      { key: "agency", label: "White Label", icon: "whitelabel" },
      { key: "settings", label: "Settings", icon: "settings" },
    ],
  },
];

// Which group contains a given section key (for force-expanding the active group).
function groupKeyForSection(sectionKey) {
  for (const g of NAV_GROUPS) {
    if (g.items.some((it) => it.key === sectionKey)) return g.key;
  }
  return null;
}

// The accent tier ('starter'|'pro'|'enterprise') for a section — re-exported from
// the shared tier catalog (which mirrors the backend) so the sidebar and App.jsx
// (which tints the main content area) share one source of truth.
export function accentTierForSection(sectionKey) {
  return tierForSection(sectionKey);
}

function NavIcon({ name }) {
  const common = {
    className: "h-5 w-5 shrink-0",
    fill: "none",
    viewBox: "0 0 24 24",
    strokeWidth: 1.8,
    stroke: "currentColor",
  };
  switch (name) {
    case "missioncontrol":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 21a9 9 0 100-18 9 9 0 000 18zm0 0v-4.5m0-9V3m9 9h-4.5m-9 0H3m14.25 0a5.25 5.25 0 11-10.5 0 5.25 5.25 0 0110.5 0z"
          />
        </svg>
      );
    case "aiteam":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
          />
        </svg>
      );
    case "g-command":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z"
          />
        </svg>
      );
    case "overview":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25A2.25 2.25 0 018.25 10.5H6A2.25 2.25 0 013.75 8.25V6zm0 9.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zm9.75-9.75A2.25 2.25 0 0115.75 3.75H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zm0 9.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
          />
        </svg>
      );
    case "leads":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
          />
        </svg>
      );
    case "campaigns":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46"
          />
        </svg>
      );
    case "adstudio":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
          />
        </svg>
      );
    case "feedback":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
          />
        </svg>
      );
    case "social":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z"
          />
        </svg>
      );
    case "video":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"
          />
        </svg>
      );
    case "sales":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
          />
        </svg>
      );
    case "email":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
          />
        </svg>
      );
    case "sms":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
          />
        </svg>
      );
    case "image":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
          />
        </svg>
      );
    case "googleseo":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>
      );
    case "roi":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 18L9 11.25l3.75 3.75L21.75 6M21.75 6h-4.5m4.5 0v4.5"
          />
        </svg>
      );
    case "reputation":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
          />
        </svg>
      );
    case "phone":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
          />
        </svg>
      );
    case "appointments":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z"
          />
        </svg>
      );
    case "followups":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
          />
        </svg>
      );
    case "chatbot":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
          />
        </svg>
      );
    case "zapier":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
      );
    case "affiliate":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 8.25v13m0-13a2.25 2.25 0 01-2.25-2.25c0-1.86 1.5-3 3.375-3S16.5 4.14 16.5 6m-4.5 2.25H6.75A2.25 2.25 0 014.5 6V5.25A2.25 2.25 0 016.75 3h10.5A2.25 2.25 0 0119.5 5.25V6a2.25 2.25 0 01-2.25 2.25m-5.25 0a2.25 2.25 0 002.25-2.25c0-1.86-1.5-3-3.375-3M5.25 8.25v9.75A2.25 2.25 0 007.5 20.25h9a2.25 2.25 0 002.25-2.25V8.25"
          />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      );
    case "admin":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z"
          />
        </svg>
      );
    case "contentcalendar":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5M8.25 12.75h7.5M8.25 15.75h4.5"
          />
        </svg>
      );
    case "whitelabel":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
        </svg>
      );
    case "g-overview":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75"
          />
        </svg>
      );
    case "g-marketing":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73"
          />
        </svg>
      );
    case "g-customer":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
          />
        </svg>
      );
    case "g-content":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42"
          />
        </svg>
      );
    case "g-business":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
          />
        </svg>
      );
    case "intelligence":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
          />
        </svg>
      );
    default:
      return null;
  }
}

const LS_KEY = "echoai.sidebarGroups";

// Resolve lock state for an item given the user's tier. Agency owners are never
// locked out of White Label even if their plan rank is below enterprise.
function isItemLocked(itemKey, { tier, isAgencyOwner }) {
  if (itemKey === "agency" && isAgencyOwner) return false;
  const reqTier = requiredTierForSection(itemKey);
  return Boolean(reqTier && tier != null && !meetsTier(tier, reqTier));
}

// Count of items in a group currently locked for this user (group header hint).
function groupLockCount(group, ctx) {
  return group.items.filter((it) => isItemLocked(it.key, ctx)).length;
}

// Highest required tier among a group's locked items — drives the tier color of
// the group header's "N locked" chip (purple for pro-locked, gold for ent-locked).
function groupLockTier(group, ctx) {
  let best = null;
  for (const it of group.items) {
    if (!isItemLocked(it.key, ctx)) continue;
    const t = requiredTierForSection(it.key);
    if (!best || tierRank(t) > tierRank(best)) best = t;
  }
  return best;
}

// A single nav row (shared by desktop list and mobile slide-up panel). Every item
// gets a bright accent icon + label and a tier pill matching its backend tier; the
// active item gets a full solid accent background with high-contrast text.
function NavRow({ item, active, locked, onSelect }) {
  const accentTier = tierForSection(item.key) || "starter"; // every nav item is tiered
  const accent = accentColor(accentTier);
  const reqTier = requiredTierForSection(item.key);
  const activeText = onAccentText(accentTier);
  return (
    <button
      data-tour={`nav-${item.key}`}
      onClick={() => onSelect(item.key)}
      title={locked ? `${tierName(reqTier)} plan` : undefined}
      style={
        active
          ? { backgroundColor: accent, borderLeftColor: accent, color: activeText }
          : { borderLeftColor: "transparent", color: accent }
      }
      className={`flex w-full items-center gap-3 rounded-r-lg border-l-[3px] px-3 py-2 text-sm transition ${
        active ? "font-bold" : "font-semibold hover:bg-gray-800"
      }`}
    >
      {/* Icon always carries the tier color (white/dark on the active solid bg). */}
      <span style={{ color: active ? activeText : accent }}>
        <NavIcon name={item.icon} />
      </span>
      <span>{item.label}</span>
      <TierPill tier={accentTier} active={active} locked={locked} />
    </button>
  );
}

export default function Sidebar({
  section,
  onSelect,
  onLogout,
  isAdmin,
  isAgencyOwner,
  tier,
  workspaceRole = "owner",
  isTeamMember = false,
  ownerBusinessName = null,
}) {
  const { branding } = useBranding();
  const isDefaultBrand = branding.agencyName === "EchoAI";
  const brandTeal = branding.primaryColor || "#14B8A6";
  const ctx = { tier, isAgencyOwner };
  const activeGroup = groupKeyForSection(section);
  // Command Center (Mission Control / AI Team) is owner-only, so hide that group
  // from team members — their APIs are gated with requireOwner.
  const visibleGroups = isTeamMember ? NAV_GROUPS.filter((g) => g.key !== "command") : NAV_GROUPS;

  // Persisted open/closed state per group. First load: only the group with the
  // active section (plus always-open groups) is expanded to keep things compact.
  const [openGroups, setOpenGroups] = useState(() => {
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(LS_KEY) || "null");
    } catch {
      stored = null;
    }
    const init = {};
    for (const g of NAV_GROUPS) {
      if (stored && typeof stored[g.key] === "boolean") init[g.key] = stored[g.key];
      else init[g.key] = Boolean(g.alwaysOpen) || g.key === activeGroup;
    }
    return init;
  });

  // Mobile: which group's slide-up panel is open (null = none).
  const [mobilePanel, setMobilePanel] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(openGroups));
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, [openGroups]);

  function toggleGroup(key) {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleSelect(key) {
    setMobilePanel(null);
    onSelect(key);
  }

  const logo = branding.logoUrl ? (
    <img src={branding.logoUrl} alt={branding.agencyName} className="max-h-9 w-auto object-contain" />
  ) : isDefaultBrand ? (
    <span className="text-xl font-bold tracking-tight text-white">
      Echo<span style={{ color: brandTeal }}>AI</span>
    </span>
  ) : (
    <span className="text-xl font-bold tracking-tight text-white">{branding.agencyName}</span>
  );

  return (
    <>
      {/* ---------- Desktop sidebar ---------- */}
      <aside className="hidden bg-black px-3 py-6 text-gray-100 md:flex md:h-screen md:w-64 md:flex-col md:overflow-y-auto">
        <div className="mb-8 flex items-center px-2">{logo}</div>

        {isTeamMember && (
          <div className="mb-4 rounded-lg bg-gray-900 px-3 py-2 text-xs">
            <div className="text-gray-500">
              {ownerBusinessName ? `${ownerBusinessName} workspace` : "Team workspace"}
            </div>
            <div className="mt-0.5 font-semibold capitalize text-amber-300">
              {workspaceRole} access
            </div>
          </div>
        )}

        <nav className="flex flex-1 flex-col gap-3">
          {visibleGroups.map((group) => {
            const open = Boolean(openGroups[group.key]) || group.key === activeGroup;
            const lockCount = groupLockCount(group, ctx);
            const lockTierColor = accentColor(groupLockTier(group, ctx));
            const forced = group.key === activeGroup;
            return (
              <div key={group.key}>
                <button
                  onClick={() => !forced && toggleGroup(group.key)}
                  className={`flex w-full items-center justify-between px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500 transition hover:text-gray-300 ${
                    forced ? "cursor-default" : ""
                  }`}
                >
                  <span>{group.label}</span>
                  <span className="flex items-center gap-1.5">
                    {lockCount > 0 && (
                      <span
                        className="rounded-full px-1.5 text-[10px] font-bold"
                        style={{
                          color: lockTierColor,
                          backgroundColor: `${lockTierColor}22`,
                        }}
                      >
                        {lockCount} locked
                      </span>
                    )}
                    <svg
                      className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2.5}
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </span>
                </button>
                {open && (
                  <div className="mt-1 flex flex-col gap-0.5">
                    {group.items.map((item) => (
                      <NavRow
                        key={item.key}
                        item={item}
                        active={section === item.key}
                        locked={isItemLocked(item.key, ctx)}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {isAdmin && (
          <button
            data-tour="nav-admin"
            onClick={() => handleSelect("admin")}
            style={
              section === "admin"
                ? { backgroundColor: `${brandTeal}22`, borderLeftColor: brandTeal, color: brandTeal }
                : { borderLeftColor: "transparent" }
            }
            className={`mt-3 flex w-full items-center gap-3 rounded-r-lg border-l-[3px] px-3 py-2 text-sm font-medium transition ${
              section === "admin" ? "font-semibold" : "text-gray-300 hover:bg-gray-800 hover:text-white"
            }`}
          >
            <NavIcon name="admin" />
            <span>Admin</span>
          </button>
        )}

        <button
          onClick={onLogout}
          className="mt-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white"
        >
          Log out
        </button>
      </aside>

      {/* ---------- Mobile top logo bar ---------- */}
      <div className="flex items-center justify-between bg-black px-4 py-3 text-gray-100 md:hidden">
        {logo}
        <button onClick={onLogout} className="text-sm font-medium text-gray-400 hover:text-white">
          Log out
        </button>
      </div>

      {/* ---------- Mobile slide-up panel ---------- */}
      {mobilePanel && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMobilePanel(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="absolute inset-x-0 bottom-16 mx-2 rounded-2xl border border-gray-800 bg-gray-950 p-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const group = NAV_GROUPS.find((g) => g.key === mobilePanel);
              if (!group) return null;
              return (
                <>
                  <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    {group.label}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {group.items.map((item) => (
                      <NavRow
                        key={item.key}
                        item={item}
                        active={section === item.key}
                        locked={isItemLocked(item.key, ctx)}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ---------- Mobile bottom nav (group icons) ---------- */}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex items-stretch justify-around border-t border-gray-800 bg-black md:hidden">
        {visibleGroups.map((group) => {
          const isActiveGroup = group.key === activeGroup;
          const open = mobilePanel === group.key;
          const color = isActiveGroup ? brandTeal : undefined;
          return (
            <button
              key={group.key}
              onClick={() => setMobilePanel(open ? null : group.key)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
                open || isActiveGroup ? "text-white" : "text-gray-400"
              }`}
              style={color ? { color } : undefined}
            >
              <NavIcon name={group.icon} />
              <span className="max-w-[64px] truncate">{group.label.split(" ")[0]}</span>
            </button>
          );
        })}
        {isAdmin && (
          <button
            data-tour="nav-admin"
            onClick={() => handleSelect("admin")}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
              section === "admin" ? "text-white" : "text-gray-400"
            }`}
            style={section === "admin" ? { color: brandTeal } : undefined}
          >
            <NavIcon name="admin" />
            <span>Admin</span>
          </button>
        )}
      </nav>
    </>
  );
}
