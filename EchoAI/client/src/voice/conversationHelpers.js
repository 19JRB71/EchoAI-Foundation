// Pure helpers for Echo's always-on voice conversation engine. Kept DOM-free so
// they can be unit-tested without a browser: wake-word detection, question
// detection, and local (client-handled) intent matching.

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeSpeech(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The wake phrase is "Hey Echo". We tolerate common speech-recognition
// mishearings ("hey eco", "hay echo", "hey echoai") but deliberately require the
// leading "hey" so a casual sentence that merely contains "echo" does NOT
// trigger. Matching anywhere in the utterance lets a user say the phrase after a
// beat of silence; the text AFTER the phrase is treated as the command.
const WAKE_RE = /\b(?:hey|hay|hi)\s+ec?h?o(?:\s?ai)?\b/;

/**
 * Detect the wake phrase in a transcript.
 * @returns {{ matched: boolean, command: string }} — `command` is whatever was
 *   said after the wake phrase (empty string if nothing followed).
 */
export function parseWakeWord(text) {
  const norm = normalizeSpeech(text);
  const m = norm.match(WAKE_RE);
  if (!m) return { matched: false, command: "" };
  const command = norm.slice(m.index + m[0].length).trim();
  return { matched: true, command };
}

/** True when Echo's reply is a question and should keep the mic open indefinitely. */
export function isQuestion(text) {
  return /\?\s*$/.test(String(text || "").trim());
}

// Phrases Echo handles itself, without a round-trip to the server.
const MUTE_RE = /\b(mute yourself|mute yourself now|go quiet|be quiet|stop listening|mute)\b/;
const PATIENCE_RE =
  /\b(give me a (minute|moment|sec|second)|gimme a (minute|sec|second)|hold on|one (sec|second|moment|minute)|need to think|let me think|think about (it|that)|thinking about (it|that))\b/;

/**
 * Match a locally-handled voice intent.
 * @returns {"mute" | "patience" | null}
 *   - "mute": user asked Echo to go quiet.
 *   - "patience": user needs a moment — acknowledge and keep listening, no timeout.
 */
export function matchLocalIntent(text) {
  const norm = normalizeSpeech(text);
  if (!norm) return null;
  if (MUTE_RE.test(norm)) return "mute";
  if (PATIENCE_RE.test(norm)) return "patience";
  return null;
}

// A navigation command normally pairs an explicit "go there" verb with a known
// target, so informational questions ("what are my leads today") fall through to
// Echo instead of navigating. A subset of targets is also allowed to match
// verb-lessly (e.g. "social media", "competitor report", "mission control",
// "go home", and the department names) because those read as direct commands —
// but only when the utterance doesn't clearly begin like a question.
const NAV_VERB_RE =
  /\b(show|open|go to|take me to|navigate to|pull up|bring up|jump to|switch to)\b/;
// A leading question/informational stem — used to keep verb-less targets from
// hijacking questions like "how is my social media doing".
const NAV_QUESTION_RE =
  /^(whats?|hows?|why|when|where|who|is|are|am|do|does|did|can|could|would|should|will|tell|give)\b/;

// Ordered targets. `key` is the App section id, OR `dept:<agentId>` to open a
// team member's Department View. `standalone: true` lets it match without a nav
// verb (for direct commands / bare department names). Order matters — the first
// matching target wins, so put more specific / higher-priority targets first.
const NAV_TARGETS = [
  // ── Group A: multi-word / distinctive phrases (must win before the generic
  // single-word sections below that would otherwise swallow them). ──
  // Facebook setup opens the connect wizard (an App-level action, not a
  // section). "connect facebook" / "facebook setup" read as direct commands, so
  // they match standalone; bare "facebook" still needs a nav verb.
  {
    key: "action:facebook",
    re: /\b(facebook setup|set ?up facebook|connect (?:my |to )?facebook|facebook connect|link (?:my )?facebook)\b/,
    standalone: true,
  },
  { key: "action:facebook", re: /\bfacebook\b/, standalone: false },
  { key: "voicesettings", re: /\bvoice settings\b/, standalone: true },
  { key: "contentcalendar", re: /\bcontent calendar\b/, standalone: true },
  {
    key: "sentinelhealth",
    re: /\b(sentinel health|health monitor|system health|health check)\b/,
    standalone: true,
  },
  {
    key: "callmonitor",
    re: /\b(call monitor|call monitoring|monitor calls|call logs?)\b/,
    standalone: true,
  },
  {
    key: "queueoverview",
    re: /\b(sales queue|queue overview|call queue)\b/,
    standalone: true,
  },
  {
    key: "capitalfunding",
    re: /\b(capital funding|capital and funding|capital|funding)\b/,
    standalone: false,
  },
  {
    key: "echomemory",
    re: /\b(echo memory|memory bank|my memory|memories)\b/,
    standalone: false,
  },
  {
    key: "echogrowth",
    re: /\b(echo growth|autonomous growth|auto growth|growth engine)\b/,
    standalone: false,
  },
  {
    key: "aiteam",
    re: /\b(ai team|my team|the team|team overview|ai staff|meet the team)\b/,
    standalone: false,
  },
  {
    key: "adstudio",
    re: /\b(ad studio|ad creative|creative studio|ad creatives)\b/,
    standalone: false,
  },
  { key: "sales", re: /\b(sales scripts?|sales script generator)\b/, standalone: false },
  {
    key: "intelligence",
    re: /\b(customer intelligence|intelligence|strategy profile)\b/,
    standalone: false,
  },
  // ── Group B: Department Views — agent name OR a distinctive role/department
  // alias (standalone). Generic single-noun aliases are listed separately just
  // below and require a nav verb, so a plain statement can't hijack navigation. ──
  { key: "dept:echo", re: /\b(echo department|marketing director)\b/, standalone: true },
  {
    key: "dept:scout",
    re: /\b(scout|research specialist|research department|competitor report|market research)\b/,
    standalone: true,
  },
  {
    key: "dept:atlas",
    re: /\b(atlas|advertising manager|advertising department|ads? manager)\b/,
    standalone: true,
  },
  {
    key: "dept:nova",
    re: /\b(nova|social media manager|social manager|social department)\b/,
    standalone: true,
  },
  { key: "dept:pulse", re: /\b(pulse|crm manager)\b/, standalone: true },
  {
    key: "dept:voice",
    re: /\b(receptionist|voice department|voice agent|answering service)\b/,
    standalone: true,
  },
  {
    key: "dept:forge",
    re: /\b(forge|creative director|creative department)\b/,
    standalone: true,
  },
  { key: "dept:sentinel", re: /\bsentinel\b/, standalone: true },
  {
    key: "dept:sage",
    re: /\b(sage|industry brief|industry report)\b/,
    standalone: true,
  },
  // Generic single-noun department aliases — verb REQUIRED (no standalone) so an
  // ordinary statement like "competition is rough" can't trigger navigation.
  { key: "dept:atlas", re: /\badvertising\b/, standalone: false },
  { key: "dept:scout", re: /\b(competitors?|competition)\b/, standalone: false },
  { key: "dept:pulse", re: /\bcrm\b/, standalone: false },
  { key: "dept:sentinel", re: /\boversight\b/, standalone: false },
  // Bare "voice" is the Voice agent's name but also a common word, so it needs a
  // nav verb ("go to voice"). It sits after the "voice settings" target above,
  // which is checked first, so "voice settings" still opens voice settings.
  { key: "dept:voice", re: /\bvoice\b/, standalone: false },
  // ── Group C: single-word / generic feature sections (verb required). ──
  { key: "leads", re: /\bleads?\b/, standalone: false },
  { key: "campaigns", re: /\b(ad campaigns?|campaigns?)\b/, standalone: false },
  { key: "social", re: /\b(social media|social)\b/, standalone: false },
  { key: "email", re: /\bemail( marketing)?\b/, standalone: false },
  { key: "sms", re: /\b(sms|text messaging|texting)\b/, standalone: false },
  { key: "reputation", re: /\b(reputation|reviews?)\b/, standalone: false },
  { key: "phone", re: /\bphone( agent)?\b/, standalone: false },
  { key: "appointments", re: /\b(appointments?|calendar|scheduling)\b/, standalone: false },
  { key: "followups", re: /\bfollow ?ups?\b/, standalone: false },
  { key: "chatbot", re: /\b(chatbot|website widget|web chat)\b/, standalone: false },
  { key: "image", re: /\b(image studio|images?)\b/, standalone: false },
  { key: "video", re: /\b(video content|videos?)\b/, standalone: false },
  { key: "googleseo", re: /\b(seo|google)\b/, standalone: false },
  { key: "roi", re: /\b(roi|return on investment)\b/, standalone: false },
  { key: "feedback", re: /\b(customer feedback|feedback|surveys?)\b/, standalone: false },
  { key: "affiliate", re: /\b(affiliates?|referrals?|referral program)\b/, standalone: false },
  { key: "agency", re: /\b(agency|agencies|white label)\b/, standalone: false },
  { key: "zapier", re: /\b(zapier|webhooks?)\b/, standalone: false },
  { key: "overview", re: /\boverview\b/, standalone: false },
  { key: "portfolio", re: /\bportfolio\b/, standalone: false },
  { key: "admin", re: /\b(admin panel|admin dashboard|admin)\b/, standalone: false },
  { key: "settings", re: /\bsettings\b/, standalone: false },
  {
    key: "missioncontrol",
    re: /\b(mission control|go home|take me home|home screen)\b/,
    standalone: true,
  },
];

/**
 * Match a "take me to <target>" navigation command.
 * @returns {string|null} the App section id (e.g. "leads"), a "dept:<agentId>"
 *   key to open a Department View, or null when it isn't a nav command.
 */
export function matchNavIntent(text) {
  const norm = normalizeSpeech(text);
  if (!norm) return null;
  const hasVerb = NAV_VERB_RE.test(norm);
  const looksLikeQuestion = NAV_QUESTION_RE.test(norm);
  for (const { key, re, standalone } of NAV_TARGETS) {
    if (!re.test(norm)) continue;
    if (hasVerb) return key;
    if (standalone && !looksLikeQuestion) return key;
  }
  return null;
}

// Friendly labels for the spoken confirmation Echo gives after navigating.
const NAV_LABELS = {
  leads: "your leads",
  campaigns: "your ad campaigns",
  social: "your social media",
  portfolio: "your portfolio",
  overview: "your overview",
  settings: "your settings",
  voicesettings: "your voice settings",
  aiteam: "your AI team",
  echomemory: "Echo's memory",
  echogrowth: "autonomous growth",
  email: "email marketing",
  sms: "your SMS marketing",
  reputation: "your reputation dashboard",
  phone: "your phone agent",
  appointments: "your appointments",
  followups: "your follow-up sequences",
  contentcalendar: "your content calendar",
  chatbot: "your website chatbot",
  adstudio: "the ad creative studio",
  image: "the image studio",
  video: "your video content",
  sales: "your sales scripts",
  googleseo: "Google and SEO",
  roi: "your ROI dashboard",
  intelligence: "customer intelligence",
  capitalfunding: "capital and funding",
  feedback: "customer feedback",
  affiliate: "your affiliate program",
  agency: "your agency workspace",
  zapier: "your webhooks",
  admin: "the admin panel",
  sentinelhealth: "the health monitor",
  callmonitor: "call monitoring",
  queueoverview: "the sales queue",
};
const DEPT_NAMES = {
  echo: "Echo",
  scout: "Scout",
  atlas: "Atlas",
  nova: "Nova",
  pulse: "Pulse",
  voice: "Voice",
  forge: "Forge",
  sentinel: "Sentinel",
  sage: "Sage",
};

/**
 * The verbal confirmation Echo speaks after acting on a navigation command.
 * @param {string} navKey a value returned by matchNavIntent.
 * @returns {string} a spoken confirmation (never ends in "?", so it won't be
 *   treated as a follow-up question).
 */
export function navConfirmation(navKey) {
  if (!navKey) return "Here you go.";
  if (navKey === "action:facebook") return "Opening Facebook setup for you.";
  if (navKey.startsWith("dept:")) {
    const name = DEPT_NAMES[navKey.slice(5)] || "your team";
    return `Taking you to ${name}.`;
  }
  if (navKey === "missioncontrol") return "Taking you back to Mission Control.";
  const label = NAV_LABELS[navKey] || "that";
  return `Opening ${label} now.`;
}

// Music playback voice commands ("play some jazz", "pause the music", "skip",
// "turn it up", "stop the music"). Handled locally by dispatching a
// `echoai:music-command` event that the MusicProvider listens for.
const VOL_UP_RE =
  /\b(turn (it|them|the music|the volume) up|louder|volume up|crank (it|the music) up|turn up the (music|volume)|pump it up|make it louder)\b/;
const VOL_DOWN_RE =
  /\b(turn (it|them|the music|the volume) down|quieter|softer|volume down|turn down the (music|volume)|lower the (music|volume)|make it quieter)\b/;
const SKIP_RE = /\b(skip|next)( (this|the))?( track| song| tune)?\b/;
const STOP_RE = /\b(stop|turn off|kill|shut off|end)( the| this)?( music| song| playback| tunes?)\b/;
const PAUSE_RE = /\b(pause|hold)( the)?( music| song| playback| track)?\b/;
const RESUME_RE =
  /\b(resume|unpause|keep playing|continue playing|play again|un pause)( the)?( music| song)?\b/;
const PLAY_RE = /\b(play|put on|start playing)\b\s*(.*)$/;

/**
 * Match a music-playback voice command.
 * @returns {{action:"play"|"pause"|"resume"|"skip"|"stop"|"volume", value?:string}|null}
 *   For "play", `value` is the (possibly empty) search query. For "volume",
 *   `value` is "up" or "down".
 */
export function matchMusicIntent(text) {
  const norm = normalizeSpeech(text);
  if (!norm) return null;
  if (VOL_UP_RE.test(norm)) return { action: "volume", value: "up" };
  if (VOL_DOWN_RE.test(norm)) return { action: "volume", value: "down" };
  if (SKIP_RE.test(norm)) return { action: "skip" };
  if (STOP_RE.test(norm)) return { action: "stop" };
  if (RESUME_RE.test(norm)) return { action: "resume" };
  if (PAUSE_RE.test(norm)) return { action: "pause" };
  const m = norm.match(PLAY_RE);
  if (m) {
    let q = (m[2] || "").trim();
    q = q.replace(/^(some|me|the|a|an|my)\s+/i, "").trim();
    q = q.replace(/\b(music|songs?|tunes?|a playlist|playlist|please|for me)\b/gi, "").trim();
    q = q.replace(/\s+/g, " ").trim();
    return { action: "play", value: q };
  }
  return null;
}
