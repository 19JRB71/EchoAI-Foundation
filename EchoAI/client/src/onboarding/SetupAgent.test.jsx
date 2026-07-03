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
  // The unmount handler chains .catch() on this, so it must return a promise.
  api.pauseSetupSession.mockResolvedValue(undefined);
});

// A fresh (not-yet-interviewed) session so the bootstrap effect lands in the
// interview phase and we can walk the whole happy path a real user takes.
const INTERVIEW_SESSION = {
  sessionId: "sess-1",
  interviewComplete: false,
  consentGranted: false,
  steps: [
    { key: "brand", label: "Set up your brand" },
    { key: "chatbot", label: "Configure your chatbot" },
  ],
  completedSteps: [],
};

describe("SetupAgent happy path (interview → consent → running → done)", () => {
  test("walks a user from the first question through a completed setup", async () => {
    // Bootstrap lands in the interview with the first question.
    api.startSetupSession.mockResolvedValue({
      session: INTERVIEW_SESSION,
      question: { message: "What does your business do?" },
    });
    // The single answer completes the interview and returns the consent prompt.
    api.submitSetupAnswer.mockResolvedValueOnce({
      session: { ...INTERVIEW_SESSION, interviewComplete: true },
      question: { complete: true, message: "I have everything I need." },
    });
    api.grantSetupConsent.mockResolvedValueOnce({});
    // Two steps succeed, then the run reports completion.
    api.runSetupAction
      .mockResolvedValueOnce({
        step: { key: "brand", label: "Set up your brand" },
        status: "done",
        detail: "Brand created.",
      })
      .mockResolvedValueOnce({
        step: { key: "chatbot", label: "Configure your chatbot" },
        status: "done",
        detail: "Chatbot configured.",
      })
      .mockResolvedValueOnce({ allComplete: true });

    const onClose = vi.fn();
    render(<SetupAgent onClose={onClose} />);

    // --- Interview: the question renders and we answer it. ---
    expect(await screen.findByText("What does your business do?")).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText("Type your answer…");
    fireEvent.change(textarea, { target: { value: "We sell handmade candles." } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() =>
      expect(api.submitSetupAnswer).toHaveBeenCalledWith("sess-1", "We sell handmade candles."),
    );

    // --- Consent: the consent screen + the plan of steps renders. ---
    expect(await screen.findByText("Ready to set up your account")).toBeInTheDocument();
    expect(screen.getByText("I have everything I need.")).toBeInTheDocument();
    const consentBtn = screen.getByRole("button", { name: /yes, set up my account/i });
    fireEvent.click(consentBtn);

    await waitFor(() => expect(api.grantSetupConsent).toHaveBeenCalledWith("sess-1"));

    // --- Done: after the run completes we reach the success panel. ---
    expect(await screen.findByText("Your account is ready")).toBeInTheDocument();
    expect(screen.getByText("Brand created.")).toBeInTheDocument();
    expect(screen.getByText("Chatbot configured.")).toBeInTheDocument();
    // The run made exactly the three calls (two steps + the allComplete probe).
    expect(api.runSetupAction).toHaveBeenCalledTimes(3);

    // The success CTA hands control back to the dashboard.
    fireEvent.click(screen.getByRole("button", { name: /go to my dashboard/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("SetupAgent needs_connection handoff", () => {
  test("renders the approval panel and skipping continues the run to completion", async () => {
    api.runSetupAction
      // First step needs the user to connect Google.
      .mockResolvedValueOnce({
        step: { key: "calendar", label: "Connect Google Calendar" },
        status: "needs_connection",
        connect: { provider: "google" },
        detail: "Connect your Google Calendar to enable booking.",
      })
      // The skip call (runSetupAction(sid, true)) resolves…
      .mockResolvedValueOnce({
        step: { key: "calendar", label: "Connect Google Calendar" },
        status: "skipped",
        detail: "Skipped.",
      })
      // …then the resumed loop finishes.
      .mockResolvedValueOnce({ allComplete: true });

    const onClose = vi.fn();
    render(<SetupAgent onClose={onClose} />);

    // The "One quick approval needed" panel + its three buttons render.
    expect(await screen.findByText("One quick approval needed")).toBeInTheDocument();
    expect(
      screen.getByText("Connect your Google Calendar to enable booking."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect google calendar/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /i've connected — continue/i })).toBeInTheDocument();

    const skipBtn = screen.getByRole("button", { name: /skip this step/i });
    fireEvent.click(skipBtn);

    // Skip issues the skip flag, then the loop runs to completion.
    await waitFor(() => expect(api.runSetupAction).toHaveBeenCalledWith("sess-1", true));
    expect(await screen.findByText("Your account is ready")).toBeInTheDocument();
    expect(screen.queryByText("One quick approval needed")).not.toBeInTheDocument();
  });

  test("the Connect button launches Google OAuth", async () => {
    api.runSetupAction.mockResolvedValueOnce({
      step: { key: "calendar", label: "Connect Google Calendar" },
      status: "needs_connection",
      connect: { provider: "google" },
      detail: "Connect your Google Calendar to enable booking.",
    });
    api.startGoogleOAuth.mockResolvedValueOnce({ authUrl: "https://accounts.google.com/o/oauth2" });

    // Stub navigation so the component's window.location.href assignment is inert.
    const originalLocation = window.location;
    delete window.location;
    window.location = { href: "" };

    try {
      render(<SetupAgent onClose={vi.fn()} />);

      const connectBtn = await screen.findByRole("button", {
        name: /connect google calendar/i,
      });
      fireEvent.click(connectBtn);

      await waitFor(() => expect(api.startGoogleOAuth).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(window.location.href).toBe("https://accounts.google.com/o/oauth2"),
      );
    } finally {
      window.location = originalLocation;
    }
  });

  test("'I've connected — continue' resumes the run after the user approves", async () => {
    api.runSetupAction
      .mockResolvedValueOnce({
        step: { key: "calendar", label: "Connect Google Calendar" },
        status: "needs_connection",
        connect: { provider: "google" },
        detail: "Connect your Google Calendar to enable booking.",
      })
      .mockResolvedValueOnce({ allComplete: true });

    render(<SetupAgent onClose={vi.fn()} />);

    const continueBtn = await screen.findByRole("button", {
      name: /i've connected — continue/i,
    });
    fireEvent.click(continueBtn);

    expect(await screen.findByText("Your account is ready")).toBeInTheDocument();
    expect(api.runSetupAction).toHaveBeenCalledTimes(2);
  });
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

// The unmount lifecycle: leaving the agent mid-flow (still interviewing or on the
// consent screen) must quietly fire a best-effort api.pauseSetupSession so the
// user's progress is saved and resumable. That same handler must stay silent in
// the running / done phases, where the server already owns lifecycle state — a
// spurious pause there would fight the running orchestrator or reopen a finished
// session. This fragile "fire only in interview/consent" behavior is otherwise
// untested, so a refactor could either drop progress or spam pause calls.
describe("SetupAgent unmount pauses only mid-interview/consent", () => {
  const INTERVIEW_SESSION = {
    sessionId: "sess-9",
    interviewComplete: false,
    consentGranted: false,
    steps: [{ key: "brand", label: "Set up your brand" }],
    completedSteps: [],
  };

  const CONSENT_SESSION = {
    sessionId: "sess-9",
    interviewComplete: true,
    consentGranted: false,
    steps: [{ key: "brand", label: "Set up your brand" }],
    completedSteps: [],
  };

  test("unmount from the interview phase pauses the session once with its id", async () => {
    api.startSetupSession.mockResolvedValue({
      session: INTERVIEW_SESSION,
      question: { message: "What does your business do?" },
    });

    const { unmount } = render(<SetupAgent onClose={vi.fn()} />);

    // Wait until we're actually in the interview phase before leaving.
    expect(await screen.findByText("What does your business do?")).toBeInTheDocument();

    unmount();

    expect(api.pauseSetupSession).toHaveBeenCalledTimes(1);
    expect(api.pauseSetupSession).toHaveBeenCalledWith("sess-9");
  });

  test("unmount from the consent phase pauses the session once with its id", async () => {
    api.startSetupSession.mockResolvedValue({ session: CONSENT_SESSION });

    const { unmount } = render(<SetupAgent onClose={vi.fn()} />);

    expect(await screen.findByText("Ready to set up your account")).toBeInTheDocument();

    unmount();

    expect(api.pauseSetupSession).toHaveBeenCalledTimes(1);
    expect(api.pauseSetupSession).toHaveBeenCalledWith("sess-9");
  });

  test("unmount from the running phase does NOT pause (server owns lifecycle)", async () => {
    // A needs_connection outcome settles the run loop into a stable running phase.
    api.runSetupAction.mockResolvedValueOnce({
      step: { key: "brand", label: "Set up your brand" },
      status: "needs_connection",
      detail: "Connect Google Calendar to continue.",
      connect: { provider: "google" },
    });

    const { unmount } = render(<SetupAgent onClose={vi.fn()} />);

    expect(await screen.findByText("One quick approval needed")).toBeInTheDocument();

    unmount();

    expect(api.pauseSetupSession).not.toHaveBeenCalled();
  });

  test("unmount from the done phase does NOT pause (setup already finished)", async () => {
    api.runSetupAction.mockResolvedValueOnce({ allComplete: true });

    const { unmount } = render(<SetupAgent onClose={vi.fn()} />);

    expect(await screen.findByText("Your account is ready")).toBeInTheDocument();

    unmount();

    expect(api.pauseSetupSession).not.toHaveBeenCalled();
  });
});
