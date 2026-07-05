import { describe, it, expect } from "vitest";
import {
  normalizeSpeech,
  parseWakeWord,
  isQuestion,
  matchLocalIntent,
  matchNavIntent,
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
    expect(matchNavIntent("open my leads")).toBe("leads");
    expect(matchNavIntent("take me to social media")).toBe("social");
    expect(matchNavIntent("show me the reputation page")).toBe("reputation");
    expect(matchNavIntent("go to settings")).toBe("settings");
  });

  it("routes SEO/Google commands to the real 'googleseo' section id", () => {
    // Guards against key drift: the app section is "googleseo", not "seo".
    expect(matchNavIntent("take me to seo")).toBe("googleseo");
    expect(matchNavIntent("open google")).toBe("googleseo");
  });

  it("requires an explicit navigation verb", () => {
    // Informational questions must fall through to Echo, not navigate.
    expect(matchNavIntent("what are my leads today")).toBe(null);
    expect(matchNavIntent("how is my reputation")).toBe(null);
  });

  it("returns null when no known section is named", () => {
    expect(matchNavIntent("show me the competitor report")).toBe(null);
    expect(matchNavIntent("")).toBe(null);
  });
});
