// Regression coverage for the App-level half of the Mission Control goal-alert
// deep link: handleSelectSection("settings", { brandId, focus: "goals" }) must
// switch the selected business to the ALERT's brand (with the brands-list
// ownership check and String() id coercion) before Settings renders, so
// clicking Business B's alert while Business A is selected can never show
// Business A's goals. Renders the real <App> with heavy children stubbed and
// asserts the brandId that reaches Settings.

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// This file renders the full <App> (heaviest client test). Under parallel-suite
// CPU load (validation runs server tests, the client build, and this suite
// concurrently) the default 5s test timeout / 1s waitFor flake even though the
// logic is fine — every assertion still settles as soon as React flushes.
vi.setConfig({ testTimeout: 30000 });

// --- Router: App only uses useNavigate. ---
vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

// --- API layer: authed user, onboarding done, two real brands. brand_id is
// numeric while MissionControl passes string ids — the deep link must survive
// the String() coercion in handleSelectSection's ownership check. ---
vi.mock("./api.js", () => ({
  getToken: () => "test-token",
  setToken: vi.fn(),
  clearToken: vi.fn(),
  api: {
    getProfile: vi.fn(),
    getAgencySettings: vi.fn(),
    getBrands: vi.fn(),
    getActiveBrand: vi.fn().mockResolvedValue({ brandId: null }),
    setActiveBrand: vi.fn().mockResolvedValue({}),
    getSetupLatest: vi.fn(),
    getSubscriptionStatus: vi.fn(),
    getGoals: vi.fn(),
    healthGetStatus: vi.fn(),
    demoGetStatus: vi.fn(),
    acceptTeamInvite: vi.fn(),
    getSetupStatus: vi.fn().mockResolvedValue({ features: [], doneCount: 0, totalCount: 0 }),
  },
}));

vi.mock("./lib/session.js", () => ({
  startSessionTracking: () => () => {},
  wasAwayLong: () => false,
}));
vi.mock("./push.js", () => ({
  enablePushNotifications: () => Promise.resolve(),
}));

// --- Heavy providers/overlays become passthroughs or nulls. ---
vi.mock("./music/MusicContext.jsx", () => ({
  MusicProvider: ({ children }) => children,
}));
vi.mock("./voice/VoiceContext.jsx", () => ({
  VoiceProvider: ({ children }) => children,
  useVoice: () => null,
}));
vi.mock("./voice/EchoConversationContext.jsx", () => ({
  EchoConversationProvider: ({ children }) => children,
  useEchoConversation: () => null,
}));
vi.mock("./demo/DemoSuggestionContext.jsx", () => ({
  DemoSuggestionProvider: ({ children }) => children,
}));
vi.mock("./voice/VoicePlayer.jsx", () => ({ default: () => null }));
vi.mock("./tour/TourProvider.jsx", () => ({ default: () => null }));
vi.mock("./tour/SectionHelp.jsx", () => ({ default: () => null }));
vi.mock("./components/HealthSupportWidget.jsx", () => ({
  default: () => null,
}));
vi.mock("./companion/EchoCompanion.jsx", () => ({ default: () => null }));
vi.mock("./components/Sidebar.jsx", () => ({
  default: () => null,
  accentTierForSection: () => null,
}));

// --- The two ends of the deep link. MissionControl is reduced to buttons that
// fire onNavigate exactly the way the real alert rows do; Settings is reduced
// to a probe that reports which brandId / focus nonce actually reached it. ---
vi.mock("./sections/MissionControl.jsx", () => ({
  default: ({ onNavigate }) => (
    <div>
      <button
        onClick={() => onNavigate("settings", { brandId: "202", focus: "goals" })}
      >
        alert-brand-b
      </button>
      <button
        onClick={() => onNavigate("settings", { brandId: "999", focus: "goals" })}
      >
        alert-foreign-brand
      </button>
    </div>
  ),
}));
vi.mock("./sections/Settings.jsx", () => ({
  default: ({ brandId, focusGoals }) => (
    <div data-testid="settings-probe">
      brand:{String(brandId)}|focus:{focusGoals ? "goals" : "none"}
    </div>
  ),
}));

