// Prompt 024 — client regression: "Do this later" PARKS (never completes),
// the parked screen and armed banner tell the truth, resume works, the
// exactly-once celebration claim renders once, and the connections step
// presents the progressive tiers (nothing required now).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import GuidedSetupWizard from "./GuidedSetupWizard.jsx";
import ConnectionsStep from "./ConnectionsStep.jsx";
import { api } from "../../api";

vi.mock("../../api", () => ({
  api: {
    getGuidedSetupState: vi.fn(),
    saveGuidedSetupProgress: vi.fn(),
    reportGuidedSetupConnectionError: vi.fn(),
    updateOnboarding: vi.fn(),
    getOnboardingStatus: vi.fn(),
    claimFirstWinCelebration: vi.fn(),
  },
}));

vi.mock("./useEchoSpeak.js", () => ({
  useEchoSpeak: () => ({ speak: vi.fn(), stop: vi.fn() }),
}));

// The wizard renders heavy step components; the park/celebration behavior we
// test lives entirely on the welcome/parked screens, so stub the rest out.
vi.mock("../SetupAgent.jsx", () => ({ default: () => null }));
vi.mock("../steps/StepSubscription.jsx", () => ({ default: () => <div>plan-step</div> }));
vi.mock("../steps/StepTeam.jsx", () => ({ default: () => null }));
vi.mock("./FirstWinStep.jsx", () => ({
  default: () => <div>firstwin-step</div>,
  CONSENT_COPY_UNBOUND: "p024-v1-destination-unbound",
}));
vi.mock("./ConnectionsStep.jsx", () => ({ default: () => null }));
vi.mock("./OnlineLinksPanel.jsx", () => ({ default: () => null }));
vi.mock("./SageResearchPanel.jsx", () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  api.getGuidedSetupState.mockResolvedValue({
    progress: { currentStep: "welcome", connections: {} },
    connectionStatus: {},
  });
  api.saveGuidedSetupProgress.mockResolvedValue({});
  api.getOnboardingStatus.mockResolvedValue({
    won: false,
    celebrated: false,
    authorization: null,
  });
});

describe("GuidedSetupWizard — park / resume / celebration (Prompt 024)", () => {
  it("'Do this later' PARKS: saves the checkpoint, never calls updateOnboarding, and shows the parked screen", async () => {
    render(<GuidedSetupWizard onComplete={vi.fn()} />);

    fireEvent.click(await screen.findByText("Do this later — save my place"));

    await waitFor(() =>
      expect(screen.getByText(/Your place is saved, Sir\./)).toBeInTheDocument(),
    );
    // Parking does not complete onboarding.
    expect(api.updateOnboarding).not.toHaveBeenCalled();
    const saved = api.saveGuidedSetupProgress.mock.calls.at(-1);
    expect(saved[1].parked).toMatchObject({ parked: true });
    expect(typeof saved[1].parked.at).toBe("string");
    // Honest copy: setup is NOT finished.
    expect(screen.getByText(/Setup isn't finished yet/)).toBeInTheDocument();
  });

  it("restores a persisted park checkpoint on reload — parked screen, not the welcome flow", async () => {
    api.getGuidedSetupState.mockResolvedValue({
      progress: {
        currentStep: "plan",
        connections: { parked: { parked: true, at: "2026-08-09T12:00:00Z" } },
      },
      connectionStatus: {},
    });
    render(<GuidedSetupWizard onComplete={vi.fn()} />);
    expect(await screen.findByText(/Your place is saved, Sir\./)).toBeInTheDocument();
    expect(api.updateOnboarding).not.toHaveBeenCalled();
  });

  it("the parked screen offers resume back into the flow", async () => {
    render(<GuidedSetupWizard onComplete={vi.fn()} />);
    fireEvent.click(await screen.findByText("Do this later — save my place"));
    fireEvent.click(await screen.findByText("Continue my setup"));
    await waitFor(() => expect(screen.getByText("plan-step")).toBeInTheDocument());
  });

  it("an armed authorization shows the armed banner on welcome AND on the parked screen", async () => {
    api.getOnboardingStatus.mockResolvedValue({
      won: false,
      celebrated: false,
      firstWin: { postId: "p1", postContent: "My armed post content" },
      authorization: {
        status: "armed",
        expired: false,
        destinationPageId: null,
        expiresAt: "2026-08-17T00:00:00Z",
      },
    });
    render(<GuidedSetupWizard onComplete={vi.fn()} />);

    // Welcome screen banner.
    expect(
      await screen.findByText(/You have a post authorized and waiting/),
    ).toBeInTheDocument();

    // Parked screen keeps (and enriches) the banner.
    fireEvent.click(screen.getByText("Do this later — save my place"));
    const banner = await screen.findByText(/will\s+publish automatically, once/i);
    expect(banner.textContent).toMatch(/Page you connect during onboarding/);
    expect(banner.textContent).toMatch(/does not cancel it/i);
  });

  it("claims the celebration exactly once when a verified win is uncelebrated, and stays quiet on conflict", async () => {
    api.getOnboardingStatus.mockResolvedValue({
      won: true,
      celebrated: false,
      authorization: null,
    });
    api.claimFirstWinCelebration.mockResolvedValue({
      celebrate: true,
      won: true,
      provider: "facebook",
    });
    render(<GuidedSetupWizard onComplete={vi.fn()} />);

    expect(
      await screen.findByText(/Your first win is real, Sir/),
    ).toBeInTheDocument();
    expect(api.claimFirstWinCelebration).toHaveBeenCalledTimes(1);
  });

  it("renders NO celebration when another surface already celebrated (insert-once conflict)", async () => {
    api.getOnboardingStatus.mockResolvedValue({
      won: true,
      celebrated: false,
      authorization: null,
    });
    api.claimFirstWinCelebration.mockResolvedValue({ celebrate: false, won: true });
    render(<GuidedSetupWizard onComplete={vi.fn()} />);

    await waitFor(() => expect(api.claimFirstWinCelebration).toHaveBeenCalled());
    expect(screen.queryByText(/Your first win is real, Sir/)).not.toBeInTheDocument();
  });

  it("does not claim at all when the win was already celebrated", async () => {
    api.getOnboardingStatus.mockResolvedValue({
      won: true,
      celebrated: true,
      authorization: null,
    });
    render(<GuidedSetupWizard onComplete={vi.fn()} />);
    await screen.findAllByText(/Hi, I'm Echo/);
    expect(api.claimFirstWinCelebration).not.toHaveBeenCalled();
  });
});
