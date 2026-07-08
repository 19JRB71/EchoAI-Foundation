import { describe, it, expect, beforeEach } from "vitest";
import {
  pickVariant,
  _resetVariety,
  maybeFlourish,
  interruptAck,
  standbyGreeting,
  musicReadyLine,
  clarifyQuestion,
  briefingChoiceQuestion,
  goQuietLine,
  takeYourTimeLine,
  tackleFirstQuestion,
  musicAck,
  INTERRUPT_ACKS,
  STANDBY_GREETINGS,
  MUSIC_READY_LINES,
  CLARIFY_QUESTIONS,
  BRIEFING_CHOICE_QUESTIONS,
  GO_QUIET_LINES,
  TAKE_YOUR_TIME_LINES,
  TACKLE_FIRST_QUESTIONS,
  MUSIC_REPLIES,
  NAV_CONFIRM_TEMPLATES,
  DEPT_CONFIRM_TEMPLATES,
  NAV_OFFER_TEMPLATES,
  DEPT_OFFER_TEMPLATES,
} from "./phraseVariety.js";

beforeEach(() => _resetVariety());

describe("variation pools", () => {
  it("every category has at least 5 variations", () => {
    const pools = [
      INTERRUPT_ACKS,
      ...Object.values(STANDBY_GREETINGS),
      MUSIC_READY_LINES,
      CLARIFY_QUESTIONS,
      BRIEFING_CHOICE_QUESTIONS,
      GO_QUIET_LINES,
      TAKE_YOUR_TIME_LINES,
      TACKLE_FIRST_QUESTIONS,
      NAV_CONFIRM_TEMPLATES,
      DEPT_CONFIRM_TEMPLATES,
      NAV_OFFER_TEMPLATES,
      DEPT_OFFER_TEMPLATES,
      ...Object.values(MUSIC_REPLIES),
    ];
    for (const pool of pools) expect(pool.length).toBeGreaterThanOrEqual(5);
  });

  it("no pool contains duplicate entries", () => {
    for (const pool of [INTERRUPT_ACKS, ...Object.values(STANDBY_GREETINGS), MUSIC_READY_LINES, CLARIFY_QUESTIONS, GO_QUIET_LINES]) {
      expect(new Set(pool).size).toBe(pool.length);
    }
  });
});

describe("pickVariant", () => {
  it("never returns the same variant twice in a row", () => {
    const pool = ["a", "b", "c", "d", "e"];
    let prev = pickVariant("t", pool);
    for (let i = 0; i < 100; i++) {
      const next = pickVariant("t", pool);
      expect(next).not.toBe(prev);
      prev = next;
    }
  });

  it("eventually uses every variant in the pool", () => {
    const pool = ["a", "b", "c", "d", "e"];
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(pickVariant("u", pool));
    expect(seen.size).toBe(pool.length);
  });

  it("tracks rotation independently per category", () => {
    const pool = ["x", "y"];
    pickVariant("cat1", pool);
    // cat2 is unconstrained by cat1's last pick — just must not throw.
    expect(pool).toContain(pickVariant("cat2", pool));
  });

  it("handles degenerate pools safely", () => {
    expect(pickVariant("d", [])).toBe("");
    expect(pickVariant("d", ["only"])).toBe("only");
    expect(pickVariant("d", ["only"])).toBe("only");
  });
});

