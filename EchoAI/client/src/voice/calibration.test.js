import { describe, it, expect } from "vitest";
import {
  PROFILE_PRESETS,
  PROFILE_CLAMPS,
  CALIBRATION_QUESTIONS,
  endsWithContinuationCue,
  clampProfile,
  timingsForProfile,
  analyzeAnswer,
  summarizeAnswers,
  recommendProfile,
  profileForStyle,
  describeProfile,
  MIN_PAUSE_MS,
} from "./calibration.js";

// Build recognition events: speech bursts separated by explicit gaps.
// Each burst adds words to the running transcript with sub-pause spacing.
function makeEvents(bursts) {
  const events = [];
  let at = 1000;
  let text = "";
  bursts.forEach(({ words, gapAfterMs }, idx) => {
    words.split(" ").forEach((w, i) => {
      text = `${text} ${w}`.trim();
      if (i > 0) at += 200; // talking: events well under MIN_PAUSE_MS apart
      events.push({ at, text });
    });
    if (idx < bursts.length - 1) at += gapAfterMs;
  });
  return events;
}

describe("endsWithContinuationCue", () => {
  it("matches trailing cue words and phrases, with punctuation noise", () => {
    expect(endsWithContinuationCue("we do roofing and")).toBe(true);
    expect(endsWithContinuationCue("I was thinking, um…")).toBe(true);
    expect(endsWithContinuationCue("it started slow but, you know")).toBe(true);
    expect(endsWithContinuationCue("So")).toBe(true);
  });
  it("does not match cue words mid-sentence or non-strings", () => {
    expect(endsWithContinuationCue("so we fixed the roof")).toBe(false);
    expect(endsWithContinuationCue("brand new customers")).toBe(false);
    expect(endsWithContinuationCue("")).toBe(false);
    expect(endsWithContinuationCue(null)).toBe(false);
  });
  it("does not treat words that merely END in a cue as a cue (and/band)", () => {
    expect(endsWithContinuationCue("we hired a band")).toBe(false);
    expect(endsWithContinuationCue("that was fun")).toBe(false);
  });
});

describe("clampProfile", () => {
  it("returns null for junk (null = not calibrated)", () => {
    expect(clampProfile(null)).toBe(null);
    expect(clampProfile("patient")).toBe(null);
    expect(clampProfile(42)).toBe(null);
  });
  it("clamps out-of-range timings so a corrupt profile can't wedge the engine", () => {
    const p = clampProfile({ style: "patient", activePauseMs: 60000, finalPauseMs: 1, continuationExtraMs: -5 });
    expect(p.activePauseMs).toBe(PROFILE_CLAMPS.activePauseMs[1]);
    expect(p.finalPauseMs).toBe(PROFILE_CLAMPS.finalPauseMs[0]);
    expect(p.continuationExtraMs).toBe(0);
  });
  it("falls back to balanced style + preset timings on unknown style / NaN timings", () => {
    const p = clampProfile({ style: "turbo", activePauseMs: "abc" });
    expect(p.style).toBe("balanced");
    expect(p.activePauseMs).toBe(PROFILE_PRESETS.balanced.activePauseMs);
  });
  it("sanitizes stats — never fabricates numbers, keeps stopTest enum", () => {
    const p = clampProfile({
      style: "fast",
      stats: { avgPauseMs: null, maxPauseMs: 1800.6, wordsPerMin: NaN, stopTest: "banana" },
    });
    expect(p.stats.avgPauseMs).toBeUndefined();
    expect(p.stats.maxPauseMs).toBe(1801);
    expect(p.stats.wordsPerMin).toBeUndefined();
    expect(p.stats.stopTest).toBe("skipped");
  });
});

describe("timingsForProfile", () => {
  it("null profile → balanced defaults (matches the engine's historic constants)", () => {
    expect(timingsForProfile(null)).toEqual(PROFILE_PRESETS.balanced);
    expect(timingsForProfile(undefined).activePauseMs).toBe(900);
  });
  it("returns the profile's clamped timings", () => {
    const t = timingsForProfile({ style: "patient", activePauseMs: 1800, finalPauseMs: 900, continuationExtraMs: 1500 });
    expect(t).toEqual({ activePauseMs: 1800, finalPauseMs: 900, continuationExtraMs: 1500 });
  });
});

describe("analyzeAnswer", () => {
  it("returns the empty shape (nulls, not zeros) for no events", () => {
    const a = analyzeAnswer([]);
    expect(a.pauseCount).toBe(0);
    expect(a.avgPauseMs).toBe(null);
    expect(a.maxPauseMs).toBe(null);
    expect(a.wordsPerMin).toBe(null);
  });
  it("finds pauses between speech bursts and ignores normal talking gaps", () => {
    const a = analyzeAnswer(
      makeEvents([
        { words: "we do custom roofing", gapAfterMs: 1500 },
        { words: "mostly residential", gapAfterMs: 0 },
      ]),
    );
    expect(a.pauseCount).toBe(1);
    expect(a.maxPauseMs).toBeGreaterThanOrEqual(1500);
    expect(a.thinkingPauses).toBe(1);
    expect(a.wordCount).toBe(6);
  });
  it("counts continuation resumes when a pause follows a trailing cue word", () => {
    const a = analyzeAnswer(
      makeEvents([
        { words: "we started in Tampa and", gapAfterMs: 1400 },
        { words: "then we grew but", gapAfterMs: 2000 },
        { words: "it worked out", gapAfterMs: 0 },
      ]),
    );
    expect(a.pauseCount).toBe(2);
    expect(a.continuationResumes).toBe(2);
  });
  it("short sub-threshold gaps are not pauses", () => {
    const a = analyzeAnswer(
      makeEvents([{ words: "quick answer no pauses at all", gapAfterMs: 0 }]),
    );
    expect(a.pauseCount).toBe(0);
    expect(a.continuationResumes).toBe(0);
  });
});

