import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import VoicePlayer from "./VoicePlayer.jsx";
import { useVoice } from "./VoiceContext.jsx";

vi.mock("./VoiceContext.jsx", () => ({ useVoice: vi.fn() }));

function baseVoice(overrides = {}) {
  return {
    active: true,
    muted: false,
    playing: false,
    current: null,
    error: "",
    notice: "",
    needsGesture: false,
    suggestions: [],
    chunkPos: null,
    skipBack: vi.fn(),
    skipForward: vi.fn(),
    stopAll: vi.fn(),
    replay: vi.fn(),
    talkToEcho: vi.fn(),
    weeklyBriefing: vi.fn(),
    acceptSuggestion: vi.fn(),
    dismissSuggestion: vi.fn(),
    ...overrides,
  };
}

describe("VoicePlayer section navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows back/forward buttons flanking Stop while speaking", () => {
    useVoice.mockReturnValue(
      baseVoice({
        playing: true,
        current: { title: "Morning briefing", text: "Hello" },
        chunkPos: { index: 1, total: 5 },
      }),
    );
    render(<VoicePlayer />);
    const back = screen.getByLabelText("Back one section");
    const stop = screen.getByRole("button", { name: /stop/i });
    const forward = screen.getByLabelText("Forward one section");
    expect(back).toBeInTheDocument();
    expect(forward).toBeInTheDocument();
    expect(back.disabled).toBe(false);
    expect(forward.disabled).toBe(false);
    // Back sits before Stop, forward after it in the DOM row.
    const row = stop.parentElement;
    const kids = Array.from(row.children);
    expect(kids.indexOf(back)).toBeLessThan(kids.indexOf(stop));
    expect(kids.indexOf(forward)).toBeGreaterThan(kids.indexOf(stop));
    // Section counter reflects chunkPos.
    expect(screen.getByText("section 2 of 5")).toBeInTheDocument();
  });

  it("wires the buttons to skipBack/skipForward", () => {
    const voice = baseVoice({
      playing: true,
      current: { title: "Briefing", text: "Hi" },
      chunkPos: { index: 0, total: 3 },
    });
    useVoice.mockReturnValue(voice);
    render(<VoicePlayer />);
    screen.getByLabelText("Back one section").click();
    screen.getByLabelText("Forward one section").click();
    expect(voice.skipBack).toHaveBeenCalledTimes(1);
    expect(voice.skipForward).toHaveBeenCalledTimes(1);
  });

  it("disables back/forward when nothing is playing", () => {
    useVoice.mockReturnValue(
      baseVoice({ playing: false, current: { title: "Echo", text: "Done" } }),
    );
    render(<VoicePlayer />);
    expect(screen.getByLabelText("Back one section").disabled).toBe(true);
    expect(screen.getByLabelText("Forward one section").disabled).toBe(true);
  });
});
