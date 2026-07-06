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
  { key: "leads", re: /\bleads?\b/, standalone: false },
  { key: "portfolio", re: /\bportfolio\b/, standalone: false },
  {
    key: "missioncontrol",
    re: /\b(mission control|go home|take me home|home screen)\b/,
    standalone: true,
  },
  { key: "settings", re: /\bsettings\b/, standalone: false },
  // Department views (agent name OR a natural-language alias for the department).
  { key: "dept:atlas", re: /\b(atlas|campaigns?|advertising)\b/, standalone: true },
  {
    key: "dept:scout",
    re: /\b(scout|competitors?|competition|competitor report|market intelligence)\b/,
    standalone: true,
  },
  { key: "dept:nova", re: /\b(nova|social media)\b/, standalone: true },
  { key: "dept:pulse", re: /\b(pulse|crm)\b/, standalone: true },
  // Remaining top-level feature sections (verb required).
  { key: "email", re: /\bemail( marketing)?\b/, standalone: false },
  { key: "sms", re: /\b(sms|text messaging)\b/, standalone: false },
  { key: "reputation", re: /\b(reputation|reviews?)\b/, standalone: false },
  { key: "phone", re: /\bphone( agent)?\b/, standalone: false },
  { key: "appointments", re: /\b(appointments?|calendar)\b/, standalone: false },
  { key: "followups", re: /\bfollow ?ups?\b/, standalone: false },
  { key: "chatbot", re: /\b(chatbot|website widget)\b/, standalone: false },
  { key: "adstudio", re: /\b(ad studio|ad creative)\b/, standalone: false },
  { key: "googleseo", re: /\b(seo|google)\b/, standalone: false },
  { key: "roi", re: /\broi\b/, standalone: false },
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
  portfolio: "your portfolio",
  settings: "your settings",
  email: "email marketing",
  sms: "your SMS marketing",
  reputation: "your reputation dashboard",
  phone: "your phone agent",
  appointments: "your appointments",
  followups: "your follow-up sequences",
  chatbot: "your website chatbot",
  adstudio: "the ad creative studio",
  googleseo: "Google and SEO",
  roi: "your ROI dashboard",
};
const DEPT_NAMES = { atlas: "Atlas", scout: "Scout", nova: "Nova", pulse: "Pulse" };

/**
 * The verbal confirmation Echo speaks after acting on a navigation command.
 * @param {string} navKey a value returned by matchNavIntent.
 * @returns {string} a spoken confirmation (never ends in "?", so it won't be
 *   treated as a follow-up question).
 */
export function navConfirmation(navKey) {
  if (!navKey) return "Here you go.";
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
