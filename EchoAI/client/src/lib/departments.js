// Department navigation model (client mirror of the backend AGENTS roster).
//
// The dashboard is organized around the eight AI team members. The sidebar and
// Mission Control open a team member's Department View; each department exposes a
// grid of "tool" cards that open the EXISTING feature section unchanged. This file
// is the single source of truth for that mapping so the Sidebar, DepartmentView,
// Mission Control and App router all agree.
//
// Each tool: { label, desc, section }  — opens that feature section, OR
//            { label, desc, action }   — triggers an App-level action (e.g. the
//                                         Facebook connect wizard) instead.

// Static metadata (id, name, title, color) — mirrors controllers/agentsController
// AGENTS. Live status/currentTask come from /api/agents at render time.
export const AGENTS_META = [
  { id: "echo", name: "Echo", title: "Marketing Director", color: "#14B8A6" },
  { id: "scout", name: "Scout", title: "Research Specialist", color: "#0EA5E9" },
  { id: "atlas", name: "Atlas", title: "Advertising Manager", color: "#6366F1" },
  { id: "nova", name: "Nova", title: "Social Media Manager", color: "#EC4899" },
  { id: "pulse", name: "Pulse", title: "CRM Manager", color: "#F97316" },
  { id: "voice", name: "Voice", title: "AI Receptionist", color: "#8B5CF6" },
  { id: "forge", name: "Forge", title: "Creative Director", color: "#EAB308" },
  { id: "sentinel", name: "Sentinel", title: "Oversight Agent", color: "#EF4444" },
  { id: "sage", name: "Sage", title: "Industry Intelligence Agent", color: "#059669" },
];

export const AGENT_IDS = AGENTS_META.map((a) => a.id);

export function agentMeta(agentId) {
  return AGENTS_META.find((a) => a.id === agentId) || null;
}

// Per-department tool cards. Order matters (rendered top-to-bottom, left-to-right).
export const DEPARTMENTS = {
  echo: [
    { label: "Portfolio", desc: "Every business you run — health, results and one unified approval queue.", section: "portfolio" },
    { label: "Morning Briefing", desc: "Today's AI-generated strategic brief and team roll-up.", section: "missioncontrol" },
    { label: "Team Overview", desc: "All team members, live status and this week's results.", section: "aiteam" },
    { label: "Weekly Intelligence", desc: "Echo's latest customer-intelligence report.", section: "intelligence" },
    { label: "Autonomous Growth", desc: "Guardrails and the log of Echo's autonomous actions.", section: "echogrowth" },
    { label: "Memory", desc: "Searchable history of everything Echo remembers.", section: "echomemory" },
    { label: "Reminders & Tasks", desc: "Your personal planner — voice-set reminders and your task list.", section: "echoplanner" },
    { label: "Email & Communications", desc: "Echo watches your inboxes — urgent mail, contracts, leads and AI-drafted replies you approve.", section: "echoemail" },
    { label: "Voice Settings", desc: "Echo's spoken briefings, reminders and alerts.", section: "voicesettings" },
  ],
  scout: [
    { label: "Customer Intelligence", desc: "Competitor and market intelligence briefs.", section: "intelligence" },
    { label: "Capital & Funding", desc: "Grants, funding programs, opportunity briefings and Echo-drafted applications.", section: "capitalfunding" },
    { label: "Competitor Ads", desc: "Every confirmed competitor's live Facebook ads, aggressive-ad alerts and a weekly ad intelligence report.", section: "competitorads" },
    { label: "Competitor Sites", desc: "Add competitor websites — Scout analyzes their pricing, offers and messaging, then alerts you to meaningful changes.", section: "competitorsites" },
    { label: "Google & SEO", desc: "Keyword rankings and SEO content recommendations.", section: "googleseo" },
  ],
  atlas: [
    { label: "Ad Campaigns", desc: "All ad campaigns with live performance.", section: "campaigns" },
    { label: "Ad Creative Studio", desc: "AI-generated ad creative packages.", section: "adstudio" },
    { label: "Budget & ROI", desc: "Ad spend versus results and return on investment.", section: "roi" },
    { label: "Connect Facebook", desc: "Link Facebook so Atlas can run ads.", action: "facebook" },
  ],
  nova: [
    { label: "Autopilot Mode", desc: "Echo drafts your whole week — posts, graphics and test ads — for your approval.", section: "autopilot" },
    { label: "Content Calendar", desc: "Your full monthly posting schedule.", section: "contentcalendar" },
    { label: "Social Media", desc: "Scheduled and published posts across platforms.", section: "social" },
  ],
  pulse: [
    { label: "Leads", desc: "Every lead with temperature and status.", section: "leads" },
    { label: "Voter CRM", desc: "Supporters, donors, volunteers and campaign events.", section: "supporters" },
    { label: "Property CRM", desc: "Listings, buyer & seller leads and open houses.", section: "properties" },
    { label: "Sales Queue", desc: "Rep workload, throughput and the live working queue.", section: "queueoverview" },
    { label: "Follow-Up Sequences", desc: "Automated nurture sequences.", section: "followups" },
    { label: "Appointments", desc: "Booked and upcoming appointments.", section: "appointments" },
    { label: "Email Marketing", desc: "Campaigns and drip sequences.", section: "email" },
    { label: "SMS Marketing", desc: "Two-way text campaigns and replies.", section: "sms" },
  ],
  voice: [
    { label: "Phone Agent", desc: "Your AI receptionist and call history.", section: "phone" },
    { label: "Website Chatbot", desc: "The embeddable lead-qualifying chatbot.", section: "chatbot" },
  ],
  forge: [
    { label: "Image Studio", desc: "AI on-brand image generation.", section: "image" },
    { label: "Video Content", desc: "AI video scripts and packages.", section: "video" },
    { label: "Ad Creative Studio", desc: "Creative packages for your ads.", section: "adstudio" },
    { label: "Sales Scripts", desc: "AI-generated sales scripts.", section: "sales" },
  ],
  sentinel: [
    { label: "Call Monitoring", desc: "Every call placed today, with recordings and accountability logs.", section: "callmonitor" },
    { label: "Health Monitor", desc: "Live health status and detected issues.", section: "sentinelhealth", tab: "monitor" },
    { label: "Auto-Fix Log", desc: "Issues Sentinel resolved automatically.", section: "sentinelhealth", tab: "autofix" },
    { label: "Error History", desc: "Past health sweeps and their outcomes.", section: "sentinelhealth", tab: "errors" },
    { label: "Platform Status", desc: "Status of each connected system.", section: "sentinelhealth", tab: "platform" },
  ],
  sage: [
    { label: "Industry Brief", desc: "The living read on your industry — trends, competition, opportunities and threats.", section: "sage", tab: "brief" },
    { label: "Latest Intelligence", desc: "A rolling feed of what Sage has discovered, urgent signals first.", section: "sage", tab: "feed" },
    { label: "Competitor Watch", desc: "The competitors Sage tracks for you, with their latest moves.", section: "sage", tab: "competitors" },
    { label: "Marketing Insights", desc: "Actionable recommendations drawn from live industry intelligence.", section: "sage", tab: "insights" },
    { label: "Intelligence Input", desc: "Feed Sage links, competitor pages, images or documents to analyze.", section: "sage", tab: "input" },
  ],
};

