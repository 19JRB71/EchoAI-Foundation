import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import CoreHero from "./CoreHero.jsx";

// The button under the Zorecho Core is a pure mute/unmute toggle. Muting stops
// speech (voice.toggleMute → stopAll) AND stops hands-free listening
// (conv.toggleMic); unmuting restores both.
const mockConv = vi.hoisted(() => ({ current: null }));
const mockVoice = vi.hoisted(() => ({ current: null }));
vi.mock("../voice/EchoConversationContext.jsx", () => ({
  useEchoConversation: () => mockConv.current,
}));
vi.mock("../voice/VoiceContext.jsx", () => ({
  useVoice: () => mockVoice.current,
}));

function renderHero() {
  return render(
    <CoreHero agents={[]} onOpenDepartment={() => {}} statusLine="" healthy />,
  );
}

afterEach(() => {
  cleanup();
  mockConv.current = null;
  mockVoice.current = null;
});

describe("CoreHero Echo mute toggle", () => {
  it("unmuted click mutes speaker AND mic", () => {
    const toggleMute = vi.fn();
    const toggleMic = vi.fn();
    mockVoice.current = { muted: false, toggleMute };
    mockConv.current = { supported: true, micEnabled: true, muted: false, toggleMic };
    renderHero();
    fireEvent.click(screen.getByTestId("talk-to-echo"));
    expect(toggleMute).toHaveBeenCalledTimes(1);
    expect(toggleMic).toHaveBeenCalledTimes(1);
  });

  it("muted click unmutes speaker AND mic", () => {
    const toggleMute = vi.fn();
    const toggleMic = vi.fn();
    mockVoice.current = { muted: true, toggleMute };
    mockConv.current = { supported: true, micEnabled: true, muted: true, toggleMic };
    renderHero();
    fireEvent.click(screen.getByTestId("talk-to-echo"));
    expect(toggleMute).toHaveBeenCalledTimes(1);
    expect(toggleMic).toHaveBeenCalledTimes(1);
  });

  it("unmute never touches the mic for users who have not opted into hands-free", () => {
    const toggleMute = vi.fn();
    const toggleMic = vi.fn();
    mockVoice.current = { muted: true, toggleMute };
    mockConv.current = { supported: true, micEnabled: false, muted: false, toggleMic };
    renderHero();
    fireEvent.click(screen.getByTestId("talk-to-echo"));
    expect(toggleMute).toHaveBeenCalledTimes(1);
    expect(toggleMic).not.toHaveBeenCalled();
  });

  it("muted state shows the slashed mic + Echo Muted label", () => {
    mockVoice.current = { muted: true, toggleMute: () => {} };
    renderHero();
    expect(screen.getByTestId("core-echo-mic-slash")).toBeTruthy();
    expect(screen.getByText("Echo Muted")).toBeTruthy();
  });

  it("unmuted state shows Mute Echo and no slash", () => {
    mockVoice.current = { muted: false, toggleMute: () => {} };
    renderHero();
    expect(screen.queryByTestId("core-echo-mic-slash")).toBeNull();
    expect(screen.getByText("Mute Echo")).toBeTruthy();
  });

  it("no voice provider → falls back to conv mute state without crashing", () => {
    const toggleMic = vi.fn();
    mockConv.current = { supported: true, micEnabled: true, muted: false, toggleMic };
    renderHero();
    fireEvent.click(screen.getByTestId("talk-to-echo"));
    expect(toggleMic).toHaveBeenCalledTimes(1);
  });
});
