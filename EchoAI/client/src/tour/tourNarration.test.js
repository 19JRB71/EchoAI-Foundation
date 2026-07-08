// Narration coverage + tone tests: every tour step has a spoken script, the
// scripts address the owner as "Sir" where it matters, and the rotating pools
// (greeting / ready prompt / stop ack) vary and never repeat back-to-back.

import { describe, it, expect, beforeEach } from "vitest";
import { buildTour } from "./tourSteps.js";
import {
  tourGreeting,
  narrationForStep,
  readyPrompt,
  stopAck,
} from "./tourNarration.js";
import { _resetVariety } from "../voice/phraseVariety.js";

beforeEach(() => {
  _resetVariety();
});

describe("narrationForStep", () => {
  const tourTypes = ["starter", "pro", "enterprise", "admin"];

  it.each(tourTypes)("has non-empty narration for every %s step", (type) => {
    const steps = buildTour(type);
    expect(steps.length).toBeGreaterThan(0);
    for (let i = 0; i < steps.length; i += 1) {
      const text = narrationForStep(steps[i], i);
      expect(text, `step ${steps[i].id}`).toBeTruthy();
      expect(text.length, `step ${steps[i].id}`).toBeGreaterThan(40);
    }
  });

  it("introduces Atlas as the Advertising Manager on the campaigns step", () => {
    const steps = buildTour("starter");
    const campaigns = steps.find((s) => s.id === "campaigns");
    const text = narrationForStep(campaigns, 3);
    expect(text).toMatch(/Atlas, your Advertising Manager/);
  });

  it("addresses the owner as Sir throughout the starter tour", () => {
    const steps = buildTour("starter");
    const all = steps.map((s, i) => narrationForStep(s, i)).join(" ");
    expect(all).toMatch(/\bSir\b/);
    // The vast majority of steps speak directly to the owner.
    const withSir = steps.filter((s, i) => /\bSir\b/.test(narrationForStep(s, i)));
    expect(withSir.length).toBeGreaterThanOrEqual(steps.length - 2);
  });

  it("prefixes a transition on later steps but not the first", () => {
    const steps = buildTour("starter");
    const first = narrationForStep(steps[0], 0);
    expect(first.startsWith("This is your command center")).toBe(true);
    const second = narrationForStep(steps[1], 1);
    expect(second.length).toBeGreaterThan(narrationForStep(steps[1], 0).length);
  });

  it("falls back to title + body for unknown step ids", () => {
    const text = narrationForStep(
      { id: "brand-new-step", title: "New thing", body: "It does new stuff." },
      0,
    );
    expect(text).toBe("New thing. It does new stuff.");
  });

  it("returns empty for a missing step", () => {
    expect(narrationForStep(null, 0)).toBe("");
  });
});

describe("rotating pools", () => {
  it("never repeats the same greeting twice in a row", () => {
    let prev = tourGreeting();
    for (let i = 0; i < 20; i += 1) {
      const cur = tourGreeting();
      expect(cur).not.toBe(prev);
      prev = cur;
    }
  });

  it("ready prompts ask about continuing and address Sir", () => {
    for (let i = 0; i < 10; i += 1) {
      const p = readyPrompt();
      expect(p).toMatch(/\bSir\b/);
      expect(p.endsWith("?") || /say yes/i.test(p)).toBe(true);
    }
  });

  it("stop acks vary and never repeat back-to-back", () => {
    let prev = stopAck();
    for (let i = 0; i < 20; i += 1) {
      const cur = stopAck();
      expect(cur).not.toBe(prev);
      prev = cur;
    }
  });
});
