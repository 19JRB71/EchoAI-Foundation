/**
 * Voice Calibration — the measurement core.
 *
 * Pure functions only (no React, no browser APIs) so every piece of the
 * pause/pace math is unit-testable. The calibration UI feeds this module raw
 * speech-recognition event timings; it returns per-answer stats, an aggregate
 * summary, and a recommended per-user voice profile (Fast / Balanced /
 * Patient Listener + tuned end-of-turn timings) that the conversation engine
 * applies.
 *
 * The profile is stored inside users.voice_settings (JSONB) as `voiceProfile`
 * and normalized/clamped on the server in config/echoVoice.js — keep the
 * clamps here and there IN SYNC.
 */

// The three listener styles. Timings (ms):
//  - activePauseMs: silence after interim speech before Echo treats the turn
//    as finished (the engine's ACTIVE_PAUSE_MS).
//  - finalPauseMs: shorter commit window when the recognizer itself delivered
//    a FINAL chunk (the engine's FINAL_PAUSE_MS).
//  - continuationExtraMs: extra wait added when the speech tail ends with a
//    continuation cue ("and", "but", "so", "uh"…) — the speaker is almost
//    certainly mid-thought, so Echo holds off.
export const PROFILE_PRESETS = {
  fast: { activePauseMs: 700, finalPauseMs: 350, continuationExtraMs: 600 },
  balanced: { activePauseMs: 900, finalPauseMs: 450, continuationExtraMs: 900 },
  patient: { activePauseMs: 1600, finalPauseMs: 800, continuationExtraMs: 1500 },
};

export const STYLE_LABELS = {
  fast: "Fast",
  balanced: "Balanced",
  patient: "Patient Listener",
};

// Hard bounds so a corrupt/malicious stored profile can never wedge the
// engine (a 60s end-of-turn wait would read as "Echo ignores me" forever).
// Mirrored on the server in config/echoVoice.js.
export const PROFILE_CLAMPS = {
  activePauseMs: [500, 2500],
  finalPauseMs: [300, 1200],
  continuationExtraMs: [0, 2500],
};

// Words/fillers that signal "I'm not done talking" when they END a speech
// burst. Multi-word cues are matched as phrases.
export const CONTINUATION_CUES = [
  "and",
  "but",
  "so",
  "or",
  "uh",
  "um",
  "because",
  "then",
  "like",
  "also",
  "plus",
  "well",
  "you know",
  "i mean",
];

// A gap between recognition events at least this long counts as a pause.
// While someone is actually talking, webspeech interims arrive well under
// half a second apart.
export const MIN_PAUSE_MS = 550;
// A pause at least this long counts as a "thinking pause".
export const THINKING_PAUSE_MS = 1100;

// The calibration conversation. Per James: mix easy questions (people spit
// the answer right out) with think-first questions (pause… talk… pause) so
// the measurement captures BOTH rhythms.
export const CALIBRATION_QUESTIONS = [
  {
    id: "easy_name",
    kind: "easy",
    text: "Let's start easy. What's your name, and what's your business called?",
  },
  {
    id: "easy_what",
    kind: "easy",
    text: "What do you do for your customers? Describe it like you're telling a friend.",
  },
  {
    id: "think_change",
    kind: "thinking",
    text: "Here's one that takes some thought. If you could change one thing about how new customers find you, what would it be? Take all the time you need — I'm not going anywhere.",
  },
  {
    id: "think_story",
    kind: "thinking",
    text: "Last one. Think back to a customer you really helped. Walk me through what happened — and don't rush, thinking pauses are exactly what I'm here to learn.",
  },
];

// Stop phrases tested in the interruption step (mirrors the engine's
// barge-in commands).
export const STOP_TEST_PHRASES = ["stop", "wait", "hold on", "let me finish", "that's enough"];

