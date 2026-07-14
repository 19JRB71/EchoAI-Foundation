// Pure helpers for Echo's always-on voice conversation engine. Kept DOM-free so
// they can be unit-tested without a browser: wake-word detection, question
// detection, and local (client-handled) intent matching.

// ---------------------------------------------------------------------------
// Southern / conversational speech canonicalization
// ---------------------------------------------------------------------------
// Applied inside normalizeSpeech so EVERY matcher (wake word, yes/no,
// interrupts, briefing, nav, music) understands country/slang phrasing for
// free. Word-boundary replacements only — never substrings inside words.
const SOUTHERN_REWRITES = [
  // contractions & casual forms
  [/\bgimme\b/g, "give me"],
  [/\blemme\b/g, "let me"],
  [/\bgonna\b/g, "going to"],
  [/\bwanna\b/g, "want to"],
  [/\bgotta\b/g, "got to"],
  [/\bkinda\b/g, "kind of"],
  [/\bfixin(g)? to\b/g, "about to"],
  [/\by ?all\b/g, "you all"],
  [/\bya\b/g, "you"],
  [/\bhowdy\b/g, "hey"],
  [/\ba+igh?t\b/g, "okay"],
  [/\bight\b/g, "okay"],
  [/\bnaw\b/g, "no"],
  [/\byessir\b/g, "yes sir"],
  [/\bnah sir\b/g, "no sir"],
  [/\bsup\b/g, "what s up"],
  [/\bfo sho\b/g, "for sure"],
  [/\bsho nuff\b/g, "sure enough"],
];

// Dropped-g verb endings the recognizer often emits for Southern speech
// ("runnin", "stoppin", "listenin"). Only KNOWN command-relevant verbs are
// mapped — never a blanket "in"→"ing" rewrite.
const DROPPED_G = [
  "runnin", "stoppin", "talkin", "listenin", "playin", "goin", "comin",
  "waitin", "holdin", "showin", "workin", "doin", "happenin", "lookin",
  "readin", "openin", "startin", "pausin", "skippin", "postin", "checkin",
  "mornin", "evenin", "nothin", "somethin", "anythin", "everythin",
];
const DROPPED_G_RE = new RegExp(`\\b(${DROPPED_G.join("|")})\\b`, "g");
const DROPPED_G_FIX = {
  nothin: "nothing", somethin: "something", anythin: "anything",
  everythin: "everything", mornin: "morning", evenin: "evening",
};

/**
 * Lowercase, strip punctuation, collapse whitespace, then canonicalize
 * Southern/slang speech so all downstream matchers see standard phrasing.
 */
export function normalizeSpeech(text) {
  let norm = String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [re, to] of SOUTHERN_REWRITES) norm = norm.replace(re, to);
  norm = norm.replace(DROPPED_G_RE, (w) => DROPPED_G_FIX[w] || `${w}g`);
  return norm.replace(/\s+/g, " ").trim();
}

// The wake phrase is "Hey Echo". We tolerate common speech-recognition
// mishearings but deliberately require the leading "hey" (or a close mishearing
// of it) so a casual sentence that merely contains "echo" does NOT trigger.
// Matching anywhere in the utterance lets a user say the phrase after a beat of
// silence; the text AFTER the phrase is treated as the command.
//
// Recognizer-mishearing variants (each observed from real Web Speech output):
//   greeting: hey / hay / hi / hei / heya / "hey there"
//   echo:     echo / ecko / ekko / ecco / eco / eko / echoes / echos / gecko /
//             echo ai / echoai / a co ("hey a co")
// A missing space ("heyecho") is also tolerated.
// Longest variants first — regex alternation is first-match, so "hey" before
// "hey there" would leave a stray "there" as the start of the command.
const WAKE_GREET = "(?:hey there|heya|hey|hay|hei|hi)";
const WAKE_NAME =
  "(?:e(?:c|ck|cc|k|kk)?h?o(?:e?s)?|gecko|a co)(?:\\s?ai)?";
const WAKE_RE = new RegExp(`\\b${WAKE_GREET}[ ]?,?[ ]?${WAKE_NAME}\\b`);

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

// Fallback wake matcher for the moments right after Echo has spoken (or been
// stopped): the recognizer sometimes drops the word "Echo" from the wake
// phrase entirely (live report: "hey give me the phone number"). In that
// narrow window, an utterance that STARTS with the greeting and carries a
// command is clearly addressed at Echo. The caller is responsible for the
// recency gate — this helper only does the shape match. It deliberately
// requires the greeting at the very start (mid-sentence "hey" never matches)
// and a non-empty command.
const WAKE_GREET_START_RE = new RegExp(`^${WAKE_GREET}\\b[ ]?,?[ ]?`);

export function parseWakeGreetingOnly(text) {
  const norm = normalizeSpeech(text);
  const m = norm.match(WAKE_GREET_START_RE);
  if (!m) return { matched: false, command: "" };
  const command = norm.slice(m[0].length).trim();
  if (!command) return { matched: false, command: "" };
  return { matched: true, command };
}

// Personal-assistant commands (reminders + task list). These route to the
// dedicated AI-parsed assistant endpoint instead of the general Echo chat, so
// "remind me to call Robert at 2pm" reliably creates a real reminder. The
// patterns stay intentionally explicit — informational questions about business
// data ("what are my leads") must NOT match.
const ASSISTANT_RE = new RegExp(
  [
    // Reminders: "remind me to...", "set a reminder...", "cancel the reminder..."
    "\\bremind me\\b",
    "\\b(set|create|make|add|cancel|delete|remove) (a |an |the |my )?reminders?\\b",
    "\\bwhat (are|do i have for) my reminders\\b",
    "\\b(any|my) reminders (today|for today|this week)\\b",
    // Tasks: "add a task...", "put ... on my task list", "what's on my task list"
    "\\b(add|create|put|make) (a |an )?(new )?task\\b",
    "\\b(add|put) (that|this|it|[a-z].*) (on|to) my (task |to do |to-do )?list\\b",
    "\\bmy (task|to do|to-do) list\\b",
    "\\bwhat('s| is| are) (on )?my (tasks?|to dos?|to-dos?)\\b",
    // Completing / marking off: "mark off number two", "the bank call is done"
    "\\b(mark|check|cross|tick) (off|it off|that off|.* off)\\b",
    "\\bmark .* (as )?(done|complete|completed|finished)\\b",
    "\\b(i('ve| have)? (already )?(did|done|finished|completed|handled|taken care of)) (that|the|it|my)\\b",
    "\\b(that|the) [a-z].* is (done|handled|finished|taken care of)\\b",
  ].join("|"),
);

