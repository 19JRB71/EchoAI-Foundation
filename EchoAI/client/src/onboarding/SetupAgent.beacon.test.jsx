// Browser-wiring coverage for the Setup Agent's HARD-CLOSE pause.
//
// The main SetupAgent.test.jsx fully mocks api.js, so every api method there —
// including pauseSetupSessionBeacon — is an inert vi.fn. That verifies the
// component *calls* the beacon helper, but never exercises the real helper's
// browser wiring: that a `pagehide` during a mid-interview/consent session
// actually issues a `navigator.sendBeacon` to /api/setup-agent/pause-beacon with
// the JWT + sessionId in the body, and that the shared `pausedRef` guard means we
// pause AT MOST ONCE (beacon OR unmount, never both).
//
// So here we mock only the network-hitting api methods and keep the REAL
// `pauseSetupSessionBeacon` (and the real `getToken` it closes over). We stub
// `navigator.sendBeacon` + seed a token in localStorage, then drive the component
// into each phase and dispatch `pagehide`, asserting the beacon fires only during
// interview/consent — and that it and the unmount pause can't both run.

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Partial mock: keep the REAL api module (so `pauseSetupSessionBeacon` and its
// `getToken`/BASE_URL closures are the genuine implementation) but replace the
// methods that would otherwise hit the network with vi.fns we control.
vi.mock("../api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    api: {
      ...actual.api,
      startSetupSession: vi.fn(),
      submitSetupAnswer: vi.fn(),
      grantSetupConsent: vi.fn(),
      runSetupAction: vi.fn(),
      dismissSetupSession: vi.fn(),
      startGoogleOAuth: vi.fn(),
      // pauseSetupSession (the fetch-based unmount pause) is stubbed so we can
      // assert whether the unmount path ran; pauseSetupSessionBeacon stays REAL.
      pauseSetupSession: vi.fn(),
    },
  };
});

import { api } from "../api.js";
import SetupAgent from "./SetupAgent.jsx";

const TOKEN = "jwt-token-abc";

const INTERVIEW_SESSION = {
  sessionId: "sess-hard-close",
  interviewComplete: false,
  consentGranted: false,
  steps: [{ key: "brand", label: "Set up your brand" }],
  completedSteps: [],
};

const CONSENT_SESSION = {
  ...INTERVIEW_SESSION,
  interviewComplete: true,
  consentGranted: false,
};

const READY_SESSION = {
  ...INTERVIEW_SESSION,
  interviewComplete: true,
  consentGranted: true,
};

function firePageHide() {
  window.dispatchEvent(new Event("pagehide"));
}

// Read back the JSON body the client queued into navigator.sendBeacon(url, blob).
// jsdom's Blob has no .text(), so decode it via FileReader.
function readBlobText(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

async function beaconBody(call) {
  const text = await readBlobText(call[1]);
  return JSON.parse(text);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("echoai_token", TOKEN);
  // jsdom has no Beacon API — install a stub we can assert against.
  navigator.sendBeacon = vi.fn(() => true);
  api.pauseSetupSession.mockResolvedValue(undefined);
});

afterEach(() => {
  localStorage.clear();
  delete navigator.sendBeacon;
});

describe("SetupAgent hard-close beacon fires only mid-interview/consent", () => {
  test("pagehide during the interview beacons the pause with the sessionId + token", async () => {
    api.startSetupSession.mockResolvedValue({
      session: INTERVIEW_SESSION,
      question: { message: "What does your business do?" },
    });

    render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByText("What does your business do?")).toBeInTheDocument();

    firePageHide();

    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);
    const [url] = navigator.sendBeacon.mock.calls[0];
    expect(url).toBe("/api/setup-agent/pause-beacon");
    // The JWT rides in the body (Beacon can't set an Authorization header) along
    // with the session being paused.
    const body = await beaconBody(navigator.sendBeacon.mock.calls[0]);
    expect(body).toEqual({ sessionId: "sess-hard-close", token: TOKEN });
  });

  test("pagehide during the consent screen beacons the pause", async () => {
    api.startSetupSession.mockResolvedValue({ session: CONSENT_SESSION });

    render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByText("Ready to set up your account")).toBeInTheDocument();

    firePageHide();

    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);
    const body = await beaconBody(navigator.sendBeacon.mock.calls[0]);
    expect(body).toEqual({ sessionId: "sess-hard-close", token: TOKEN });
  });

  test("pagehide during the running phase does NOT beacon (server owns lifecycle)", async () => {
    api.startSetupSession.mockResolvedValue({ session: READY_SESSION });
    // A needs_connection outcome settles the run loop into a stable running phase.
    api.runSetupAction.mockResolvedValueOnce({
      step: { key: "brand", label: "Set up your brand" },
      status: "needs_connection",
      detail: "Connect Google Calendar to continue.",
      connect: { provider: "google" },
    });

    render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByText("One quick approval needed")).toBeInTheDocument();

    firePageHide();

    expect(navigator.sendBeacon).not.toHaveBeenCalled();
  });

  test("pagehide during the done phase does NOT beacon (setup already finished)", async () => {
    api.startSetupSession.mockResolvedValue({ session: READY_SESSION });
    api.runSetupAction.mockResolvedValueOnce({ allComplete: true });

    render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByText("Your account is ready")).toBeInTheDocument();

    firePageHide();

    expect(navigator.sendBeacon).not.toHaveBeenCalled();
  });
});

