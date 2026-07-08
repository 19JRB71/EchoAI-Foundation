// ---------------------------------------------------------------------------
// Phrase variety engine — makes Echo sound like a person, not a script.
//
// Every category of canned response gets a pool of at least 5 variations.
// pickVariant() rotates through them RANDOMLY but never repeats the same
// phrase twice in a row for a given category. On top of that, maybeFlourish()
// occasionally (about 1 in 7) tacks on a short personality touch — a light
// observation, never a question, so it can't hijack the follow-up window.
// ---------------------------------------------------------------------------

// Last spoken index per category, so the same line never plays back-to-back.
const lastPick = new Map();

/**
 * Pick a random variant for a category, never the same one twice in a row.
 * @param {string} category stable key ("nav.confirm", "interrupt", ...)
 * @param {string[]} variants the pool (should have 5+ entries)
 * @returns {string}
 */
export function pickVariant(category, variants) {
  if (!Array.isArray(variants) || variants.length === 0) return "";
  if (variants.length === 1) return variants[0];
  const last = lastPick.get(category);
  let idx = Math.floor(Math.random() * variants.length);
  if (idx === last) idx = (idx + 1 + Math.floor(Math.random() * (variants.length - 1))) % variants.length;
  lastPick.set(category, idx);
  return variants[idx];
}

/** Test hook: forget rotation history so tests are deterministic-ish. */
export function _resetVariety() {
  lastPick.clear();
}

// ---------------------------------------------------------------------------
// Personality flourishes — brief, warm, statement-only (never a "?" so the
// question/follow-up logic is untouched). Applied sparingly.
// ---------------------------------------------------------------------------
const FLOURISHES = [
  "Let's make it count.",
  "Busy day ahead — I like it.",
  "I had a feeling you'd ask.",
  "Always a pleasure.",
  "Consider it handled.",
  "Right where the action is.",
];

const FLOURISH_CHANCE = 0.15;

/**
 * Occasionally append a short personality touch to a spoken statement.
 * Never fires on questions (would break the follow-up window) and never
 * repeats the same flourish twice in a row.
 */
export function maybeFlourish(text, chance = FLOURISH_CHANCE) {
  if (!text || text.trim().endsWith("?")) return text;
  if (Math.random() >= chance) return text;
  return `${text} ${pickVariant("flourish", FLOURISHES)}`;
}

// ---------------------------------------------------------------------------
// Variation pools
// ---------------------------------------------------------------------------

export const INTERRUPT_ACKS = [
  "Understood Sir.",
  "Got it.",
  "Sure thing Sir.",
  "No problem.",
  "Stepping back.",
  "Say no more Sir.",
];

/** Spoken acknowledgement when the owner interrupts Echo mid-speech. */
export function interruptAck() {
  return pickVariant("interrupt", INTERRUPT_ACKS);
}

// Login standby greetings, keyed by the owner's LOCAL part of day (from the
// server's brand-settings timezone). Echo must NEVER say "Good morning" outside
// the 5:00–11:59 window — afternoon/evening/late logins get a day-update offer
// instead of the full morning briefing (saved for tomorrow morning).
export const STANDBY_GREETINGS = {
  morning: [
    "Good morning Sir. I will be on standby waiting for you to start your morning briefing.",
    "Morning Sir. Your briefing is ready whenever you are — just say the word.",
    "Good to see you Sir. I'm standing by with your morning briefing when you want it.",
    "Rise and shine Sir. Say the word and I'll run your morning briefing.",
    "Welcome back Sir. I've got your morning briefing on deck whenever you're ready.",
  ],
  afternoon: [
    "Good afternoon Sir. Would you like a quick update on how your day is going, or shall I save the full briefing for tomorrow morning?",
    "Good afternoon Sir. I can catch you up on the day so far — just say the word, or we'll save the full briefing for the morning.",
    "Good afternoon Sir. Say the word and I'll run you through how the day is going; otherwise your full briefing waits for tomorrow morning.",
    "Good afternoon Sir. Want a quick read on the day so far? Your full briefing will be ready tomorrow morning either way.",
    "Good afternoon Sir. I've got a quick day update ready if you want it — the full briefing is saved for the morning.",
  ],
  evening: [
    "Good evening Sir. Would you like a quick recap of the day, or shall I save the full briefing for tomorrow morning?",
    "Good evening Sir. I can run you through how the day went — just say the word, or we'll save the full briefing for the morning.",
    "Good evening Sir. Want a quick update on today? Your full briefing will be ready tomorrow morning either way.",
    "Good evening Sir. Say the word and I'll recap the day; otherwise your full briefing waits for tomorrow morning.",
    "Good evening Sir. I've got today's recap ready if you want it — the full briefing is saved for the morning.",
  ],
  late: [
    "Working late Sir? I can give you a quick update on the day if you like, or we'll save the full briefing for the morning.",
    "Working late Sir? Burning the midnight oil — say the word for a quick day update; the full briefing waits for morning.",
    "Working late Sir? Just say the word if you want a quick recap of today; your full briefing will be ready in the morning.",
    "Working late Sir? If you want a quick update before you wrap up, just say the word — the full briefing is saved for the morning.",
    "Working late Sir? I've got a quick recap of the day on hand — otherwise your full briefing waits for the morning.",
  ],
};