import { api } from "./api.js";
import App from "./App.jsx";

const BRANDS = [
  { brand_id: 101, brand_name: "Business A", is_demo: false },
  { brand_id: 202, brand_name: "Business B", is_demo: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.getProfile.mockResolvedValue({
    onboardingCompleted: true,
    role: "user",
    workspaceRole: "owner",
    isTeamMember: false,
    email: "owner@example.com",
    businessName: "Business A",
  });
  api.getAgencySettings.mockRejectedValue(
    Object.assign(new Error("Not found"), { status: 404 }),
  );
  api.getBrands.mockResolvedValue({ brands: BRANDS });
  api.getSetupLatest.mockResolvedValue({ session: { status: "completed" } });
  api.getSubscriptionStatus.mockResolvedValue({
    subscriptionTier: "enterprise",
    status: "active",
  });
  api.healthGetStatus.mockResolvedValue({ overallStatus: "healthy" });
});

async function renderDashboard() {
  render(<App />);
  // Generous timeouts: the default 1s waitFor flakes under parallel-suite CPU
  // load (validation runs test/client-test/client-build concurrently) — the
  // brands fetch chain simply hasn't flushed yet on a loaded machine.
  // Mission Control stub is up once the profile resolves…
  await waitFor(
    () => {
      expect(screen.getByText("alert-brand-b")).toBeInTheDocument();
    },
    { timeout: 10000 },
  );
  // …and the brand selector confirms both brands are loaded with Business A
  // (the first real brand) selected.
  await waitFor(
    () => {
      expect(pillFor("Business A")).toHaveAttribute("aria-pressed", "true");
    },
    { timeout: 10000 },
  );
}

// The brand switcher is a row of pill buttons; the active one is aria-pressed.
function pillFor(name) {
  return screen.getByRole("button", { name });
}

describe("App settings deep link (goal-alert click-through)", () => {
  test("navigating with brand B's id switches the selection so Settings gets brand B", async () => {
    await renderDashboard();

    fireEvent.click(screen.getByText("alert-brand-b"));

    await waitFor(() => {
      expect(screen.getByTestId("settings-probe")).toHaveTextContent(
        "brand:202|focus:goals",
      );
    });
    // The account-wide brand selector followed along too.
    expect(pillFor("Business B")).toHaveAttribute("aria-pressed", "true");
  });

  test("an unknown/foreign brandId does NOT change the selection", async () => {
    await renderDashboard();

    fireEvent.click(screen.getByText("alert-foreign-brand"));

    // Still lands on Settings (the section switch is legitimate) but with the
    // previously selected brand — never a brand outside the account's list.
    await waitFor(() => {
      expect(screen.getByTestId("settings-probe")).toHaveTextContent(
        "brand:101|focus:goals",
      );
    });
    expect(pillFor("Business A")).toHaveAttribute("aria-pressed", "true");
  });

  test("an unknown/foreign brandId shows a fallback notice instead of a silent swap", async () => {
    await renderDashboard();

    fireEvent.click(screen.getByText("alert-foreign-brand"));

    // The user is told the alert's business is gone and which business they
    // are actually looking at.
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "That business is no longer in your account — showing Business A instead.",
      );
    });
    // The goals scroll/focus still fires so the click-through stays useful.
    expect(screen.getByTestId("settings-probe")).toHaveTextContent(
      "brand:101|focus:goals",
    );

    // The notice is dismissable.
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("a successful brand switch shows NO fallback notice", async () => {
    await renderDashboard();

    fireEvent.click(screen.getByText("alert-brand-b"));

    await waitFor(() => {
      expect(screen.getByTestId("settings-probe")).toHaveTextContent(
        "brand:202|focus:goals",
      );
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