describe("SetupAgent pauses at most once (beacon OR unmount, never both)", () => {
  test("a beacon on pagehide suppresses the unmount fetch pause", async () => {
    api.startSetupSession.mockResolvedValue({
      session: INTERVIEW_SESSION,
      question: { message: "What does your business do?" },
    });

    const { unmount } = render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByText("What does your business do?")).toBeInTheDocument();

    // Hard close first: the beacon fires and flips the shared pausedRef guard.
    firePageHide();
    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);

    // The subsequent React unmount must NOT issue a second (fetch) pause.
    unmount();
    expect(api.pauseSetupSession).not.toHaveBeenCalled();
    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);
  });

  test("repeated pagehide events beacon only once", async () => {
    api.startSetupSession.mockResolvedValue({
      session: INTERVIEW_SESSION,
      question: { message: "What does your business do?" },
    });

    render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByText("What does your business do?")).toBeInTheDocument();

    firePageHide();
    firePageHide();
    firePageHide();

    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);
  });

  test("an unmount fetch pause suppresses a later beacon (guard holds both ways)", async () => {
    api.startSetupSession.mockResolvedValue({
      session: INTERVIEW_SESSION,
      question: { message: "What does your business do?" },
    });

    const { unmount } = render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByText("What does your business do?")).toBeInTheDocument();

    // In-app navigation unmounts first: the fetch pause runs and sets pausedRef.
    unmount();
    expect(api.pauseSetupSession).toHaveBeenCalledTimes(1);

    // The unmount also removed the pagehide listener, so a late pagehide is inert
    // — no beacon, and still exactly one total pause.
    firePageHide();
    expect(navigator.sendBeacon).not.toHaveBeenCalled();
    expect(api.pauseSetupSession).toHaveBeenCalledTimes(1);
  });
});

describe("SetupAgent beacon helper self-guards on missing prerequisites", () => {
  test("no token → no beacon even during the interview", async () => {
    // If the JWT is gone (e.g. logged out in another tab) the real helper bails
    // rather than firing an unauthenticated beacon.
    localStorage.removeItem("echoai_token");
    api.startSetupSession.mockResolvedValue({
      session: INTERVIEW_SESSION,
      question: { message: "What does your business do?" },
    });

    render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByText("What does your business do?")).toBeInTheDocument();

    firePageHide();

    expect(navigator.sendBeacon).not.toHaveBeenCalled();
  });
});

// Older browsers (and some locked-down webviews) don't ship the Beacon API at
// all. In that case pauseSetupSessionBeacon must still save progress by falling
// back to a `keepalive` fetch — the only other request kind that survives a hard
// tab/window close — POSTing the same {sessionId, token} body to the no-auth
// /pause-beacon endpoint. This suite removes navigator.sendBeacon entirely and
// asserts that fallback so a refactor can't silently drop it (which would lose
// mid-interview progress for those users with no test catching it).
describe("SetupAgent hard-close falls back to keepalive fetch when the Beacon API is missing", () => {
  test("pagehide mid-interview POSTs a keepalive fetch to /pause-beacon with the sessionId + token", async () => {
    // Simulate a browser with no Beacon API.
    delete navigator.sendBeacon;
    const fetchSpy = vi.fn(() => Promise.resolve());
    vi.stubGlobal("fetch", fetchSpy);

    api.startSetupSession.mockResolvedValue({
      session: INTERVIEW_SESSION,
      question: { message: "What does your business do?" },
    });

    render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByText("What does your business do?")).toBeInTheDocument();

    firePageHide();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/setup-agent/pause-beacon");
    expect(opts.method).toBe("POST");
    // `keepalive` is what lets the request outlive the closing document.
    expect(opts.keepalive).toBe(true);
    expect(opts.headers).toEqual({ "Content-Type": "application/json" });
    // Same body shape as the beacon path: JWT rides along since there's no header.
    expect(JSON.parse(opts.body)).toEqual({ sessionId: "sess-hard-close", token: TOKEN });

    vi.unstubAllGlobals();
  });

  test("no Beacon API AND no token → the fallback does nothing (returns false, no fetch)", async () => {
    // With neither sendBeacon nor a JWT the helper must bail entirely rather than
    // fire an unauthenticated keepalive request.
    delete navigator.sendBeacon;
    localStorage.removeItem("echoai_token");
    const fetchSpy = vi.fn(() => Promise.resolve());
    vi.stubGlobal("fetch", fetchSpy);

    // Direct helper check: the real pauseSetupSessionBeacon reports it did nothing.
    expect(api.pauseSetupSessionBeacon("sess-hard-close")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    // And driving it through the component's pagehide path issues no fetch either.
    api.startSetupSession.mockResolvedValue({
      session: INTERVIEW_SESSION,
      question: { message: "What does your business do?" },
    });

    render(<SetupAgent onClose={vi.fn()} />);
    expect(await screen.findByText("What does your business do?")).toBeInTheDocument();

    firePageHide();

    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