describe("convenience pickers", () => {
  it("each picker returns a member of its pool", () => {
    expect(INTERRUPT_ACKS).toContain(interruptAck());
    expect(STANDBY_GREETINGS.morning).toContain(standbyGreeting());
    // Time-of-day aware standby greetings pull from the matching pool only.
    for (const part of ["morning", "afternoon", "evening", "late"]) {
      expect(STANDBY_GREETINGS[part]).toContain(standbyGreeting(part));
    }
    // Unknown part falls back to the morning pool, never throws.
    expect(STANDBY_GREETINGS.morning).toContain(standbyGreeting("nonsense"));
    expect(MUSIC_READY_LINES).toContain(musicReadyLine());
    expect(CLARIFY_QUESTIONS).toContain(clarifyQuestion());
    expect(BRIEFING_CHOICE_QUESTIONS).toContain(briefingChoiceQuestion());
    expect(GO_QUIET_LINES).toContain(goQuietLine());
    expect(TAKE_YOUR_TIME_LINES).toContain(takeYourTimeLine());
    expect(TACKLE_FIRST_QUESTIONS).toContain(tackleFirstQuestion());
  });

  it("questions stay questions across all variants", () => {
    for (const q of [...CLARIFY_QUESTIONS, ...BRIEFING_CHOICE_QUESTIONS, ...TACKLE_FIRST_QUESTIONS]) {
      expect(q.trim().endsWith("?")).toBe(true);
    }
  });

  it("statements never end in a question mark (won't hijack follow-up)", () => {
    // Morning standby greetings are statements; afternoon/evening/late ones
    // deliberately ASK ("quick update or save the briefing?") so they're exempt.
    for (const s of [...INTERRUPT_ACKS, ...STANDBY_GREETINGS.morning, ...MUSIC_READY_LINES, ...GO_QUIET_LINES]) {
      expect(s.trim().endsWith("?")).toBe(false);
    }
  });

  it("time-of-day greetings never use the wrong time of day", () => {
    for (const s of [...STANDBY_GREETINGS.afternoon, ...STANDBY_GREETINGS.evening, ...STANDBY_GREETINGS.late]) {
      expect(/good morning|^morning|rise and shine/i.test(s)).toBe(false);
    }
    for (const s of STANDBY_GREETINGS.morning) {
      expect(/good afternoon|good evening|working late/i.test(s)).toBe(false);
    }
    for (const s of STANDBY_GREETINGS.afternoon) expect(s).toMatch(/^Good afternoon/);
    for (const s of STANDBY_GREETINGS.late) expect(s).toMatch(/^Working late/);
  });
});

describe("musicAck", () => {
  it("covers every music action with a non-empty varied line", () => {
    expect(musicAck({ action: "play", value: "jazz" })).toMatch(/jazz/i);
    expect(musicAck({ action: "play", value: "" }).length).toBeGreaterThan(0);
    expect(musicAck({ action: "favorites", index: 0 }).length).toBeGreaterThan(0);
    expect(musicAck({ action: "favorites", index: 2 })).toMatch(/3/);
    for (const action of ["pause", "resume", "skip", "stop"]) {
      expect(musicAck({ action }).length).toBeGreaterThan(0);
    }
    expect(musicAck({ action: "volume", value: "down" }).length).toBeGreaterThan(0);
    expect(musicAck({ action: "volume", value: "up" }).length).toBeGreaterThan(0);
    expect(musicAck({ action: "???" }).length).toBeGreaterThan(0);
  });

  it("rotates skip acknowledgements without back-to-back repeats", () => {
    let prev = musicAck({ action: "skip" });
    for (let i = 0; i < 25; i++) {
      const next = musicAck({ action: "skip" });
      expect(next).not.toBe(prev);
      prev = next;
    }
  });
});

describe("maybeFlourish", () => {
  it("never touches questions", () => {
    expect(maybeFlourish("Want the rundown?", 1)).toBe("Want the rundown?");
  });

  it("appends a flourish when chance fires, keeps base text intact", () => {
    const out = maybeFlourish("Opening your leads now.", 1);
    expect(out.startsWith("Opening your leads now.")).toBe(true);
    expect(out.length).toBeGreaterThan("Opening your leads now.".length);
    expect(out.trim().endsWith("?")).toBe(false);
  });

  it("stays silent when chance is zero", () => {
    expect(maybeFlourish("On it Sir.", 0)).toBe("On it Sir.");
  });
});

import { matchInterruptIntent } from "./conversationHelpers.js";

describe("Echo's own varied lines can never self-interrupt", () => {
  it("no variant in any spoken pool matches the interrupt matcher", () => {
    const spoken = [
      ...INTERRUPT_ACKS,
      ...Object.values(STANDBY_GREETINGS).flat(),
      ...MUSIC_READY_LINES,
      ...CLARIFY_QUESTIONS,
      ...BRIEFING_CHOICE_QUESTIONS,
      ...GO_QUIET_LINES,
      ...TAKE_YOUR_TIME_LINES,
      ...TACKLE_FIRST_QUESTIONS,
      ...MUSIC_REPLIES.playGeneric,
      ...MUSIC_REPLIES.favoritesStart,
      ...MUSIC_REPLIES.pause,
      ...MUSIC_REPLIES.resume,
      ...MUSIC_REPLIES.skip,
      ...MUSIC_REPLIES.stop,
      ...MUSIC_REPLIES.volumeDown,
      ...MUSIC_REPLIES.volumeUp,
      ...MUSIC_REPLIES.done,
      ...NAV_CONFIRM_TEMPLATES.map((t) => t("your leads")),
      ...DEPT_CONFIRM_TEMPLATES.map((t) => t("Atlas")),
    ];
    for (const line of spoken) {
      expect(matchInterruptIntent(line)).toBe(false);
    }
  });
});