/**
 * True when the utterance is a personal reminder / task-list command that
 * should go to the assistant endpoint rather than the general chat pipeline.
 */
export function matchAssistantIntent(text) {
  const norm = normalizeSpeech(text);
  if (!norm) return false;
  return ASSISTANT_RE.test(norm);
}

/** True when Echo's reply is a question and should keep the mic open indefinitely. */
export function isQuestion(text) {
  return /\?\s*$/.test(String(text || "").trim());
}

// ---------------------------------------------------------------------------
// Self-echo detection
// ---------------------------------------------------------------------------
// Right after Echo stops talking there is a short window where the recognizer
// can still deliver a transcript of Echo's OWN trailing audio (speaker →
// microphone leak plus recognition latency). The engine used to drop ALL
// speech in that window — which also silently ate the owner's quick answer to
// a question ("yes" spoken the instant the question ends). Instead we now
// compare what was heard against the TAIL of what Echo just said: only the
// end of Echo's speech can leak after playback finishes, so matching against
// the last few words keeps short real answers ("no", "yes") safe even when
// the same word appeared earlier in Echo's sentence.
const ECHO_TAIL_WORDS = 12;

/**
 * True when a transcript chunk heard in the brief window after Echo spoke is
 * (part of) Echo's own speech leaking back through the mic.
 * @param {string} heard raw transcript chunk from the recognizer.
 * @param {string[]} recentTexts the last few lines Echo spoke (raw text).
 */
export function isSelfEcho(heard, recentTexts) {
  const norm = normalizeSpeech(heard);
  if (!norm) return true; // nothing real captured — treat as noise
  const words = norm.split(" ");
  for (const spokenRaw of Array.isArray(recentTexts) ? recentTexts : []) {
    const spoken = normalizeSpeech(spokenRaw);
    if (!spoken) continue;
    const tail = spoken.split(" ").slice(-ECHO_TAIL_WORDS).join(" ");
    // Exact phrase containment in the tail → clearly Echo's own trailing audio.
    if (` ${tail} `.includes(` ${norm} `)) return true;
    // Fuzzy match for slightly-misheard leaks: a longer heard phrase whose
    // words overwhelmingly appear in the tail is still Echo's own voice.
    // Short real answers (1–2 words) never take this branch, so a quick
    // "yes" / "no thanks" can't be misclassified.
    if (words.length >= 3) {
      const tailSet = new Set(tail.split(" "));
      const hits = words.filter((w) => tailSet.has(w)).length;
      if (hits / words.length >= 0.7) return true;
    }
    // Long leaks aren't only tails: the recognizer often finalizes a capture
    // of Echo's own voice SECONDS after playback ends, and that capture can
    // contain the middle (or all) of Echo's sentence — which the tail check
    // misses, letting Echo "answer its own question". For 5+ word chunks, an
    // overwhelming word overlap with the WHOLE line is Echo's own voice.
    // Short real answers never take this branch, so "yes" / "no" stay safe,
    // and the 80% bar keeps real commands that merely reuse a few of Echo's
    // words passing through.
    if (words.length >= 5) {
      const lineSet = new Set(spoken.split(" "));
      const lineHits = words.filter((w) => lineSet.has(w)).length;
      if (lineHits / words.length >= 0.8) return true;
    }
  }
  return false;
}

/**
 * When a chunk WAS classified as self-echo, salvage any real speech glued on
 * the end. The recognizer often finalizes Echo's trailing audio together with
 * the owner's fast answer as ONE chunk ("…want me to give you the rundown
 * yes") — dropping the whole chunk eats the "yes". Walk backwards from the
 * end of the chunk collecting words that appear in NONE of the echoed lines;
 * a short (1–4 word) trailing remainder is the owner's real speech.
 * @param {string} heard raw transcript chunk already matched as self-echo.
 * @param {string[]} recentTexts the lines the chunk was matched against.
 * @returns {string} the salvaged trailing speech, or "" when the chunk is
 *   purely Echo's own audio.
 */
// Only these short responses may be salvaged off the end of a self-echo
// chunk. ASR routinely mishears a stray trailing token on a pure leak; an
// open-ended salvage would promote that noise into a command. Restricting to
// unambiguous yes/no/stop-style answers keeps salvage safe: a misheard word
// almost never lands exactly on one of these, and these are precisely the
// fast answers that get glued onto Echo's trailing audio.
const SALVAGE_RE =
  /^(yes|yeah|yep|yup|sure|ok|okay|no|nope|nah|no thanks|no thank you|not now|yes please|sure thing|go ahead|go for it|do it|please do|stop|cancel)( sir)?$/;

