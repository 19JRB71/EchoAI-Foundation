import { test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
vi.mock("../api.js", () => ({ api: {
  startSetupSession: vi.fn(), runSetupAction: vi.fn(), pauseSetupSession: vi.fn(),
  pauseSetupSessionBeacon: vi.fn(), dismissSetupSession: vi.fn(),
  getBrand: vi.fn(), getFacebookAccounts: vi.fn(), startFacebookOAuth: vi.fn(),
  getOnboardingStatus: vi.fn(), selectFacebookPage: vi.fn(),
} }));
vi.mock("../lib/oauthNav.js", () => ({ openAuthUrl: vi.fn(() => false) }));
import { api } from "../api.js";
import { openAuthUrl } from "../lib/oauthNav.js";
import SetupAgent from "./SetupAgent.jsx";
import AdsDestinationCapture from "./guided/AdsDestinationCapture.jsx";

const occupied = { id: "sds", name: "SDS Page", unavailable: true, boundBusinessName: "South Dixie Storage" };
const candidate = { id: "blacor-page", name: "BlaCor Page", unavailable: false };
const step = { key: "create_facebook_campaign", label: "Creating your first Facebook ad campaign" };
const session = { sessionId: "blacor-session", brandId: "blacor", interviewComplete: true,
  consentGranted: true, steps: [step], completedSteps: [] };
const pause = { step, status: "owner_action_required", detail: "Choose your ads Page",
  action: { code: "missing_ad_destination", missing: { page: true, destination: true } } };
const accounts = (pages) => ({ configured: true, connected: true, connectionStatus: "connected",
  accounts: [], selectedAccountId: null, selectedPageId: null, pages });
beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, "", "/dashboard");
  api.getBrand.mockResolvedValue({ brand_id: "blacor", facebook_page_id: null, ad_link_url: null });
  api.getFacebookAccounts.mockResolvedValue(accounts([occupied]));
  api.startSetupSession.mockResolvedValue({ session });
  api.runSetupAction.mockResolvedValue(pause);
  api.startFacebookOAuth.mockResolvedValue({ authUrl: "https://www.facebook.com/local-stub" });
  openAuthUrl.mockReturnValue(false);
});

test("R-LV1 occupied Page is disabled, labeled, and cannot be chosen or saved", async () => {
  render(<AdsDestinationCapture brandId="blacor" onReconnectFacebook={vi.fn()} />);
  const radio = await screen.findByTestId("ads-page-option-sds");
  expect(radio).toBeDisabled();
  expect(screen.getByText("Connected to South Dixie Storage")).toBeInTheDocument();
  fireEvent.click(radio);
  expect(radio).not.toBeChecked();
  expect(screen.getByTestId("ads-destination-save")).toBeDisabled();
  expect(api.selectFacebookPage).not.toHaveBeenCalled();
  expect(api.getFacebookAccounts).toHaveBeenCalledWith("blacor");
});

test.each([[], [occupied]])("R-LV2 zero selectable Pages has the same reconnect affordance (%j)", async (pages) => {
  api.getFacebookAccounts.mockResolvedValue(accounts(pages));
  const reconnect = vi.fn();
  render(<AdsDestinationCapture brandId="blacor" onReconnectFacebook={reconnect} />);
  fireEvent.click(await screen.findByRole("button", { name: "Reconnect Facebook" }));
  expect(reconnect).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("ads-capture-zero-pages")).toBeInTheDocument();
  expect(screen.queryByTestId("ads-capture-single-page-note")).not.toBeInTheDocument();
  expect(screen.getByTestId("ads-destination-save")).toBeDisabled();
});

test("R-LV3 C3 reconnect carries session/return step, excludes stale publish consent, and resumes C3", async () => {
  window.history.replaceState({}, "", "/dashboard?authorizationId=old-publish-consent");
  const view = render(<SetupAgent onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Reconnect Facebook" }));
  await waitFor(() => expect(api.startFacebookOAuth).toHaveBeenCalledWith({
    brandId: "blacor", sessionId: "blacor-session", returnStep: "ads_destination",
  }));
  expect(api.getOnboardingStatus).not.toHaveBeenCalled();
  expect(openAuthUrl).toHaveBeenCalledWith("https://www.facebook.com/local-stub");
  expect(api.dismissSetupSession).not.toHaveBeenCalled();
  expect(api.runSetupAction).toHaveBeenCalledTimes(1);
  view.unmount();
  window.history.replaceState({}, "", "/dashboard?fb=connected&fb_destination=pending&brandId=blacor&sessionId=blacor-session&returnStep=ads_destination");
  api.getFacebookAccounts.mockResolvedValue(accounts([occupied, candidate]));
  render(<SetupAgent onClose={vi.fn()} />);
  expect(await screen.findByTestId("ads-page-option-blacor-page")).not.toBeChecked();
  expect(screen.getByTestId("owner-action-panel")).toBeInTheDocument();
  expect(screen.getByTestId("ads-page-option-sds")).toBeDisabled();
  expect(api.runSetupAction).toHaveBeenLastCalledWith("blacor-session", false, null);
  expect(api.selectFacebookPage).not.toHaveBeenCalled();
  expect(api.dismissSetupSession).not.toHaveBeenCalled();
});

test("R-LV4 newly granted candidate is unselected and makes no destination write", async () => {
  api.getFacebookAccounts.mockResolvedValue(accounts([candidate]));
  render(<AdsDestinationCapture brandId="blacor" onReconnectFacebook={vi.fn()} />);
  expect(await screen.findByTestId("ads-page-option-blacor-page")).not.toBeChecked();
  expect(api.selectFacebookPage).not.toHaveBeenCalled();
});

test("R-LV7 mixed list permits only the available Page and has no reconnect prompt", async () => {
  api.getFacebookAccounts.mockResolvedValue(accounts([occupied, candidate]));
  render(<AdsDestinationCapture brandId="blacor" onReconnectFacebook={vi.fn()} />);
  const available = await screen.findByTestId("ads-page-option-blacor-page");
  expect(available).not.toBeDisabled();
  expect(screen.getByTestId("ads-page-option-sds")).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Reconnect Facebook" })).not.toBeInTheDocument();
  fireEvent.click(available);
  expect(available).toBeChecked();
  fireEvent.click(screen.getByTestId("ads-page-option-sds"));
  expect(screen.getByTestId("ads-page-option-sds")).not.toBeChecked();
  expect(available).toBeChecked();
  expect(api.selectFacebookPage).not.toHaveBeenCalled();
});
