import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import CoreHero from "./CoreHero.jsx";

// The Core's alive-states must be driven by the REAL voice-engine state only.
// We mock the conversation hook to control convState per test.
const mockConv = vi.hoisted(() => ({ current: null }));
vi.mock("../voice/EchoConversationContext.jsx", () => ({
  useEchoConversation: () => mockConv.current,
}));

function heroRoot() {
  return screen.getByText("ZORECHO CORE").closest(".mcv2-hero");
}

function renderHero() {
  return render(
    <CoreHero
      agents={[]}
      onOpenDepartment={() => {}}
      onTalkToEcho={() => {}}
      statusLine=""
      healthy
    />,
  );
}

afterEach(() => {
  cleanup();
  mockConv.current = null;
});

describe("CoreHero voice-state mapping", () => {
  it("no conversation engine (null context) → idle, no fabricated state", () => {
    mockConv.current = null;
    renderHero();
    expect(heroRoot().className).toContain("mcv2-idle");
    expect(screen.getByText("AI Workforce Operational")).toBeTruthy();
  });

  it("passive → idle", () => {
    mockConv.current = { convState: "passive" };
    renderHero();
    expect(heroRoot().className).toContain("mcv2-idle");
  });

  it("active → listening", () => {
    mockConv.current = { convState: "active" };
    renderHero();
    expect(heroRoot().className).toContain("mcv2-listening");
    expect(screen.getByText("Echo Listening")).toBeTruthy();
  });

  it("processing → thinking, with orbiting particles", () => {
    mockConv.current = { convState: "processing" };
    const { container } = renderHero();
    expect(heroRoot().className).toContain("mcv2-thinking");
    expect(screen.getByText("Echo Thinking")).toBeTruthy();
    expect(container.querySelector(".mcv2-orbit")).toBeTruthy();
  });

  it("speaking → speaking, with the center light-pulse emitter", () => {
    mockConv.current = { convState: "speaking" };
    const { container } = renderHero();
    expect(heroRoot().className).toContain("mcv2-speaking");
    expect(screen.getByText("Echo Speaking")).toBeTruthy();
    // The subtle light pulse emits from the center only while speaking.
    expect(container.querySelector(".mcv2-core-emit")).toBeTruthy();
    // No thinking particles while speaking.
    expect(container.querySelector(".mcv2-orbit")).toBeFalsy();
  });

  it("the light-pulse emitter is absent outside the speaking state", () => {
    mockConv.current = { convState: "active" };
    const { container } = renderHero();
    expect(container.querySelector(".mcv2-core-emit")).toBeFalsy();
  });
});
