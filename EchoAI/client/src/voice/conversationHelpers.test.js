import { describe, it, expect } from "vitest";
import {
  normalizeSpeech,
  parseWakeWord,
  isQuestion,
  matchLocalIntent,
  matchNavIntent,
  navConfirmation,
} from "./conversationHelpers.js";

describe("normalizeSpeech", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeSpeech("  Hey,  ECHO!!  ")).toBe("hey echo");
    expect(normalizeSpeech(null)).toBe("");
  });
});

describe("parseWakeWord", () => {
  it("detects the wake phrase and returns a trailing command", () => {
    const r = parseWakeWord("Hey Echo, what are my leads today?");
    expect(r.matched).toBe(true);
    expect(r.command).toBe("what are my leads today");
  });

  it("matches with no trailing command", () => {
    const r = parseWakeWord("hey echo");
    expect(r.matched).toBe(true);
    expect(r.command).toBe("");
  });

  it("tolerates common mishearings", () => {
    expect(parseWakeWord("hey eco").matched).toBe(true);
    expect(parseWakeWord("hay echo there").matched).toBe(true);
    expect(parseWakeWord("hi echo").matched).toBe(true);
  });

  it("does NOT trigger on a bare 'echo' without the leading hey", () => {
    expect(parseWakeWord("the echo of the room was loud").matched).toBe(false);
    expect(parseWakeWord("please echo that back").matched).toBe(false);
  });

  it("matches the phrase mid-utterance", () => {
    const r = parseWakeWord("okay so hey echo book me a meeting");
    expect(r.matched).toBe(true);
    expect(r.command).toBe("book me a meeting");
  });
});

describe("isQuestion", () => {
  it("is true only when the reply ends with a question mark", () => {
    expect(isQuestion("What should we do next?")).toBe(true);
    expect(isQuestion("Here is your summary.")).toBe(false);
    expect(isQuestion("Ready when you are.  ")).toBe(false);
    expect(isQuestion("")).toBe(false);
  });
});

describe("matchLocalIntent", () => {
  it("recognizes mute intents", () => {
    expect(matchLocalIntent("mute yourself")).toBe("mute");
    expect(matchLocalIntent("Echo, go quiet")).toBe("mute");
    expect(matchLocalIntent("stop listening please")).toBe("mute");
  });

  it("recognizes patience intents", () => {
    expect(matchLocalIntent("give me a minute")).toBe("patience");
    expect(matchLocalIntent("hold on")).toBe("patience");
    expect(matchLocalIntent("let me think")).toBe("patience");
    expect(matchLocalIntent("one sec")).toBe("patience");
  });

  it("returns null for ordinary commands", () => {
    expect(matchLocalIntent("what are my leads")).toBe(null);
    expect(matchLocalIntent("")).toBe(null);
  });
});

describe("matchNavIntent", () => {
  it("maps 'take me to <section>' commands to section ids", () => {
    expect(matchNavIntent("show me my leads")).toBe("leads");
    expect(matchNavIntent("go to leads")).toBe("leads");
    expect(matchNavIntent("show me the reputation page")).toBe("reputation");
    expect(matchNavIntent("go to settings")).toBe("settings");
    expect(matchNavIntent("show me the portfolio")).toBe("portfolio");
  });

  it("routes department commands to 'dept:<agent>' keys (name or alias)", () => {
    expect(matchNavIntent("go to atlas")).toBe("dept:atlas");
    expect(matchNavIntent("show me campaigns")).toBe("dept:atlas");
    expect(matchNavIntent("show me scout")).toBe("dept:scout");
    expect(matchNavIntent("competitor report")).toBe("dept:scout");
    expect(matchNavIntent("go to nova")).toBe("dept:nova");
    expect(matchNavIntent("social media")).toBe("dept:nova");
    expect(matchNavIntent("show me pulse")).toBe("dept:pulse");
    expect(matchNavIntent("go to crm")).toBe("dept:pulse");
  });

  it("sends 'mission control' / 'go home' to the home section", () => {
    expect(matchNavIntent("mission control")).toBe("missioncontrol");
    expect(matchNavIntent("go home")).toBe("missioncontrol");
  });

  it("routes SEO/Google commands to the real 'googleseo' section id", () => {
    // Guards against key drift: the app section is "googleseo", not "seo".
    expect(matchNavIntent("take me to seo")).toBe("googleseo");
    expect(matchNavIntent("open google")).toBe("googleseo");
  });

  it("requires a verb for questionable targets and skips clear questions", () => {
    // Verb-required sections must fall through to Echo without a verb.
    expect(matchNavIntent("what are my leads today")).toBe(null);
    expect(matchNavIntent("how is my reputation")).toBe(null);
    // Even a standalone-capable target must not hijack a question.
    expect(matchNavIntent("how is my social media doing")).toBe(null);
    expect(matchNavIntent("what does the competitor report say")).toBe(null);
    expect(matchNavIntent("")).toBe(null);
  });

  it("does not fire on a bare 'social' that isn't 'social media'", () => {
    // Nova is only reachable via "social media" (or "nova"), not any "social".
    expect(matchNavIntent("share this on social")).toBe(null);
    expect(matchNavIntent("go to my social accounts")).toBe(null);
  });
});

describe("navConfirmation", () => {
  it("speaks a section-specific confirmation that is never a question", () => {
    expect(navConfirmation("leads")).toBe("Opening your leads now.");
    expect(navConfirmation("portfolio")).toBe("Opening your portfolio now.");
    expect(navConfirmation("missioncontrol")).toBe(
      "Taking you back to Mission Control.",
    );
    expect(isQuestion(navConfirmation("leads"))).toBe(false);
  });

  it("names the department for 'dept:<agent>' keys", () => {
    expect(navConfirmation("dept:atlas")).toBe("Taking you to Atlas.");
    expect(navConfirmation("dept:nova")).toBe("Taking you to Nova.");
    expect(navConfirmation(null)).toBe("Here you go.");
  });
});