export function departmentTools(agentId) {
  return DEPARTMENTS[agentId] || [];
}

// Human-readable titles for feature sections that can be reached OUTSIDE a
// department (sidebar Settings, admin console, cross-feature hand-offs). Drives
// the "Home > <Title>" breadcrumb when there is no department context.
export const SECTION_TITLES = {
  portfolio: "Portfolio",
  missioncontrol: "Mission Control",
  aiteam: "AI Team",
  settings: "Settings",
  admin: "Admin",
  agency: "White Label",
  affiliate: "Affiliate Program",
  overview: "Dashboard",
  leads: "Leads",
  campaigns: "Ad Campaigns",
  adstudio: "Ad Creative Studio",
  social: "Social Media",
  contentcalendar: "Content Calendar",
  autopilot: "Autopilot Mode",
  video: "Video Content",
  sales: "Sales Scripts",
  email: "Email Marketing",
  image: "Image Studio",
  googleseo: "Google & SEO",
  roi: "ROI Dashboard",
  intelligence: "Customer Intelligence",
  capitalfunding: "Capital & Funding",
  competitorsites: "Competitor Sites",
  reputation: "Reputation",
  phone: "Phone Agent",
  appointments: "Appointments",
  followups: "Follow-Up Sequences",
  sms: "SMS Marketing",
  chatbot: "Website Chatbot",
  feedback: "Customer Feedback",
  zapier: "Zapier",
  echomemory: "Echo · Memory",
  echoplanner: "Echo · Reminders & Tasks",
  echoemail: "Echo · Email & Communications",
  echogrowth: "Echo · Autonomous Growth",
  voicesettings: "Echo · Voice Settings",
  sentinelhealth: "Sentinel · Health",
  callmonitor: "Sentinel · Call Monitoring",
  queueoverview: "Pulse · Sales Queue",
  supporters: "Voter CRM",
  properties: "Property CRM",
  sage: "Sage · Industry Intelligence",
  corelab: "Conversational Core Lab",
};

export function sectionTitle(section) {
  return SECTION_TITLES[section] || null;
}