export function selfEchoRemainder(heard, recentTexts) {
  const norm = normalizeSpeech(heard);
  if (!norm) return "";
  const echoWords = new Set();
  for (const spokenRaw of Array.isArray(recentTexts) ? recentTexts : []) {
    for (const w of normalizeSpeech(spokenRaw).split(" ")) {
      if (w) echoWords.add(w);
    }
  }
  const words = norm.split(" ");
  const rem = [];
  for (let i = words.length - 1; i >= 0; i -= 1) {
    if (echoWords.has(words[i])) break;
    rem.unshift(words[i]);
  }
  if (rem.length === 0 || rem.length > 4) return "";
  const salvaged = rem.join(" ");
  // Fail closed: anything that isn't an unambiguous short answer stays
  // classified as Echo's own audio and is dropped whole.
  return SALVAGE_RE.test(salvaged) ? salvaged : "";
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
  /\b(show|open|go to|take me to|navigate to|pull up|bring up|jump to|switch to|send me to|bring me to|take me over to)\b/;
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
  { key: "autopilot", re: /\bauto ?pilot\b/, standalone: false },
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
    key: "echoplanner",
    re: /\b(my planner|the planner|reminders and tasks|tasks and reminders|my reminders|my task list)\b/,
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
  // The Email Assistant inbox — must sit before the generic "email" target
  // below so "take me to my inbox" opens the inbox, not email marketing.
  // "in box" covers the speech recognizer splitting the word.
  {
    key: "echoemail",
    re: /\b(in ?box|email assistant|mailbox|my emails?)\b/,
    standalone: false,
  },
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
  echoplanner: "your reminders and tasks",
  echogrowth: "autonomous growth",
  email: "email marketing",
  sms: "your SMS marketing",
  reputation: "your reputation dashboard",
  phone: "your phone agent",
  appointments: "your appointments",
  followups: "your follow-up sequences",
  contentcalendar: "your content calendar",
  autopilot: "autopilot",
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

import {
  pickVariant,
  NAV_CONFIRM_TEMPLATES,
  DEPT_CONFIRM_TEMPLATES,
  NAV_OFFER_TEMPLATES,
  DEPT_OFFER_TEMPLATES,
  STANDBY_GREETINGS,
  MUSIC_READY_LINES,
  BRIEFING_CHOICE_QUESTIONS,
  CLARIFY_QUESTIONS,
} from "./phraseVariety.js";

/**
 * The verbal confirmation Echo speaks after acting on a navigation command.
 * @param {string} navKey a value returned by matchNavIntent.
 * @returns {string} a spoken confirmation (never ends in "?", so it won't be
 *   treated as a follow-up question).
 */
export function navConfirmation(navKey) {
  if (!navKey)
    return pickVariant("nav.here", [
      "Here you go.",
      "There you are.",
      "All yours Sir.",
      "Right here for you.",
      "There it is.",
    ]);
  if (navKey === "action:facebook")
    return pickVariant("nav.fb", [
      "Opening Facebook setup for you.",
      "Facebook setup coming right up.",
      "Got it — opening Facebook setup.",
      "Taking you into Facebook setup now.",
      "On it — Facebook setup Sir.",
    ]);
  if (navKey.startsWith("dept:")) {
    const name = DEPT_NAMES[navKey.slice(5)] || "your team";
    return pickVariant("nav.dept", DEPT_CONFIRM_TEMPLATES)(name);
  }
  if (navKey === "missioncontrol")
    return pickVariant("nav.mc", [
      "Taking you back to Mission Control.",
      "Back to Mission Control we go.",
      "Mission Control coming right up Sir.",
      "Got it — heading home to Mission Control.",
      "On it — Mission Control Sir.",
    ]);
  const label = NAV_LABELS[navKey] || "that";
  return pickVariant("nav.section", NAV_CONFIRM_TEMPLATES)(label);
}

// ---------------------------------------------------------------------------
// Navigate-first, ask-before-reading
// ---------------------------------------------------------------------------

// Sections whose offer + readout come from the server with REAL data. Maps a
// navKey (from matchNavIntent) to the server brief section name.
export const BRIEF_SECTIONS = {
  leads: "leads",
  campaigns: "campaigns",
  "dept:atlas": "campaigns",
  "dept:sage": "sage",
};

/**
 * A short human label for a navKey ("your leads", "Sage's department"…), used
 * when composing the generic AI summary request after the owner says yes.
 */
export function navLabel(navKey) {
  if (!navKey) return "this section";
  if (navKey === "missioncontrol") return "Mission Control";
  if (navKey.startsWith("dept:")) {
    const name = DEPT_NAMES[navKey.slice(5)];
    return name ? `${name}'s department` : "this department";
  }
  return NAV_LABELS[navKey] || "this section";
}

/**
 * The question Echo asks right after navigating, offering to read the section
 * aloud. Used as-is for generic sections and as the fallback when the
 * data-backed server offer isn't available. Always ends in "?" so the
 * follow-up window stays open indefinitely.
 */
export function navOfferQuestion(navKey) {
  if (!navKey || navKey === "action:facebook") return null;
  if (navKey === "missioncontrol")
    return pickVariant("offer.mc", [
      "You're back at Mission Control. Want a quick rundown of what's here?",
      "Mission Control, Sir. Shall I give you the lay of the land?",
      "Here's Mission Control. Want the quick tour?",
      "Back at home base. Want me to run through what's here?",
      "Mission Control is up. Would you like the rundown?",
    ]);
  if (navKey.startsWith("dept:")) {
    const name = DEPT_NAMES[navKey.slice(5)] || "your team";
    if (navKey === "dept:sage")
      return pickVariant("offer.sage", [
        "I've opened Sage's intelligence report. Would you like me to read the highlights?",
        "Sage's intelligence report is up. Want the highlights?",
        "Here's what Sage has been digging into. Shall I read you the key findings?",
        "Sage's latest intel, Sir. Want me to walk you through it?",
        "That's Sage's report. Would you like the standout insights?",
      ]);
    return pickVariant("offer.dept", DEPT_OFFER_TEMPLATES)(name);
  }
  const label = NAV_LABELS[navKey] || "that";
  return pickVariant("offer.section", NAV_OFFER_TEMPLATES)(label);
}

// NOTE: these match AFTER normalizeSpeech, which replaces apostrophes with a
// space ("let's" → "let s", "i'm" → "i m", "that's" → "that s").
const YES_RE =
  /\b(yes|yeah|yep|yup|sure|ok(ay)?|yes please|please do|go ahead|go for it|absolutely|definitely|of course|why not|do it|read (it|them)|let s hear it|sounds good|bet|run it|let s go|lets go|send it|hit it|for sure|sure enough|yes sir)\b/;
const NO_RE =
  /\b(no|nope|nah|not now|not right now|maybe later|later|i m (good|fine|okay|ok)|im (good|fine|okay|ok)|that s (ok|okay|fine)|don t|do not|skip it|never mind|nevermind)\b/;

/**
 * Interpret a reply to a yes/no offer.
 * @returns {"yes"|"no"|null} null when the utterance is neither — the caller
 *   should treat it as a brand-new command.
 */
export function matchYesNo(text) {
  const norm = normalizeSpeech(text);
  if (!norm) return null;
  const yes = YES_RE.test(norm);
  const no = NO_RE.test(norm);
  if (yes && !no) return "yes";
  if (no) return "no";
  return null;
}

// ---------------------------------------------------------------------------
// Permission-to-speak retrieval ("Hey Echo, what did you need?")
// ---------------------------------------------------------------------------
// After Echo asks "do you have a moment?" and the owner defers ("not now"),
// the alert is held. These phrases are how the owner circles back to it later.
// Kept deliberately specific so it never hijacks a "go ahead" / "I'm ready"
// meant for a briefing or another pending offer.
const PERMISSION_RETRIEVE_RE =
  /\b(what (?:did|do) you (?:need|want)|what (?:was|is) it|what did you need me for|you (?:needed|wanted) me|what did you want to (?:tell|say)|what (?:needed|needs) my attention|what was that about|you had something)\b/;

/**
 * True when the owner is asking Echo to surface a deferred alert.
 * @returns {boolean}
 */
export function matchPermissionRetrieve(text) {
  const norm = normalizeSpeech(text);
  if (!norm) return false;
  return PERMISSION_RETRIEVE_RE.test(norm);
}

// ---------------------------------------------------------------------------
// Clear notifications ("Hey Echo, clear my notifications")
// ---------------------------------------------------------------------------
// Bulk-dismisses every pending notification badge. Requires the word
// "notification(s)" AND a clearing verb (order-independent, so "clear my
// notifications" and "mark all notifications as read" both match) so it never
// collides with clearing music, tasks, or the screen.
const NOTIFICATION_RE = /\bnotification/;
const CLEAR_VERB_RE = /\b(clear|dismiss|delete|remove|wipe|get rid of)\b/;
const MARK_READ_RE = /\bmark\b.*\bread\b/;

/**
 * True when the owner asks Echo to clear all pending notifications.
 * @returns {boolean}
 */
export function matchClearNotifications(text) {
  const norm = normalizeSpeech(text);
  if (!norm) return false;
  if (!NOTIFICATION_RE.test(norm)) return false;
  return CLEAR_VERB_RE.test(norm) || MARK_READ_RE.test(norm);
}

// ---------------------------------------------------------------------------
// Live hot-lead handoff ("transfer it" / "keep handling it")
// ---------------------------------------------------------------------------
// When Echo is running a live autonomous conversation and hits a strong buying
// signal, he asks the owner: "Want me to transfer them to you, or keep handling
// it?". These phrases interpret the spoken answer. "transfer" hands the lead to
// the owner; "continue" leaves Echo running it. matchYesNo can't map "transfer
// it" → yes, so a dedicated matcher is needed. A bare "yes" leans to transfer
// (the primary call to action) and a bare "no" to continue.
const TRANSFER_RE =
  /\b(transfer(?: it| them| the (?:call|lead|conversation))?|take (?:it |them |the (?:call|lead|conversation) )?over|take over|hand (?:it |them )?(?:to me|over)|i (?:will|ll) take (?:it|them|over)|put (?:them|it) through|connect me)\b/;
const KEEP_HANDLING_RE =
  /\b(keep handling|keep (?:it |them )?(?:going|handling)|keep going|you handle|you (?:got|ve got) (?:it|this)|handle it|carry on|leave it (?:to|with) you|stay on it|keep at it)\b/;

/**
 * Interpret a spoken answer to the live hot-lead handoff offer.
 * @returns {"transfer"|"continue"|null}
 */
export function matchTransferIntent(text) {
  const norm = normalizeSpeech(text);
  if (!norm) return null;
  if (TRANSFER_RE.test(norm)) return "transfer";
  if (KEEP_HANDLING_RE.test(norm)) return "continue";
  const yn = matchYesNo(norm);
  if (yn === "yes") return "transfer";
  if (yn === "no") return "continue";
  return null;
}

// ---------------------------------------------------------------------------
// Interrupt commands ("Stop", "Cancel", "Never mind", "Wait", "That's enough")
// ---------------------------------------------------------------------------
// These must work even WHILE Echo is speaking, so they are matched against raw
// mic input during playback. To keep Echo's own voice (which may contain words
// like "stop" or "wait" mid-sentence) from self-interrupting, the whole
// utterance must BE the interrupt phrase (optionally prefixed with "hey echo" /
// "echo" or followed by "please"), never merely contain it.
const INTERRUPT_RE =
  /^(?:hey )?(?:echo )?(?:please )?(?:stop|cancel|never ?mind|wait|hold up|that s enough|thats enough|that is enough|okay stop|ok stop|stop talking|stop it|kill it|kill everything|shut it down|cut it|chill|hold on)(?: please)?(?: echo)?$/;

/**
 * True when the utterance is a barge-in interrupt command. Matched against the
 * FULL normalized utterance so Echo's own spoken sentences can't trigger it.
 */
export function matchInterruptIntent(text) {
  const norm = normalizeSpeech(text);
  if (!norm) return false;
  // Keep it snappy: a genuine interrupt is a short bark, not a sentence.
  if (norm.split(" ").length > 5) return false;
  return INTERRUPT_RE.test(norm);
}

// ---------------------------------------------------------------------------
// Guided-tour voice control
// ---------------------------------------------------------------------------
// While the guided tour is running, short spoken answers drive it directly —
// no wake word needed. Matched against the FULL normalized utterance (like
// interrupts) so Echo's own narration can never advance the tour by itself.
const TOUR_NEXT_RE =
  /^(?:hey )?(?:echo )?(?:please )?(?:next(?: one| section| step)?|continue|go on|keep going|move on|go ahead|carry on|show me(?: the next one)?|let s go|lets go|i m ready|im ready|ready)(?: please)?(?: sir)?$/;
const TOUR_BACK_RE = /^(?:hey )?(?:echo )?(?:go |)back(?: one| up)?(?: please)?$/;

/**
 * Interpret an utterance as a guided-tour command.
 * @returns {"next"|"back"|"stop"|null}
 */
export function matchTourCommand(text) {
  const norm = normalizeSpeech(text);
  if (!norm) return null;
  if (norm.split(" ").length > 6) return null;
  if (matchInterruptIntent(norm)) return "stop";
  if (TOUR_BACK_RE.test(norm)) return "back";
  if (TOUR_NEXT_RE.test(norm)) return "next";
  if (matchYesNo(norm) === "yes") return "next";
  return null;
}

// ---------------------------------------------------------------------------
// On-demand briefing request + type choice
// ---------------------------------------------------------------------------
const BRIEFING_REQUEST_RE =
  /\b(brief me|briefing|morning update|daily update|catch me up|fill me in|bring me up to speed|what s (been )?(happening|going on)|whats (been )?(happening|going on)|give me (an? |the )?(update|rundown)|my update|what s good|whats good|what s the word|how we (looking|doing)|where we at)\b/;

/** True when the owner is asking for an on-demand briefing/update. */
export function matchBriefingIntent(text) {
  const norm = normalizeSpeech(text);
  if (!norm) return false;
  return BRIEFING_REQUEST_RE.test(norm);
}

// ---------------------------------------------------------------------------
// Morning standby greeting + start command
// ---------------------------------------------------------------------------
// On login Echo never auto-plays the morning briefing. He greets the owner,
// announces he is standing by, then goes quiet until the owner explicitly
// starts it ("Hey Echo, start my briefing", "ready", "run it", "what's good").
// Canonical (first) variant — actual playback uses phraseVariety.standbyGreeting()
// which rotates through 5 variations. Kept exported for back-compat.
export const MORNING_STANDBY_GREETING = STANDBY_GREETINGS.morning[0];

// Appended to the standby greeting when the owner has saved morning-music
// favorites (or the admin default suggestions apply). Playback rotates via
// phraseVariety.musicReadyLine().
export const MORNING_MUSIC_READY_LINE = MUSIC_READY_LINES[0];

const BRIEFING_START_RE =
  /\b((i m |im )?ready( now)?|start (my |the )?(morning )?briefing|(morning )?briefing time|let s do it|kick it off|fire it up|hit me|go ahead)\b/;

/**
 * True when the owner is telling standby-Echo to start the morning briefing.
 * Accepts any regular briefing request, an explicit start phrase, or a short
 * go-ahead bark ("ready", "bet", "run it", "let's go") — but a short
 * affirmative only counts on its own, never buried inside a longer sentence.
 */
export function matchBriefingStart(text) {
  const norm = normalizeSpeech(text);
  if (!norm) return false;
  if (BRIEFING_REQUEST_RE.test(norm)) return true;
  if (BRIEFING_START_RE.test(norm)) return true;
  return norm.split(" ").length <= 4 && YES_RE.test(norm) && !NO_RE.test(norm);
}

/** Canonical variant of the briefing-type question (rotation lives in
 * phraseVariety.briefingChoiceQuestion()). */
export const BRIEFING_CHOICE_QUESTION = BRIEFING_CHOICE_QUESTIONS[0];

const BRIEFING_FULL_RE =
  /\b(full( briefing)?|everything|all (of )?(my |the )?businesses|complete|the whole thing|all of it|cover it all)\b/;
const BRIEFING_QUICK_RE =
  /\b(quick( summary| one)?|short( one)?|summary|just the (highlights|important)|most important|highlights|key (things|points)|top (things|items)|real quick)\b/;

/**
 * Interpret the owner's answer to the briefing-type question.
 * @returns {"full"|"quick"|"specific"|"none"}
 *   - "full": everything across all businesses.
 *   - "quick": the most important things right now.
 *   - "specific": a particular business/topic — the utterance IS the topic.
 *   - "none": they declined ("no", "never mind").
 */
export function matchBriefingChoice(text) {
  const norm = normalizeSpeech(text);
  if (!norm) return "none";
  if (matchYesNo(norm) === "no") return "none";
  if (BRIEFING_FULL_RE.test(norm)) return "full";
  if (BRIEFING_QUICK_RE.test(norm)) return "quick";
  return "specific";
}

// Music playback voice commands ("play some jazz", "pause the music", "skip",
// "turn it up", "stop the music"). Handled locally by dispatching a
// `echoai:music-command` event that the MusicProvider listens for.
const VOL_UP_RE =
  /\b(turn (it|them|the music|the volume) up|louder|volume up|crank (it|the music) up|turn up the (music|volume)|pump it up|make it louder)\b/;
const VOL_DOWN_RE =
  /\b(turn (it|them|the music|the volume) down|quieter|softer|volume down|turn down the (music|volume)|lower the (music|volume)|make it quieter)\b/;
// Skip/pause used to match ANY sentence containing "skip"/"next"/"pause",
// which hijacked commands like "what's next on my calendar" into "Skipping
// ahead." — the "Echo does the wrong thing" bug. They now match only when the
// whole utterance IS the command, or a music noun is explicitly present.
const SKIP_FULL_RE =
  /^(?:please )?(?:skip|next)(?: (?:this|that|the))?(?: track| song| tune| one)?(?: please)?(?: sir)?$/;
const SKIP_NOUN_RE = /\b(?:skip|next)\b[^]*\b(?:track|song|tune)\b/;
const STOP_RE = /\b(stop|turn off|kill|shut off|end)( the| this)?( music| song| playback| tunes?)\b/;
const PAUSE_FULL_RE =
  /^(?:please )?(?:pause|hold)(?: (?:the|this|it))?(?: music| song| playback| track)?(?: please)?(?: sir)?$/;
const PAUSE_NOUN_RE = /\b(?:pause|hold)\b[^]*\b(?:music|song|playback|track)\b/;
const RESUME_RE =
  /\b(resume|unpause|keep playing|continue playing|play again|un pause)( the)?( music| song)?\b/;
const PLAY_RE = /\b(play|put on|start playing)\b\s*(.*)$/;

// Saved-favorites playback ("play my morning playlist", "start my music",
// "play some of my favorites", "play song number two"). Resolves to the
// owner's saved Music Preferences list (up to 5 songs/artists).
const FAVORITES_RE =
  /\b(?:play|start|put on|fire up|kick off|run|spin)\b.*\b(?:my (?:morning )?(?:playlist|music|songs?|tunes?|favou?rites?|jams?)|the (?:morning )?playlist|some of my favou?rites?|my favou?rite (?:songs?|music|tunes?))\b/;
const NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  "1st": 1,
  "2nd": 2,
  "3rd": 3,
  "4th": 4,
  "5th": 5,
};
const SONG_NUMBER_RE =
  /\bplay\b.*\b(?:song|track|tune|favou?rite)\s*(?:number\s*)?(one|two|three|four|five|[1-5])\b/;
