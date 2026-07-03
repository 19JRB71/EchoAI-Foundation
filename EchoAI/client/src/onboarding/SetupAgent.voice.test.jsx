// Voice-input coverage for the Setup Agent.
//
// The base SetupAgent tests run in a jsdom without any speech APIs, so voice UI
// is (correctly) absent there. Here we install a fake Web Speech API BEFORE the
// component mounts so `useVoiceInput` detects the "webspeech" method, then assert
// the voice affordances render: the mode toggle, the greeting line, the mic
// button with its "Listening…" indicator, and that a spoken transcript populates
// the answer field. We also verify the localStorage preference round-trips.

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("../api.js", () => ({
  api: {
    startSetupSession: vi.fn(),
    runSetupAction: vi.fn(),
    grantSetupConsent: vi.fn(),
    submitSetupAnswer: vi.fn(),
    pauseSetupSession: vi.fn(),
    pauseSetupSessionBeacon: vi.fn(),
    dismissSetupSession: vi.fn(),
    startGoogleOAuth: vi.fn(),
    startFacebookOAuth: vi.fn(),
    transcribeSetupVoice: vi.fn(),
  },
}));

import { api } from "../api.js";
import SetupAgent from "./SetupAgent.jsx";

const INTERVIEW_SESSION = {
  sessionId: "sess-1",
  interviewComplete: false,
  consentGranted: false,
  steps: [{ key: "brand", label: "Set up your brand" }],
  completedSteps: [],
};

// Minimal fake SpeechRecognition that lets a test drive onresult/onend.
class FakeSpeechRecognition {
  constructor() {
    FakeSpeechRecognition.instances.push(this);
    this.continuous = false;
    this.interimResults = false;
    this.lang = "";
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    this.started = false;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.started = false;
    if (this.onend) this.onend();
  }
  emitResult(transcript, isFinal = true) {
    if (!this.onresult) return;
    this.onresult({
      resultIndex: 0,
      results: [Object.assign([{ transcript }], { isFinal, length: 1 })],
    });
  }
}
FakeSpeechRecognition.instances = [];

beforeEach(() => {
  vi.clearAllMocks();
  FakeSpeechRecognition.instances = [];
  localStorage.clear();
  window.SpeechRecognition = FakeSpeechRecognition;
  api.startSetupSession.mockResolvedValue({
    session: INTERVIEW_SESSION,
    question: { message: "What does your business do?" },
  });
  api.pauseSetupSession.mockResolvedValue(undefined);
});

afterEach(() => {
  delete window.SpeechRecognition;
});

describe("SetupAgent voice input", () => {
  test("renders voice affordances when a speech API is available", async () => {
    // Force voice mode on regardless of the jsdom device default.
    localStorage.setItem("echoai_setup_voice_mode", "voice");
    render(<SetupAgent onClose={vi.fn()} />);

    expect(await screen.findByText("What does your business do?")).toBeInTheDocument();
    expect(
      screen.getByText(/You can speak your answers or type them/i),
    ).toBeInTheDocument();
    expect(screen.getByText("⚡ Instant voice recognition")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start voice input/i })).toBeInTheDocument();
  });

  test("recording shows the pulsing Listening indicator and a spoken transcript fills the field", async () => {
    localStorage.setItem("echoai_setup_voice_mode", "voice");
    render(<SetupAgent onClose={vi.fn()} />);

    const mic = await screen.findByRole("button", { name: /start voice input/i });
    fireEvent.click(mic);

    expect(await screen.findByText("Listening…")).toBeInTheDocument();

    const rec = FakeSpeechRecognition.instances[0];
    act(() => rec.emitResult("We sell handmade candles"));

    await waitFor(() =>
      expect(screen.getByDisplayValue("We sell handmade candles")).toBeInTheDocument(),
    );
  });

  test("the voice/text toggle switches modes and persists to localStorage", async () => {
    localStorage.setItem("echoai_setup_voice_mode", "voice");
    render(<SetupAgent onClose={vi.fn()} />);

    await screen.findByText("What does your business do?");
    // In voice mode the mic is present.
    expect(screen.getByRole("button", { name: /start voice input/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^⌨️ Text$/ }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /start voice input/i })).not.toBeInTheDocument(),
    );
    expect(localStorage.getItem("echoai_setup_voice_mode")).toBe("text");
  });
});