/**
 * The login standby greeting (Echo waits; never auto-plays the briefing).
 * `part` is the owner's local part of day: "morning" | "afternoon" | "evening" | "late".
 */
export function standbyGreeting(part = "morning") {
  const pool = STANDBY_GREETINGS[part] || STANDBY_GREETINGS.morning;
  return pickVariant(`greeting.standby.${part}`, pool);
}

export const MUSIC_READY_LINES = [
  "Your morning playlist is ready whenever you want it Sir.",
  "And your playlist is queued up whenever you'd like some music Sir.",
  "Your favorites are ready to roll whenever you say so Sir.",
  "Just say start my music and I'll get your playlist going Sir.",
  "Your morning soundtrack is standing by too Sir.",
];

/** Appended to the standby greeting when saved music favorites exist. */
export function musicReadyLine() {
  return pickVariant("greeting.music", MUSIC_READY_LINES);
}

export const CLARIFY_QUESTIONS = [
  "I didn't quite catch that Sir, could you say that again?",
  "Sorry Sir, I missed that — one more time?",
  "Could you run that by me again Sir?",
  "I didn't get all of that — mind repeating it Sir?",
  "Say that once more for me Sir?",
];

/** Asked when speech recognition confidence is too low. Always a question. */
export function clarifyQuestion() {
  return pickVariant("clarify", CLARIFY_QUESTIONS);
}

export const BRIEFING_CHOICE_QUESTIONS = [
  "Of course Sir. Would you like a full briefing covering all your businesses, a quick summary of the most important things right now, or a specific update on one business or topic?",
  "Happy to Sir. Full briefing across everything, a quick summary of what matters most, or a specific update on one business or topic?",
  "You got it Sir. Shall I do the full rundown, just the quick highlights, or zero in on one business or topic?",
  "Right away Sir. Do you want the complete briefing, a fast summary of the essentials, or a specific update on one business or topic?",
  "Absolutely Sir. Full briefing, quick summary, or a specific update on one business or topic — which would you like?",
];

/** Asked when the owner requests a briefing without saying which kind. */
export function briefingChoiceQuestion() {
  return pickVariant("briefing.choice", BRIEFING_CHOICE_QUESTIONS);
}

export const GO_QUIET_LINES = [
  "Going quiet. Say Hey Echo whenever you need me.",
  "Alright, I'll pipe down. Hey Echo brings me right back.",
  "Say no more — going silent. I'm one Hey Echo away.",
  "Quiet mode it is. Call Hey Echo when you want me.",
  "I'll hush up Sir. Just say Hey Echo when you need me.",
];

export function goQuietLine() {
  return pickVariant("quiet", GO_QUIET_LINES);
}

export const TAKE_YOUR_TIME_LINES = [
  "Take your time. I'm here when you're ready.",
  "No rush at all — I'll be right here.",
  "Whenever you're ready Sir, I'm standing by.",
  "Take all the time you need. I'm not going anywhere.",
  "Of course — I'll be here when you're set.",
];

export function takeYourTimeLine() {
  return pickVariant("takeyourtime", TAKE_YOUR_TIME_LINES);
}

export const TACKLE_FIRST_QUESTIONS = [
  "What would you like to tackle first today?",
  "So — where shall we start today?",
  "What's first on the agenda Sir?",
  "Where would you like to dig in first?",
  "What shall we take on first today Sir?",
];

export function tackleFirstQuestion() {
  return pickVariant("tacklefirst", TACKLE_FIRST_QUESTIONS);
}