// Ordinal phrasing puts the number BEFORE the noun: "play my second song",
// "play the 3rd track", "play my first favorite".
const SONG_ORDINAL_RE =
  /\bplay\b.*\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\s+(?:song|track|tune|favou?rite)\b/;

/**
 * Match a music-playback voice command.
 * @returns {{action:"play"|"pause"|"resume"|"skip"|"stop"|"volume"|"favorites", value?:string, index?:number}|null}
 *   For "play", `value` is the (possibly empty) search query. For "volume",
 *   `value` is "up" or "down". For "favorites", `index` is the 0-based saved
 *   song to start from.
 */
export function matchMusicIntent(text) {
  const norm = normalizeSpeech(text);
  if (!norm) return null;
  if (VOL_UP_RE.test(norm)) return { action: "volume", value: "up" };
  if (VOL_DOWN_RE.test(norm)) return { action: "volume", value: "down" };
  if (SKIP_FULL_RE.test(norm) || SKIP_NOUN_RE.test(norm))
    return { action: "skip" };
  if (STOP_RE.test(norm)) return { action: "stop" };
  if (RESUME_RE.test(norm)) return { action: "resume" };
  if (PAUSE_FULL_RE.test(norm) || PAUSE_NOUN_RE.test(norm))
    return { action: "pause" };
  const num = norm.match(SONG_NUMBER_RE) || norm.match(SONG_ORDINAL_RE);
  if (num) {
    const n = NUMBER_WORDS[num[1]] || Number(num[1]);
    return { action: "favorites", index: n - 1 };
  }
  if (FAVORITES_RE.test(norm)) return { action: "favorites", index: 0 };
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

// ---------------------------------------------------------------------------
// Direct status request ("what we got", "show current status")
// ---------------------------------------------------------------------------
// Unlike a briefing request (which asks full/quick/specific first), a status
// request reads out the current cross-business status immediately.
const STATUS_RE =
  /^(?:hey )?(?:echo )?(?:what (?:do )?we got|what we got today|show (?:me )?(?:the )?(?:current )?status|current status|status report|status check|where do we stand|how are we looking)(?: today| right now| sir)?$/;

/** True when the owner wants the current status read out immediately. */
export function matchStatusIntent(text) {
  const norm = normalizeSpeech(text);
  if (!norm) return false;
  if (norm.split(" ").length > 8) return false;
  return STATUS_RE.test(norm);
}

// ---------------------------------------------------------------------------
// Learned speech patterns (per-owner, stored server-side)
// ---------------------------------------------------------------------------
// Echo learns how THIS owner talks: when a phrase Echo didn't understand is
// immediately repeated in a form it DOES understand, the original phrase is
// remembered and mapped to that action. Next time the phrase works first try.

/** Actions a learned phrase may map to (client + server must agree). */
export const LEARNABLE_ACTIONS = [
  "stop",
  "yes",
  "no",
  "briefing",
  "briefing_quick",
  "status",
];

/**
 * Look up a learned phrase. `learnedMap` is a Map of normalized phrase →
 * action (one of LEARNABLE_ACTIONS). Exact whole-utterance match only, so a
 * long sentence containing a learned phrase can't misfire.
 * @returns {string|null} the mapped action, or null.
 */
export function matchLearnedPhrase(text, learnedMap) {
  if (!learnedMap || typeof learnedMap.get !== "function") return null;
  const norm = normalizeSpeech(text);
  if (!norm || norm.split(" ").length > 6) return null;
  const action = learnedMap.get(norm);
  return LEARNABLE_ACTIONS.includes(action) ? action : null;
}

/**
 * Decide which learnable action (if any) an utterance resolved to. Used to
 * remember a previously-misheard phrase once its repeat is understood.
 * @returns {string|null}
 */
export function resolveLearnableAction(text) {
  if (matchInterruptIntent(text)) return "stop";
  if (matchStatusIntent(text)) return "status";
  if (matchBriefingIntent(text)) return "briefing";
  const yn = matchYesNo(text);
  if (yn === "yes") return "yes";
  if (yn === "no") return "no";
  return null;
}

/** The exact clarification Echo asks when speech wasn't understood. */
// Canonical variant — playback rotates via phraseVariety.clarifyQuestion().
export const CLARIFY_QUESTION = CLARIFY_QUESTIONS[0];

// Below this recognizer confidence, an unmatched short utterance triggers the
// clarification question instead of being sent to the AI as-is. Tuned low-ish
// for Southern accents: confident-enough speech always passes straight through.
export const CONFIDENCE_THRESHOLD = 0.55;

/**
 * Reject `promise` after `ms` so a hung network/AI call can never wedge the
 * voice engine in a suspended (deaf) state. The rejection flows into the
 * caller's existing catch block, which speaks the honest failure line and
 * reopens listening.
 */
export function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("voice_call_timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * CONVERSATION-PRIORITY RULE: classify a voice-queue item as PROACTIVE
 * (Sage alerts, reminders, hot-lead alerts, morning/weekly briefings — anything
 * Echo initiates on his own) vs INTERACTIVE (a direct reply in an active
 * conversation, tour narration, wizard status lines, demo suggestions).
 * Proactive items must NEVER interrupt an active conversation: the queue holds
 * them until the conversation engine reports it is fully idle again.
 */
const INTERACTIVE_TYPES = new Set([
  "echo_conversation",
  "tour",
  "status",
  "demo",
  "demo-suggestion",
]);
export function isProactiveVoiceItem(item) {
  if (!item) return false;
  // Anything served by the pending-notifications poll carries a server id.
  if (item.notificationId) return true;
  return !INTERACTIVE_TYPES.has(item.type);
}

// ---------------------------------------------------------------------------
// Brand switching ("Hey Echo, switch to Blacor Homes")
// ---------------------------------------------------------------------------
// The dashboard is strictly single-brand, so switching businesses is a
// first-class voice command. Matching is two-step: a switch-style phrase pulls
// out the spoken business name, which is then fuzzily matched against the
// owner's REAL brand names (so "switch to settings" never trips this — it
// falls through to the normal nav matcher).
const BRAND_SWITCH_RES = [
  /^(?:hey echo )?(?:switch|change|swap|flip)(?: me)?(?: over)?(?: to| on to| onto)? (.+)$/,
  /^(?:hey echo )?(?:work on|pull up|let us look at|let s look at|look at) (.+)$/,
  /^(?:hey echo )?(?:go|take me)(?: over)? to (?:my )?(.+) (?:business|company|brand|account)$/,
];
// Bare "switch businesses" (no name) → Echo should ask which one.
const BRAND_SWITCH_ASK_RE =
  /^(?:hey echo )?(?:switch|change|swap)(?: my)?(?: the)? (?:business(?:es)?|brand(?:s)?|compan(?:y|ies))$/;
// Generic targets — "switch to ANOTHER business" (Echo's own greeting suggests
// this exact phrasing) names no brand, so it must resolve to the ask flow,
// not a failed fuzzy name match.
const BRAND_SWITCH_GENERIC_RE =
  /^(?:another|a different|the other|a new|different|other)(?: one)?$/;

function normalizeBrandName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match a brand-switch command against the owner's brand list.
 * `brands` is [{ brand_id, brand_name }].
 * Returns { brand } on a name match, { ask: true } for a bare "switch
 * businesses", or null when this isn't a switch command / no brand matches.
 */
export function matchBrandSwitch(text, brands) {
  const norm = normalizeSpeech(text);
  if (!norm) return null;
  const list = Array.isArray(brands) ? brands : [];
  if (BRAND_SWITCH_ASK_RE.test(norm)) return list.length ? { ask: true } : null;
  let spoken = null;
  for (const re of BRAND_SWITCH_RES) {
    const m = norm.match(re);
    if (m) {
      spoken = m[1].trim();
      break;
    }
  }
  if (!spoken) return null;
  // Strip trailing business-type words ("blacor homes business" → "blacor homes")
  spoken = spoken.replace(/\s+(business|company|brand|account)$/, "").trim();
  if (!spoken) return null;
  // "switch to another business" / "change to a different one" → ask which.
  if (BRAND_SWITCH_GENERIC_RE.test(spoken)) {
    return list.length ? { ask: true } : null;
  }
  // Exact-normalized match first, then containment either way (spoken name is
  // often a shortened form: "blacor" for "Blacor Homes").
  let best = null;
  for (const b of list) {
    const name = normalizeBrandName(b.brand_name);
    if (!name) continue;
    if (name === spoken) return { brand: b };
    if (name.includes(spoken) || spoken.includes(name)) {
      if (!best) best = b;
    }
  }
  // Word-overlap fallback: every spoken word appears in the brand name
  // ("switch over to blacor home" vs "Blacor Homes").
  if (!best) {
    const words = spoken.split(" ").filter((w) => w.length > 2);
    if (words.length) {
      for (const b of list) {
        const name = normalizeBrandName(b.brand_name);
        if (words.every((w) => name.includes(w))) {
          best = b;
          break;
        }
      }
    }
  }
  return best ? { brand: best } : null;
}

// ---------------------------------------------------------------------------
// Voice content creation ("Hey Echo, let's create some content")
// ---------------------------------------------------------------------------
// Kicks off the voice content session: Echo gathers the brand's real
// intelligence, drafts posts + visuals, and walks the owner through each one.
// The matcher is deliberately explicit — "content"/"posts" must be the OBJECT
// of a create-ish verb so ordinary sentences can't trigger a whole workflow.
const CONTENT_CREATE_RE =
  /^(?:hey )?(?:echo[,!]? )?(?:let ?s |lets |can (?:you|we) |could (?:you|we) |i (?:want|need) (?:you )?to |(?:i ?m |we ?re )?ready to |help me |time to |please )?(?:create|make|draft|write|generate|whip up|put together|work on|build|do)(?: up)?(?: some| a few| me some| us some| some new| new| an?| this week ?s)?( facebook| instagram| insta| linkedin| twitter| tiktok)? (?:content|posts?|social (?:media )?(?:content|posts?)|marketing content)\b(.*)$/;

/**
 * Detects "let's create some content" style requests.
 * @returns {{ request: string }|null} request = any trailing topic hint
 *   ("about the summer sale"), possibly empty.
 */
export function matchContentCreateIntent(text) {
  const norm = normalizeSpeech(text);
  if (!norm) return null;
  const m = norm.match(CONTENT_CREATE_RE);
  if (!m) return null;
  // A platform word before "post" ("do a facebook post") becomes part of the
  // topic hint so the drafting session knows which platform the owner meant.
  const platform = (m[1] || "").trim();
  const trailing = (m[2] || "").trim();
  const request = [platform ? `for ${platform}` : "", trailing]
    .filter(Boolean)
    .join(" ");
  return { request };
}

// Review-walkthrough commands while Echo is presenting a draft. Approve is
// EXPLICIT and exact-ish — nothing is ever scheduled off a loose match.
const CONTENT_APPROVE_RE =
  /^(?:yes[,!]? )?(?:approve|approved|approve it|approve that(?: one)?|schedule it|schedule that(?: one)?|post it|publish it|ship it|send it|book it|lock it in|i approve|go ahead and (?:schedule|post) it|yes schedule it|yes post it)$/;
const CONTENT_SKIP_RE =
  /^(?:skip|skip it|skip this one|skip that(?: one)?|pass|pass on (?:this|that)(?: one)?|drop it|toss it|not that one|no skip it|next(?: one)?(?: please)?|move on)$/;
const CONTENT_IMAGE_RE =
  /^(?:(?:can you |could you |please )?(?:create|generate|make|add|show me|do|build|give me)(?: me| us)?(?: the| a| an| its)? (?:visual|image|picture|graphic|photo|artwork)(?: for (?:it|this|that)(?: one)?)?|what about (?:the|a) (?:visual|image|picture))$/;
const CONTENT_REPEAT_RE =
  /^(?:(?:can you |could you |please )?(?:read|say) (?:it|that)(?: one)? again|repeat (?:it|that)(?: please)?|one more time|come again)$/;
const CONTENT_DONE_RE =
  /^(?:(?:that ?s|thats|that is) (?:all|enough|it)(?: for now)?|we ?re done|were done|i ?m done|im done|done for now|wrap it up|finish up|end (?:the )?session|no more)$/;
const CONTENT_REVISE_RE =
  /^(?:change|revise|rewrite|redo|edit|tweak|adjust|shorten|lengthen|soften|punch up|reword|make it|can you make it|could you make it|add|remove|take out|drop the|mention|include|start it|end it)\b/;

/**
 * Interprets the owner's spoken command while reviewing a content draft.
 * @returns {{ action: 'approve'|'skip'|'image'|'repeat'|'done' } |
 *           { action: 'revise', instruction: string } | null}
 *   null = not a review command (caller falls through / asks for guidance).
 */
export function matchContentReviewCommand(text) {
  const norm = normalizeSpeech(text);
  if (!norm) return null;
  if (CONTENT_APPROVE_RE.test(norm)) return { action: "approve" };
  if (CONTENT_SKIP_RE.test(norm)) return { action: "skip" };
  if (CONTENT_IMAGE_RE.test(norm)) return { action: "image" };
  if (CONTENT_REPEAT_RE.test(norm)) return { action: "repeat" };
  if (CONTENT_DONE_RE.test(norm)) return { action: "done" };
  if (CONTENT_REVISE_RE.test(norm))
    return { action: "revise", instruction: text.trim() };
  return null;
}

// ---------------------------------------------------------------------------
// Autopilot Mode ("Hey Echo, let's review the batch" / "set up autopilot")
// ---------------------------------------------------------------------------
// Weekly-batch review: Echo walks the owner through every pending item —
// posts with graphics plus test ads — and NOTHING publishes or spends without
// an explicit approve. The same strict review verbs as content creation
// (matchContentReviewCommand) drive the verdicts.
const AUTOPILOT_REVIEW_RE =
  /^(?:hey )?(?:echo[,!]? )?(?:let ?s |lets |can we |could we |i (?:want|d like) to |time to |please )?(?:review|go (?:over|through)|walk (?:me )?through|look at|check)(?: the| this week ?s| my)? (?:batch|weekly batch|autopilot batch|autopilot items|approvals?)\b/;
const AUTOPILOT_REVIEW_ALT_RE =
  /^(?:hey )?(?:echo[,!]? )?(?:what ?s in the batch|review the week|review my week|show me the batch)\b/;
const AUTOPILOT_SETUP_RE =
  /^(?:hey )?(?:echo[,!]? )?(?:let ?s |lets |can (?:you|we) |could (?:you|we) |please |help me )*(?:set ?up|turn on|enable|start|activate|switch on)(?: the)? auto ?pilot(?: mode)?\b/;

/** "Let's review the batch" — start the weekly autopilot review. */
export function matchAutopilotReviewIntent(text) {
  const norm = normalizeSpeech(text);
  if (!norm) return null;
  if (AUTOPILOT_REVIEW_RE.test(norm) || AUTOPILOT_REVIEW_ALT_RE.test(norm)) {
    return { review: true };
  }
  return null;
}

/** "Set up autopilot" / "turn on autopilot" — the voice onboarding walkthrough. */
export function matchAutopilotSetupIntent(text) {
  const norm = normalizeSpeech(text);
  if (!norm) return null;
  return AUTOPILOT_SETUP_RE.test(norm) ? { setup: true } : null;
}

/**
 * Spoken presentation of one autopilot batch item. Posts read like content
 * drafts; ads always state the exact daily budget out loud — the owner hears
 * what a yes costs BEFORE approving.
 */
export function speakableAutopilotItem(item, index, total) {
  const ord = DRAFT_ORDINALS[index] || `number ${index + 1}`;
  const platformName =
    { facebook: "Facebook", twitter: "X", linkedin: "LinkedIn" }[
      item.platform
    ] || item.platform || "social";
  if (item.itemType === "ad") {
    const budget =
      item.adDailyBudget != null
        ? ` at ${item.adDailyBudget} dollars a day`
        : "";
    return `${total > 1 ? `Item ${index + 1} of ${total}` : "Next up"} is a Facebook test ad${budget}. The headline: ${item.adHeadline || "no headline"}. The ad reads: ${item.postContent}`;
  }
  let when = "";
  if (item.scheduledTime) {
    const d = new Date(item.scheduledTime);
    if (!Number.isNaN(d.getTime())) {
      when = ` I'd post it ${d.toLocaleString(undefined, {
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
      })}.`;
    }
  }
  const intro =
    total > 1
      ? `The ${ord} one is a ${platformName} post:`
      : `Here's the post, for ${platformName}:`;
  return `${intro} ${item.postContent}${when}`;
}

/** Ordinal position line for the walkthrough ("first", "second", ...). */
const DRAFT_ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
];

/**
 * Composes the spoken presentation of one draft: position, platform, the post
 * itself, and the proposed schedule slot — then the review question.
 */
export function speakableDraft(draft, index, total) {
  const ord = DRAFT_ORDINALS[index] || `number ${index + 1}`;
  const platformName =
    { facebook: "Facebook", twitter: "X", linkedin: "LinkedIn" }[
      draft.platform
    ] || draft.platform;
  let when = "";
  if (draft.scheduledTime) {
    const d = new Date(draft.scheduledTime);
    if (!Number.isNaN(d.getTime())) {
      when = ` I'd schedule it for ${d.toLocaleString(undefined, {
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
      })}.`;
    }
  }
  const intro =
    total > 1
      ? `Here's the ${ord} one, for ${platformName}:`
      : `Here's what I've got, for ${platformName}:`;
  return `${intro} ${draft.postContent}${when}`;
}
