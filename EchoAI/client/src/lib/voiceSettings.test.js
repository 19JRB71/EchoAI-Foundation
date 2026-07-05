import { describe, it, expect } from "vitest";
import { chunkForSpeech } from "./voiceSettings.js";

describe("chunkForSpeech", () => {
  it("returns [] for empty/blank input", () => {
    expect(chunkForSpeech("")).toEqual([]);
    expect(chunkForSpeech("   ")).toEqual([]);
    expect(chunkForSpeech(null)).toEqual([]);
    expect(chunkForSpeech(undefined)).toEqual([]);
  });

  it("keeps the first chunk short for fast time-to-first-audio", () => {
    const text =
      "Good morning, Alex. You have 3 new hot leads waiting in the queue. " +
      "Revenue is up 12 percent this week compared to last week. " +
      "Two campaigns are pacing low on budget and may need attention today.";
    const chunks = chunkForSpeech(text);
    expect(chunks.length).toBeGreaterThan(1);
    // First chunk stays under the firstMax cap and opens with the greeting.
    expect(chunks[0].length).toBeLessThanOrEqual(120);
    expect(chunks[0].startsWith("Good morning, Alex.")).toBe(true);
  });

  it("preserves the full text across chunks (order + content)", () => {
    const text =
      "One sentence here. Two sentence here. Three sentence here. Four here.";
    const chunks = chunkForSpeech(text);
    // Rejoining chunks reconstructs the normalized sentence stream.
    expect(chunks.join(" ")).toBe(text);
  });

  it("groups later sentences up to the max cap", () => {
    const text =
      "Alpha. Bravo. Charlie. Delta. Echo. Foxtrot. Golf. Hotel. India.";
    const chunks = chunkForSpeech(text, { firstMax: 20, max: 40 });
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(40);
    expect(chunks.join(" ")).toBe(text);
  });

  it("handles a single unpunctuated string as one chunk", () => {
    expect(chunkForSpeech("hello world")).toEqual(["hello world"]);
  });

  it("collapses whitespace/newlines", () => {
    const chunks = chunkForSpeech("Hello there.\n\n  How are you?");
    expect(chunks.join(" ")).toBe("Hello there. How are you?");
  });
});
