// End-to-end render coverage for the Setup Agent's race-outcome branches.
//
// Task #19 pinned the DECISION (pure `classifyExecuteError`) with node:test, but
// nothing verified the actual RENDERED result: a raced pause/dismiss during the
// running phase must never become the scary red error screen. A refactor of the
// phase render branches (not the catch logic) could still regress the visible UI
// without failing the pure-function test.
//
// These tests render the real <SetupAgent> with a mocked `api`. We drive it
// straight into the "running" phase by returning an interview-complete,
// consent-granted session from `startSetupSession` (its bootstrap effect then
// calls `runLoop` immediately). We then reject `runSetupAction` with each raced
// outcome and assert the visible result:
//   - 409 + paused    → "Setup paused" panel with a working "Resume setup" button
//   - 409 + dismissed → onClose is called (agent unmounts, no error banner)
//   - 409 (no session) → the retryable error banner + "Retry" stays in running phase

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Mock the api module the component imports. Every method is a vi.fn so the
// unmount best-effort pause() etc. never hit the network.
vi.mock("../api.js", () => ({
  api: {
    startSetupSession: vi.fn(),
    runSetupAction: vi.fn(),
    grantSetupConsent: vi.fn(),
    submitSetupAnswer: vi.fn(),
    pauseSetupSession: vi.fn(),
    dismissSetupSession: vi.fn(),
    startGoogleOAuth: vi.fn(),
  },
}));

import { api } from "../api.js";
import SetupAgent from "./SetupAgent.jsx";

const READY_SESSION = {
  sessionId: "sess-1",
  interviewComplete: true,
  consentGranted: true,
  steps: [
    { key: "brand", label: "Set up your brand" },
    { key: "chatbot", label: "Configure your chatbot" },
  ],
  completedSteps: [],
};

function make409(message, session) {
  return Object.assign(new Error(message), {
    status: 409,
    data: session ? { session } : { error: message },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: bootstrap resumes straight into the running phase.
  api.startSetupSession.mockResolvedValue({ session: READY_SESSION });
});

describe("SetupAgent raced-outcome render branches", () => {
  test("409 with a paused session renders the resumable 'Setup paused' panel", async () => {
    api.runSetupAction.mockRejectedValueOnce(
      make409("Setup was paused.", { status: "paused", sessionId: "sess-1" }),
    );
    const onClose = vi.fn();

    render(<SetupAgent onClose={onClose} />);

    // The paused panel is shown, NOT the red error screen.
    expect(await screen.findByText("Setup paused")).toBeInTheDocument();
    const resumeBtn = screen.getByRole("button", { name: /resume setup/i });
    expect(resumeBtn).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // "Resume setup" actually restarts the run: startSetupSession is called again
    // (bootstrap once + resume once) and a second execute attempt is made.
    api.runSetupAction.mockResolvedValueOnce({ allComplete: true });
    fireEvent.click(resumeBtn);

    await waitFor(() => expect(api.startSetupSession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.runSetupAction).toHaveBeenCalledTimes(2));
  });

  test("409 with a dismissed session cleanly closes (onClose) with no error banner", async () => {
    api.runSetupAction.mockRejectedValueOnce(
      make409("Setup was dismissed.", { status: "dismissed" }),
    );
    const onClose = vi.fn();

    render(<SetupAgent onClose={onClose} />);

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Setup paused")).not.toBeInTheDocument();
    expect(screen.queryByText(/you can retry/i)).not.toBeInTheDocument();
  });

  test("409 without a session body keeps the retryable error banner in the running phase", async () => {
    api.runSetupAction.mockRejectedValueOnce(
      make409("A setup step is already running."),
    );
    const onClose = vi.fn();

    render(<SetupAgent onClose={onClose} />);

    // The retryable error banner (with the server message + Retry) shows, and we
    // stay in the running phase — the paused panel must NOT appear.
    expect(await screen.findByText("A setup step is already running.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText("Setup paused")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // The progress rail (running phase) is still on screen.
    expect(screen.getByText("Setting up your account…")).toBeInTheDocument();
  });
});
