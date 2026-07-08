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
const WAKE_GREET = "(?:hey|hay|hi|hei|heya|hey there)";
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
    return "You're back at Mission Control. Want a quick rundown of what's here?";
  if (navKey.startsWith("dept:")) {
    const name = DEPT_NAMES[navKey.slice(5)] || "your team";
    if (navKey === "dept:sage")
      return "I've opened Sage's intelligence report. Would you like me to read the highlights?";
    return `I've opened ${name}'s department. Want me to give you the rundown?`;
  }
  const label = NAV_LABELS[navKey] || "that";
  return `I've opened ${label}. Want me to give you the highlights?`;
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
export const MORNING_STANDBY_GREETING =
  "Good morning Sir. I will be on standby waiting for you to start your morning briefing.";

// Appended to the standby greeting when the owner has saved morning-music
// favorites (or the admin default suggestions apply).
export const MORNING_MUSIC_READY_LINE =
  "Your morning playlist is ready whenever you want it Sir.";

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

/** The exact question Echo asks when a briefing is requested on demand. */
export const BRIEFING_CHOICE_QUESTION =
  "Of course Sir. Would you like a full briefing covering all your businesses, a quick summary of the most important things right now, or a specific update on one business or topic?";

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
const SKIP_RE = /\b(skip|next)( (this|the))?( track| song| tune)?\b/;
const STOP_RE = /\b(stop|turn off|kill|shut off|end)( the| this)?( music| song| playback| tunes?)\b/;
const PAUSE_RE = /\b(pause|hold)( the)?( music| song| playback| track)?\b/;
const RESUME_RE =
  /\b(resume|unpause|keep playing|continue playing|play again|un pause)( the)?( music| song)?\b/;
const PLAY_RE = /\b(play|put on|start playing)\b\s*(.*)$/;

// Saved-favorites playback ("play my morning playlist", "start my music",
// "play some of my favorites", "play song number two"). Resolves to the
// owner's saved Music Preferences list (up to 5 songs/artists).
const FAVORITES_RE =
  /\b(?:play|start|put on|fire up|kick off|run|spin)\b.*\b(?:my (?:morning )?(?:playlist|music|songs?|tunes?|favou?rites?|jams?)|the (?:morning )?playlist|some of my favou?rites?|my favou?rite (?:songs?|music|tunes?))\b/;
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const SONG_NUMBER_RE =
  /\bplay\b.*\b(?:song|track|tune|favou?rite)\s*(?:number\s*)?(one|two|three|four|five|[1-5])\b/;

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
  if (SKIP_RE.test(norm)) return { action: "skip" };
  if (STOP_RE.test(norm)) return { action: "stop" };
  if (RESUME_RE.test(norm)) return { action: "resume" };
  if (PAUSE_RE.test(norm)) return { action: "pause" };
  const num = norm.match(SONG_NUMBER_RE);
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
export const CLARIFY_QUESTION =
  "I didn't quite catch that Sir, could you say that again?";

// Below this recognizer confidence, an unmatched short utterance triggers the
// clarification question instead of being sent to the AI as-is. Tuned low-ish
// for Southern accents: confident-enough speech always passes straight through.
export const CONFIDENCE_THRESHOLD = 0.55;