function clampNum(value, [min, max], fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Does this transcript tail end with a continuation cue ("and", "but", …)? */
export function endsWithContinuationCue(text) {
  if (typeof text !== "string") return false;
  const norm = text
    .toLowerCase()
    .replace(/[^a-z' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!norm) return false;
  return CONTINUATION_CUES.some(
    (cue) => norm === cue || norm.endsWith(` ${cue}`),
  );
}

/**
 * Normalize/clamp a stored (or freshly recommended) profile. Returns null for
 * anything that isn't a usable profile object — null means "not calibrated"
 * and the engine falls back to the balanced defaults.
 */
export function clampProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  const style = PROFILE_PRESETS[profile.style] ? profile.style : "balanced";
  const preset = PROFILE_PRESETS[style];
  const out = {
    style,
    activePauseMs: clampNum(
      profile.activePauseMs,
      PROFILE_CLAMPS.activePauseMs,
      preset.activePauseMs,
    ),
    finalPauseMs: clampNum(
      profile.finalPauseMs,
      PROFILE_CLAMPS.finalPauseMs,
      preset.finalPauseMs,
    ),
    continuationExtraMs: clampNum(
      profile.continuationExtraMs,
      PROFILE_CLAMPS.continuationExtraMs,
      preset.continuationExtraMs,
    ),
    calibratedAt:
      typeof profile.calibratedAt === "string" && profile.calibratedAt
        ? profile.calibratedAt
        : null,
  };
  if (profile.stats && typeof profile.stats === "object") {
    const stats = {};
    for (const key of [
      "avgPauseMs",
      "maxPauseMs",
      "p90PauseMs",
      "wordsPerMin",
      "thinkingPauses",
      "continuationResumes",
      "answers",
    ]) {
      const raw = profile.stats[key];
      // Only persist real measurements — never fabricate a 0 for "unknown".
      // (typeof check matters: Number(null)/Number("") coerce to 0.)
      if (typeof raw !== "number") continue;
      if (Number.isFinite(raw) && raw >= 0) stats[key] = Math.round(raw);
    }
    const stop = profile.stats.stopTest;
    stats.stopTest = stop === "passed" || stop === "failed" ? stop : "skipped";
    out.stats = stats;
  }
  return out;
}

/** Engine timings for a (possibly null) profile — null → balanced defaults. */
export function timingsForProfile(profile) {
  const p = clampProfile(profile);
  if (!p) return { ...PROFILE_PRESETS.balanced };
  return {
    activePauseMs: p.activePauseMs,
    finalPauseMs: p.finalPauseMs,
    continuationExtraMs: p.continuationExtraMs,
  };
}

/**
 * Analyze one answer's speech-recognition events.
 * `events` = [{ at: msTimestamp, text: fullTranscriptSoFar }] in arrival
 * order (interim + final chunks alike — only timing and the transcript
 * snapshot matter).
 */
export function analyzeAnswer(events) {
  const list = Array.isArray(events)
    ? events.filter((e) => e && Number.isFinite(Number(e.at)))
    : [];
  const empty = {
    pauses: [],
    pauseCount: 0,
    avgPauseMs: null,
    maxPauseMs: null,
    thinkingPauses: 0,
    continuationResumes: 0,
    wordCount: 0,
    durationMs: 0,
    wordsPerMin: null,
  };
  if (list.length === 0) return empty;

  const pauses = [];
  let continuationResumes = 0;
  for (let i = 1; i < list.length; i += 1) {
    const gap = Number(list[i].at) - Number(list[i - 1].at);
    if (gap >= MIN_PAUSE_MS) {
      pauses.push(gap);
      // The speaker paused, then KEPT TALKING (this event exists). If the
      // text right before the pause ended on a continuation cue, that's the
      // pause-talk-pause rhythm we must not interrupt.
      if (endsWithContinuationCue(list[i - 1].text)) continuationResumes += 1;
    }
  }

  const lastText = typeof list[list.length - 1].text === "string" ? list[list.length - 1].text : "";
  const wordCount = lastText.trim() ? lastText.trim().split(/\s+/).length : 0;
  const durationMs = Number(list[list.length - 1].at) - Number(list[0].at);
  const pausedMs = pauses.reduce((a, b) => a + b, 0);
  const speakingMs = Math.max(1, durationMs - pausedMs);
  const wordsPerMin =
    wordCount > 0 && durationMs > 0 ? Math.round((wordCount / speakingMs) * 60000) : null;

  return {
    pauses,
    pauseCount: pauses.length,
    avgPauseMs: pauses.length
      ? Math.round(pausedMs / pauses.length)
      : null,
    maxPauseMs: pauses.length ? Math.max(...pauses) : null,
    thinkingPauses: pauses.filter((p) => p >= THINKING_PAUSE_MS).length,
    continuationResumes,
    wordCount,
    durationMs,
    wordsPerMin,
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

/** Aggregate the per-answer stats from the whole calibration conversation. */
export function summarizeAnswers(answerStats) {
  const list = Array.isArray(answerStats) ? answerStats.filter(Boolean) : [];
  const allPauses = list.flatMap((a) => a.pauses || []).sort((a, b) => a - b);
  const totalWords = list.reduce((n, a) => n + (a.wordCount || 0), 0);
  const wpmValues = list.filter((a) => Number.isFinite(a.wordsPerMin));
  const wordsPerMin = wpmValues.length
    ? Math.round(
        wpmValues.reduce((n, a) => n + a.wordsPerMin * (a.wordCount || 1), 0) /
          Math.max(
            1,
            wpmValues.reduce((n, a) => n + (a.wordCount || 1), 0),
          ),
      )
    : null;
  return {
    answers: list.length,
    totalWords,
    wordsPerMin,
    pauseCount: allPauses.length,
    avgPauseMs: allPauses.length
      ? Math.round(allPauses.reduce((a, b) => a + b, 0) / allPauses.length)
      : null,
    maxPauseMs: allPauses.length ? allPauses[allPauses.length - 1] : null,
    p90PauseMs: percentile(allPauses, 0.9),
    thinkingPauses: list.reduce((n, a) => n + (a.thinkingPauses || 0), 0),
    continuationResumes: list.reduce((n, a) => n + (a.continuationResumes || 0), 0),
  };
}

/**
 * Turn the calibration summary into a recommended profile. Deterministic:
 * end-of-turn wait ≈ the 90th-percentile real pause + a small margin, style
 * bucketed from that wait, continuation wait boosted when the speaker
 * actually uses trailing cue words.
 */
export function recommendProfile(summary, { stopTest = "skipped" } = {}) {
  const s = summary || {};
  // No measurable pauses → a talker who spits it right out.
  const basis = Number.isFinite(s.p90PauseMs)
    ? s.p90PauseMs
    : Number.isFinite(s.maxPauseMs)
      ? s.maxPauseMs
      : null;
  let activePauseMs;
  let style;
  if (basis === null) {
    style = "fast";
    activePauseMs = PROFILE_PRESETS.fast.activePauseMs;
  } else {
    activePauseMs = clampNum(basis + 250, PROFILE_CLAMPS.activePauseMs, 900);
    if (activePauseMs <= 800) style = "fast";
    else if (activePauseMs <= 1200) style = "balanced";
    else style = "patient";
  }
  const finalPauseMs = clampNum(
    Math.round(activePauseMs / 2),
    PROFILE_CLAMPS.finalPauseMs,
    PROFILE_PRESETS[style].finalPauseMs,
  );
  // Speakers who trail off on "and… but… so…" get a real continuation hold.
  const usesCues = (s.continuationResumes || 0) >= 1;
  const continuationExtraMs = usesCues
    ? clampNum(
        Math.max(Math.round(activePauseMs * 0.9), PROFILE_PRESETS[style].continuationExtraMs),
        PROFILE_CLAMPS.continuationExtraMs,
        PROFILE_PRESETS[style].continuationExtraMs,
      )
    : PROFILE_PRESETS[style].continuationExtraMs;

  return clampProfile({
    style,
    activePauseMs,
    finalPauseMs,
    continuationExtraMs,
    calibratedAt: new Date().toISOString(),
    stats: {
      avgPauseMs: s.avgPauseMs,
      maxPauseMs: s.maxPauseMs,
      p90PauseMs: s.p90PauseMs,
      wordsPerMin: s.wordsPerMin,
      thinkingPauses: s.thinkingPauses,
      continuationResumes: s.continuationResumes,
      answers: s.answers,
      stopTest,
    },
  });
}

/** Apply a style preset to an existing (or absent) profile, keeping stats. */
export function profileForStyle(style, existing) {
  const preset = PROFILE_PRESETS[style] ? style : "balanced";
  const base = clampProfile(existing) || {};
  return clampProfile({
    ...base,
    style: preset,
    ...PROFILE_PRESETS[preset],
    calibratedAt: base.calibratedAt || null,
  });
}

/** Plain-English summary lines for the calibration results screen. */
export function describeProfile(profile) {
  const p = clampProfile(profile);
  if (!p) return ["No voice profile yet — Echo is using the standard balanced timing."];
  const lines = [];
  const secs = (ms) => `${(ms / 1000).toFixed(1).replace(/\.0$/, "")} second${ms === 1000 ? "" : "s"}`;
  lines.push(
    `${STYLE_LABELS[p.style]} listener — Echo waits about ${secs(p.activePauseMs)} of silence before answering.`,
  );
  const st = p.stats || {};
  if (Number.isFinite(st.maxPauseMs)) {
    lines.push(`Your longest thinking pause was ${secs(st.maxPauseMs)} — Echo won't jump into pauses like that mid-thought.`);
  }
  if ((st.continuationResumes || 0) >= 1) {
    lines.push(
      'You often continue after words like "and" or "so" — Echo waits extra when you trail off that way.',
    );
  }
  if (Number.isFinite(st.wordsPerMin)) {
    lines.push(`You speak at roughly ${st.wordsPerMin} words a minute.`);
  }
  if (st.stopTest === "passed") {
    lines.push('The "stop" test passed — Echo halts the moment you cut in.');
  } else if (st.stopTest === "failed") {
    lines.push('The "stop" test didn\'t register — if Echo ever talks over you, say "Stop" firmly and it will halt.');
  }
  return lines;
}