describe("summarizeAnswers + recommendProfile", () => {
  it("a fast talker with no pauses gets the fast preset", () => {
    const stats = [analyzeAnswer(makeEvents([{ words: "we sell pools that is it", gapAfterMs: 0 }]))];
    const rec = recommendProfile(summarizeAnswers(stats));
    expect(rec.style).toBe("fast");
    expect(rec.activePauseMs).toBe(PROFILE_PRESETS.fast.activePauseMs);
    expect(rec.calibratedAt).toBeTruthy();
  });
  it("a pause-talk-pause thinker gets patient timing sized to their real pauses", () => {
    const stats = [
      analyzeAnswer(
        makeEvents([
          { words: "well let me think and", gapAfterMs: 2200 },
          { words: "I guess the main thing so", gapAfterMs: 1900 },
          { words: "yeah word of mouth", gapAfterMs: 0 },
        ]),
      ),
    ];
    const summary = summarizeAnswers(stats);
    const rec = recommendProfile(summary, { stopTest: "passed" });
    expect(rec.style).toBe("patient");
    // End-of-turn wait covers their p90 pause (+margin), clamped to bounds.
    expect(rec.activePauseMs).toBeGreaterThanOrEqual(summary.p90PauseMs);
    expect(rec.activePauseMs).toBeLessThanOrEqual(PROFILE_CLAMPS.activePauseMs[1]);
    expect(rec.continuationExtraMs).toBeGreaterThanOrEqual(PROFILE_PRESETS.patient.continuationExtraMs);
    expect(rec.stats.stopTest).toBe("passed");
    expect(rec.stats.continuationResumes).toBe(2);
  });
  it("moderate pauses land on balanced", () => {
    const stats = [
      analyzeAnswer(
        makeEvents([
          { words: "we do lawn care", gapAfterMs: 800 },
          { words: "and some landscaping", gapAfterMs: 0 },
        ]),
      ),
    ];
    const rec = recommendProfile(summarizeAnswers(stats));
    expect(rec.style).toBe("balanced");
  });
  it("summary aggregates pauses across answers", () => {
    const s = summarizeAnswers([
      analyzeAnswer(makeEvents([{ words: "one two", gapAfterMs: 1200 }, { words: "three", gapAfterMs: 0 }])),
      analyzeAnswer(makeEvents([{ words: "four five", gapAfterMs: 700 }, { words: "six", gapAfterMs: 0 }])),
    ]);
    expect(s.answers).toBe(2);
    expect(s.pauseCount).toBe(2);
    expect(s.maxPauseMs).toBeGreaterThanOrEqual(1200);
  });
});

describe("profileForStyle", () => {
  it("applies preset timings while keeping measured stats + calibratedAt", () => {
    const calibrated = recommendProfile(
      summarizeAnswers([
        analyzeAnswer(makeEvents([{ words: "hm and", gapAfterMs: 2000 }, { words: "done", gapAfterMs: 0 }])),
      ]),
    );
    const switched = profileForStyle("fast", calibrated);
    expect(switched.style).toBe("fast");
    expect(switched.activePauseMs).toBe(PROFILE_PRESETS.fast.activePauseMs);
    expect(switched.calibratedAt).toBe(calibrated.calibratedAt);
    expect(switched.stats).toEqual(calibrated.stats);
  });
  it("unknown style falls back to balanced", () => {
    expect(profileForStyle("zoom", null).style).toBe("balanced");
  });
});

describe("describeProfile", () => {
  it("uncalibrated → standard-timing line", () => {
    expect(describeProfile(null)[0]).toMatch(/standard balanced timing/i);
  });
  it("mentions style, thinking pause, continuation habit, and stop test", () => {
    const lines = describeProfile({
      style: "patient",
      activePauseMs: 1800,
      stats: { maxPauseMs: 2400, continuationResumes: 3, wordsPerMin: 130, stopTest: "passed" },
    }).join("\n");
    expect(lines).toMatch(/Patient Listener/);
    expect(lines).toMatch(/longest thinking pause/i);
    expect(lines).toMatch(/"and" or "so"/);
    expect(lines).toMatch(/130 words a minute/);
    expect(lines).toMatch(/stop.*test passed/i);
  });
});

describe("calibration questions", () => {
  it("mixes easy and thinking questions (James's pause-talk-pause design)", () => {
    const kinds = CALIBRATION_QUESTIONS.map((q) => q.kind);
    expect(kinds).toContain("easy");
    expect(kinds).toContain("thinking");
    expect(CALIBRATION_QUESTIONS.length).toBeGreaterThanOrEqual(3);
  });
});

describe("constants sanity", () => {
  it("balanced preset equals the engine's historic fixed timings", () => {
    expect(PROFILE_PRESETS.balanced.activePauseMs).toBe(900);
    expect(PROFILE_PRESETS.balanced.finalPauseMs).toBe(450);
  });
  it("MIN_PAUSE_MS sits above normal talking-gap spacing", () => {
    expect(MIN_PAUSE_MS).toBeGreaterThan(400);
  });
});