// ---------------------------------------------------------------------------
// Music command acknowledgements (per action, 5+ each)
// ---------------------------------------------------------------------------
export const MUSIC_REPLIES = {
  playQuery: [
    (q) => `Playing ${q}.`,
    (q) => `${q} coming right up.`,
    (q) => `You got it — ${q} it is.`,
    (q) => `Queuing up ${q} now.`,
    (q) => `On it. ${q} for you.`,
  ],
  playGeneric: [
    "Starting some music.",
    "Let's get some tunes going.",
    "Music coming right up.",
    "Putting something on now.",
    "You got it — hitting play.",
  ],
  favoritesStart: [
    "Starting your playlist Sir.",
    "Your favorites, coming right up Sir.",
    "Rolling your playlist now.",
    "You got it — playlist time.",
    "Firing up your favorites Sir.",
  ],
  favoritesNumber: [
    (n) => `Playing song number ${n} from your list Sir.`,
    (n) => `Number ${n}, coming right up.`,
    (n) => `You got it — track ${n} from your favorites.`,
    (n) => `Jumping to song ${n} Sir.`,
    (n) => `Song ${n} it is.`,
  ],
  pause: ["Paused.", "Holding it there.", "On pause.", "Freezing it right there.", "Paused for you Sir."],
  resume: ["Back on.", "Rolling again.", "Picking it back up.", "And we're back.", "Resuming the music."],
  skip: ["Skipping ahead.", "Next one coming up.", "On to the next.", "Moving right along.", "Skipping that one."],
  stop: ["Music off.", "Shutting the music down.", "All quiet.", "Killing the music.", "Music's off Sir."],
  volumeDown: ["Turning it down.", "Bringing it down a notch.", "Easing off the volume.", "Softer it is.", "Lowering it for you."],
  volumeUp: ["Turning it up.", "Cranking it a bit.", "Bringing it up a notch.", "Louder it is.", "Pumping it up Sir."],
  done: ["Done.", "All set.", "Taken care of.", "Consider it done.", "Handled."],
};

/** Varied spoken acknowledgement for a music voice command. */
export function musicAck(music) {
  switch (music.action) {
    case "play":
      return music.value
        ? pickVariant("music.play", MUSIC_REPLIES.playQuery)(music.value)
        : pickVariant("music.playg", MUSIC_REPLIES.playGeneric);
    case "favorites":
      return music.index
        ? pickVariant("music.favn", MUSIC_REPLIES.favoritesNumber)(music.index + 1)
        : pickVariant("music.fav", MUSIC_REPLIES.favoritesStart);
    case "pause":
      return pickVariant("music.pause", MUSIC_REPLIES.pause);
    case "resume":
      return pickVariant("music.resume", MUSIC_REPLIES.resume);
    case "skip":
      return pickVariant("music.skip", MUSIC_REPLIES.skip);
    case "stop":
      return pickVariant("music.stop", MUSIC_REPLIES.stop);
    case "volume":
      return music.value === "down"
        ? pickVariant("music.vdown", MUSIC_REPLIES.volumeDown)
        : pickVariant("music.vup", MUSIC_REPLIES.volumeUp);
    default:
      return pickVariant("music.done", MUSIC_REPLIES.done);
  }
}

// ---------------------------------------------------------------------------
// Navigation confirmations + follow-up offers (templated, 5 each)
// ---------------------------------------------------------------------------
export const NAV_CONFIRM_TEMPLATES = [
  (label) => `Opening ${label} now.`,
  (label) => `Here's ${label} Sir.`,
  () => "Taking you there now.",
  (label) => `${cap(label)} coming right up Sir.`,
  (label) => `Got it — opening ${label} for you.`,
  () => "On it Sir.",
];

export const DEPT_CONFIRM_TEMPLATES = [
  (name) => `Taking you to ${name}.`,
  (name) => `Here's ${name} Sir.`,
  (name) => `${name} coming right up Sir.`,
  (name) => `Got it — opening ${name} for you.`,
  () => "On it Sir.",
];

export const NAV_OFFER_TEMPLATES = [
  (label) => `I've opened ${label}. Want me to give you the highlights?`,
  (label) => `Here's ${label}. Shall I walk you through it?`,
  (label) => `${cap(label)} is up. Want the quick rundown?`,
  (label) => `There's ${label}. Would you like me to read through it?`,
  (label) => `You're looking at ${label}. Want me to hit the highlights?`,
];

export const DEPT_OFFER_TEMPLATES = [
  (name) => `I've opened ${name}'s department. Want me to give you the rundown?`,
  (name) => `Here's ${name}'s corner of the operation. Shall I walk you through it?`,
  (name) => `${name}'s department is up. Want the quick tour?`,
  (name) => `You're in ${name}'s department now. Want me to hit the highlights?`,
  (name) => `That's ${name}'s turf. Would you like the rundown?`,
];

function cap(s) {
  return s && s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
