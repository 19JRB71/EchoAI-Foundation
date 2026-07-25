/**
 * Voice flight recorder — the in-memory diagnostic log the owner copies when
 * Echo misbehaves on the live site. The report must tell the story faithfully
 * (every event, in order, with what was heard/said) and the recorder must
 * never grow without bound or throw on garbage input.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  recordVoiceEvent,
  getVoiceEvents,
  clearVoiceEvents,
  buildVoiceReport,
} from "./flightRecorder.js";

describe("flightRecorder", () => {
  beforeEach(() => {
    clearVoiceEvents();
  });

  it("records events in order with type and detail", () => {
    recordVoiceEvent("echo-speaks", { text: "Good morning, Sir" });
    recordVoiceEvent("heard", { text: "open my leads", gated: false });
    const events = getVoiceEvents();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("echo-speaks");
    expect(events[0].detail.text).toBe("Good morning, Sir");
    expect(events[1].type).toBe("heard");
    expect(events[1].at).toBeGreaterThanOrEqual(events[0].at);
  });

  it("caps the buffer as a ring: oldest events fall off, newest survive", () => {
    for (let i = 0; i < 450; i += 1) {
      recordVoiceEvent("heard", { text: `phrase ${i}` });
    }
    const events = getVoiceEvents();
    expect(events.length).toBe(400);
    expect(events[0].detail.text).toBe("phrase 50");
    expect(events[events.length - 1].detail.text).toBe("phrase 449");
  });

  it("never throws on garbage input and copies detail defensively", () => {
    expect(() => recordVoiceEvent(null, null)).not.toThrow();
    expect(() => recordVoiceEvent(undefined, "not-an-object")).not.toThrow();
    const mutable = { text: "before" };
    recordVoiceEvent("heard", mutable);
    mutable.text = "after";
    const events = getVoiceEvents();
    expect(events[events.length - 1].detail.text).toBe("before");
  });

  it("buildVoiceReport includes the heard/spoken text and decision flags", () => {
    recordVoiceEvent("echo-speaks", { text: "Want me to pull that up?" });
    recordVoiceEvent("dropped-as-echo-of-self", {
      heard: "want me to pull that up",
      gated: false,
      msSinceEchoStopped: 4200,
    });
    recordVoiceEvent("command-processing", { text: "open my calendar" });
    const report = buildVoiceReport();
    expect(report).toContain("Echo voice diagnostic report");
    expect(report).toContain('text="Want me to pull that up?"');
    expect(report).toContain("dropped-as-echo-of-self");
    expect(report).toContain('heard="want me to pull that up"');
    expect(report).toContain("msSinceEchoStopped=4200");
    expect(report).toContain('text="open my calendar"');
  });

  it("buildVoiceReport on an empty log is honest, not broken", () => {
    const report = buildVoiceReport();
    expect(report).toContain("no voice activity recorded yet");
  });

  it("clearVoiceEvents empties the log", () => {
    recordVoiceEvent("heard", { text: "hello" });
    clearVoiceEvents();
    expect(getVoiceEvents()).toHaveLength(0);
  });
});
