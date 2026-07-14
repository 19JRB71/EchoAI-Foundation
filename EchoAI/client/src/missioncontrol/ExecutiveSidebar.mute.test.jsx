import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ExecutiveSidebar from "./ExecutiveSidebar.jsx";

// The top-left Echo card is a pure mute/unmute toggle — it must NEVER call
// onTalkToEcho. Muting stops speech (voice.toggleMute → stopAll) AND stops
// hands-free listening (conv.toggleMic); unmuting restores both.
const mockConv = vi.hoisted(() => ({ current: null }));
const mockVoice = vi.hoisted(() => ({ current: null }));
vi.mock("../voice/EchoConversationContext.jsx", () => ({
  useEchoConversation: () => mockConv.current,
}));
vi.mock("../voice/VoiceContext.jsx", () => ({
  useVoice: () => mockVoice.current,
}));

function renderSidebar(onTalkToEcho = () => {}) {
  return render(
    <ExecutiveSidebar
      data={{ agents: [], kpis: [] }}
      brands={[]}
      selectedBrandId={null}
      onSelectBrand={() => {}}
      onNavigate={() => {}}
      onTalkToEcho={onTalkToEcho}
    />,
  );
}

afterEach(() => {
  cleanup();
  mockConv.current = null;
  mockVoice.current = null;
});

describe("ExecutiveSidebar Echo mute toggle", () => {
  it("unmuted click mutes speaker AND mic, never calls onTalkToEcho", () => {
    const toggleMute = vi.fn();
    const toggleMic = vi.fn();
    const talk = vi.fn();
    mockVoice.current = { muted: false, toggleMute };
    mockConv.current = { supported: true, micEnabled: true, muted: false, toggleMic };
    renderSidebar(talk);
    fireEvent.click(screen.getByTestId("sidebar-echo"));
    expect(toggleMute).toHaveBeenCalledTimes(1);
    expect(toggleMic).toHaveBeenCalledTimes(1);
    expect(talk).not.toHaveBeenCalled();
  });

  it("muted click unmutes speaker AND mic", () => {
    const toggleMute = vi.fn();
    const toggleMic = vi.fn();
    mockVoice.current = { muted: true, toggleMute };
    mockConv.current = { supported: true, micEnabled: true, muted: true, toggleMic };
    renderSidebar();
    fireEvent.click(screen.getByTestId("sidebar-echo"));
    expect(toggleMute).toHaveBeenCalledTimes(1);
    expect(toggleMic).toHaveBeenCalledTimes(1);
  });

  it("unmute never touches the mic for users who have not opted into hands-free", () => {
    const toggleMute = vi.fn();
    const toggleMic = vi.fn();
    mockVoice.current = { muted: true, toggleMute };
    mockConv.current = { supported: true, micEnabled: false, muted: false, toggleMic };
    renderSidebar();
    fireEvent.click(screen.getByTestId("sidebar-echo"));
    expect(toggleMute).toHaveBeenCalledTimes(1);
    expect(toggleMic).not.toHaveBeenCalled();
  });

  it("muted state shows the slashed mic + Muted label", () => {
    mockVoice.current = { muted: true, toggleMute: () => {} };
    renderSidebar();
    expect(screen.getByTestId("sidebar-echo-mic-slash")).toBeTruthy();
    expect(screen.getByTestId("sidebar-echo-state").textContent).toContain("Muted");
  });

  it("unmuted state has no slash", () => {
    mockVoice.current = { muted: false, toggleMute: () => {} };
    renderSidebar();
    expect(screen.queryByTestId("sidebar-echo-mic-slash")).toBeNull();
  });

  it("no voice provider → falls back to conv mute state without crashing", () => {
    const toggleMic = vi.fn();
    mockConv.current = { supported: true, micEnabled: true, muted: false, toggleMic };
    renderSidebar();
    fireEvent.click(screen.getByTestId("sidebar-echo"));
    expect(toggleMic).toHaveBeenCalledTimes(1);
  });

  it("the Talk to Echo quick action still calls onTalkToEcho", () => {
    const talk = vi.fn();
    renderSidebar(talk);
    fireEvent.click(screen.getByTestId("qa-talk-echo"));
    expect(talk).toHaveBeenCalledTimes(1);
  });
});
