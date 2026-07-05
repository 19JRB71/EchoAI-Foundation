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

// A navigation command must pair an explicit "go there" verb with a known
// section, so informational questions ("what are my leads today") fall through
// to Echo instead of navigating. Keys match App.jsx section ids.
const NAV_VERB_RE = /\b(show|open|go to|take me to|navigate to|pull up|bring up)\b/;
const NAV_SECTIONS = [
  ["leads", /\bleads?\b/],
  ["social", /\bsocial( media)?\b/],
  ["email", /\bemail( marketing)?\b/],
  ["sms", /\b(sms|text messaging)\b/],
  ["reputation", /\b(reputation|reviews?)\b/],
  ["phone", /\bphone( agent)?\b/],
  ["appointments", /\b(appointments?|calendar)\b/],
  ["followups", /\bfollow ?ups?\b/],
  ["chatbot", /\b(chatbot|website widget)\b/],
  ["adstudio", /\b(ad studio|ad creative)\b/],
  ["googleseo", /\b(seo|google)\b/],
  ["roi", /\broi\b/],
  ["settings", /\bsettings\b/],
];

/**
 * Match a "take me to <section>" navigation command.
 * @returns {string|null} the App section id, or null when it isn't a nav command.
 */
export function matchNavIntent(text) {
  const norm = normalizeSpeech(text);
  if (!norm || !NAV_VERB_RE.test(norm)) return null;
  for (const [key, re] of NAV_SECTIONS) {
    if (re.test(norm)) return key;
  }
  return null;
}
