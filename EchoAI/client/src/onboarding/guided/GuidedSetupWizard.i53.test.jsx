// 026-C2-PM1 — direct regression for the I-53 GuidedSetupWizard OAuth-return
// routing branch (the load-bearing fix for the OAuth-return freeze).
//
// The defect: an OAuth redirect that left mid-Setup-Agent (saved step
// "profile") landed the owner on the generic "Welcome back" resume checkpoint.
// SetupAgent was never remounted, so its execute loop stayed dead forever.
//
// The authorized fix: when the wizard boots with OAuth-return params AND the
// persisted step is "profile", it must route straight back to the profile
// step so SetupAgent remounts and its bootstrap (startSetupSession → adopt
// server truth → auto-run under consent) converges the run.
//
// This suite binds that branch at the component boundary: SetupAgent is
// mocked with a spy component (no new OAuth architecture, no browser
// redirect simulation — the wizard reads window.location.search, which we
// stage with history.replaceState exactly as a real return would leave it).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import GuidedSetupWizard from "./GuidedSetupWizard.jsx";
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

// SetupAgent spy: proves the wizard mounts the real component boundary after
// an OAuth return. Its mount IS the invocation of the bootstrap/startWith
// path (the real component starts its session load on mount; that behavior is
// pinned by the SetupAgent suite — here we bind the wizard side of the seam).
const setupAgentSpy = vi.fn();
vi.mock("../SetupAgent.jsx", () => ({
  default: (props) => {
    setupAgentSpy(props);
    return <div data-testid="setup-agent-mounted">setup-agent</div>;
  },
}));
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
  // The persisted checkpoint says the owner left MID-SETUP-AGENT.
  api.getGuidedSetupState.mockResolvedValue({
    progress: { currentStep: "profile", connections: {} },
    connectionStatus: {},
  });
  api.saveGuidedSetupProgress.mockResolvedValue({});
  api.getOnboardingStatus.mockResolvedValue({
    won: false,
    celebrated: false,
    authorization: null,
  });
  api.reportGuidedSetupConnectionError.mockResolvedValue({});
});

describe("GuidedSetupWizard — I-53 OAuth-return routing back into SetupAgent (026-C2-PM1)", () => {
  it("a successful OAuth return saved on the profile step routes to profile and remounts SetupAgent — never the 'Welcome back' checkpoint", async () => {
    // Stage the URL exactly as the Google OAuth callback redirect leaves it.
    window.history.replaceState({}, "", "/?google=connected");

    render(<GuidedSetupWizard onComplete={vi.fn()} />);

    // 1–3. OAuth return recognized, profile surface selected, SetupAgent
    // mounted through the real component boundary.
    expect(await screen.findByTestId("setup-agent-mounted")).toBeInTheDocument();
    expect(screen.getByText("Tell Echo about your business")).toBeInTheDocument();

    // 4. The bootstrap path is invoked at the component boundary: the spy
    // mounted embedded (the wizard's SetupAgent instance, whose mount runs
    // startWith/session adoption in the real component).
    expect(setupAgentSpy).toHaveBeenCalled();
    expect(setupAgentSpy.mock.calls[0][0]).toMatchObject({ embedded: true });

    // 5. NOT stranded on the old "Welcome back" resume checkpoint.
    expect(screen.queryByText(/Want to pick up where you left off/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Continue where I left off/i)).not.toBeInTheDocument();

    // The routing persisted the profile step so a refresh converges too.
    await waitFor(() => expect(api.saveGuidedSetupProgress).toHaveBeenCalled());
    expect(api.saveGuidedSetupProgress.mock.calls[0][0]).toBe("profile");

    // No error report for a successful return.
    expect(api.reportGuidedSetupConnectionError).not.toHaveBeenCalled();
  });

  it("a FAILED OAuth return saved on the profile step still routes back into SetupAgent, reports the failure server-side, and stays owner-safe", async () => {
    window.history.replaceState(
      {},
      "",
      "/?google=error&google_message=" + encodeURIComponent("invalid_grant: raw provider detail"),
    );

    render(<GuidedSetupWizard onComplete={vi.fn()} />);

    // Setup continues — the failure never strands the run.
    expect(await screen.findByTestId("setup-agent-mounted")).toBeInTheDocument();
    expect(screen.queryByText(/Continue where I left off/i)).not.toBeInTheDocument();

    // Failure detail goes server-side; the raw provider message never renders.
    await waitFor(() => expect(api.reportGuidedSetupConnectionError).toHaveBeenCalled());
    expect(api.reportGuidedSetupConnectionError.mock.calls[0][0]).toBe("google");
    expect(document.body.textContent).not.toMatch(/invalid_grant|raw provider detail/);
  });

  it("control: WITHOUT OAuth params the same profile checkpoint still shows the resume screen (the new branch only fires on an OAuth return)", async () => {
    render(<GuidedSetupWizard onComplete={vi.fn()} />);

    // The pre-existing resume behavior is untouched: the owner sees the
    // checkpoint screen and SetupAgent is NOT auto-mounted.
    expect(await screen.findByText(/Continue where I left off/i)).toBeInTheDocument();
    expect(screen.queryByTestId("setup-agent-mounted")).not.toBeInTheDocument();
    expect(setupAgentSpy).not.toHaveBeenCalled();
  });
});
