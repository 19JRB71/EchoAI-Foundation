import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../api.js", () => ({
  api: {
    getBrands: vi.fn(),
    probeSetupSession: vi.fn(),
    startSetupSession: vi.fn(),
    runSetupAction: vi.fn(),
    pauseSetupSession: vi.fn(),
    pauseSetupSessionBeacon: vi.fn(),
    getFacebookAccounts: vi.fn(),
    setFacebookBrandPage: vi.fn(),
    startFacebookOAuth: vi.fn(),
    disconnectFacebook: vi.fn(),
    selectFacebookPage: vi.fn(),
    updateBrand: vi.fn(),
  },
}));

import { api } from "../api.js";
import SetupAgent from "./SetupAgent.jsx";
import { FacebookPagePicker } from "../sections/social/ConnectedAccounts.jsx";

const BRAND_ID = "brand-pm8";
const PAGES = [
  { id: "p-100", name: "Main Street Storage", category: "Storage Facility" },
  { id: "p-200", name: "Second Page", category: null },
];
const DEFERRED_CAMPAIGN = {
  status: "failed",
  code: "provider_manual_review",
  retryable: false,
  message: "Facebook needs manual review.",
  ref: "73f3eef0-e65f-4795-a497-57efddaab508",
  journey_disposition: "deferred",
  deferred_reason: "pending_provider_review",
  owner_directed: true,
  deferred_at: "2026-08-20T16:33:19.917Z",
};
const SESSION = {
  sessionId: "session-pm8",
  status: "in_progress",
  interviewComplete: true,
  consentGranted: true,
  brandId: BRAND_ID,
  completedSteps: ["create_facebook_campaign"],
  stepOutcomes: { create_facebook_campaign: DEFERRED_CAMPAIGN },
  steps: [
    { key: "create_facebook_campaign", label: "Create campaign" },
    { key: "connect_social", label: "Connect social" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getBrands.mockResolvedValue([]);
  api.probeSetupSession.mockResolvedValue({ openSession: true });
  api.startSetupSession.mockResolvedValue({ session: SESSION });
  api.pauseSetupSession.mockResolvedValue(undefined);
  api.getFacebookAccounts.mockResolvedValue({
    configured: true,
    connected: true,
    connectionStatus: "connected",
    accounts: [{ id: "act_1", name: "Ad Account" }],
    selectedAccountId: "act_1",
    pages: PAGES,
    selectedPageId: null,
  });
  api.setFacebookBrandPage.mockResolvedValue({ connected: true });
  api.runSetupAction
    .mockResolvedValueOnce({
      step: { key: "connect_social", label: "Connect social" },
      status: "needs_connection",
      connect: { type: "social_select_page", platform: "facebook" },
      detail: "Choose the Facebook Page this business should post from.",
      session: SESSION,
    })
    .mockResolvedValueOnce({
      step: { key: "connect_social", label: "Connect social" },
      status: "done",
      detail: "Facebook Page connected.",
    })
    .mockResolvedValueOnce({ allComplete: true });
});

describe("SetupAgent PM8 inline Facebook Page picker", () => {
  test("I80 pending callback retains authorization context until explicit C1 confirmation", async () => {
    window.history.replaceState({}, "", `/?fb=pending&brandId=${BRAND_ID}&sessionId=${SESSION.sessionId}&authorizationId=auth-i80&returnStep=connect_social`);
    try {
      render(<SetupAgent embedded inlineExitDestination={{ section: "social", tab: "accounts" }} />);
      fireEvent.click(await screen.findByRole("radio", { name: /Second Page/ }));
      expect(api.setFacebookBrandPage).not.toHaveBeenCalled();
      expect(api.runSetupAction).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Use this Page" }));
      await waitFor(() => expect(api.setFacebookBrandPage).toHaveBeenCalledExactlyOnceWith({
        brandId: BRAND_ID, pageId: "p-200", sessionId: SESSION.sessionId,
        authorizationId: "auth-i80", intent: "confirm_business_facebook_page",
      }));
      await screen.findByText("Your account is ready");
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });

  test("I80 wrong-business callback fails closed before running setup", async () => {
    window.history.replaceState({}, "", "/?fb=pending&brandId=other&sessionId=other-session");
    try {
      render(<SetupAgent embedded />);
      expect(await screen.findByText(/Facebook returned to a different business setup/)).toBeInTheDocument();
      expect(api.runSetupAction).not.toHaveBeenCalled();
      expect(api.setFacebookBrandPage).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });

  test("reads PM3 accounts, requires selection, writes Store 2 once, then rechecks normally", async () => {
    const onInlineExitComplete = vi.fn();
    render(
      <SetupAgent
        embedded
        onClose={vi.fn()}
        onExitToSection={vi.fn()}
        inlineExitDestination={{ section: "social", tab: "accounts" }}
        onInlineExitComplete={onInlineExitComplete}
      />,
    );

    expect(await screen.findByTestId("setup-inline-facebook-page-picker")).toBeInTheDocument();
    expect(api.getFacebookAccounts).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Main Street Storage")).toBeInTheDocument();
    expect(screen.getByText("Second Page")).toBeInTheDocument();

    const useButton = screen.getByRole("button", { name: "Use this Page" });
    expect(useButton).toBeDisabled();
    expect(api.setFacebookBrandPage).not.toHaveBeenCalled();
    expect(api.startFacebookOAuth).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /reconnect facebook/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /disconnect/i })).not.toBeInTheDocument();
    expect(api.selectFacebookPage).not.toHaveBeenCalled();
    expect(api.updateBrand).not.toHaveBeenCalled();
    expect(api.runSetupAction).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("radio", { name: /Second Page/i }));
    expect(useButton).toBeEnabled();
    expect(api.setFacebookBrandPage).not.toHaveBeenCalled();
    expect(api.runSetupAction).toHaveBeenCalledTimes(1);

    fireEvent.click(useButton);
    await waitFor(() =>
      expect(api.setFacebookBrandPage).toHaveBeenCalledWith({
        brandId: BRAND_ID,
        pageId: "p-200",
        sessionId: SESSION.sessionId,
        intent: "confirm_business_facebook_page",
      }),
    );
    expect(api.setFacebookBrandPage).toHaveBeenCalledTimes(1);
    expect(api.selectFacebookPage).not.toHaveBeenCalled();
    expect(api.updateBrand).not.toHaveBeenCalled();
    expect(await screen.findByText("Your account is ready")).toBeInTheDocument();
    expect(api.runSetupAction).toHaveBeenCalledTimes(3);
    expect(onInlineExitComplete).toHaveBeenCalledTimes(1);
    expect(DEFERRED_CAMPAIGN).toMatchObject({
      code: "provider_manual_review",
      journey_disposition: "deferred",
      owner_directed: true,
    });
  });

  test("the normal Connected Accounts picker requires selection and keeps provider controls", async () => {
    render(<FacebookPagePicker brandId={BRAND_ID} onConnected={vi.fn()} />);

    const firstPage = await screen.findByRole("radio", { name: /Main Street Storage/i });
    expect(firstPage).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Use this Page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reconnect Facebook" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(api.setFacebookBrandPage).not.toHaveBeenCalled();
  });

  test.each([0, 1, 2])("I80-C1: %i granted Pages never infer a selection, even with selectedPageId", async (count) => {
    api.getFacebookAccounts.mockResolvedValue({
      configured: true, connected: true, pages: PAGES.slice(0, count), selectedPageId: PAGES[0].id,
    });
    render(<FacebookPagePicker brandId={BRAND_ID} onConnected={vi.fn()} />);
    await waitFor(() => expect(api.getFacebookAccounts).toHaveBeenCalledWith(BRAND_ID));
    if (!count) {
      expect(await screen.findByText(/don’t see any Pages/i)).toBeInTheDocument();
    } else {
      await screen.findByText(PAGES[0].name);
      screen.getAllByRole("radio").forEach((radio) => expect(radio).not.toBeChecked());
      expect(screen.getByRole("button", { name: "Use this Page" })).toBeDisabled();
    }
    expect(api.setFacebookBrandPage).not.toHaveBeenCalled();
  });

  test("I80-C1: occupied Page labelled and disabled; explicit free Page confirmation writes only Store 2", async () => {
    api.getFacebookAccounts.mockResolvedValue({
      configured: true, connected: true,
      pages: [{ ...PAGES[0], unavailable: true, boundBusinessName: "Other business" }, PAGES[1]],
    });
    const onConnected = vi.fn();
    render(<FacebookPagePicker brandId={BRAND_ID} onConnected={onConnected} />);
    expect(await screen.findByRole("radio", { name: /Other business/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Second Page/ }));
    expect(api.setFacebookBrandPage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use this Page" }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("p-200"));
    expect(api.setFacebookBrandPage).toHaveBeenCalledExactlyOnceWith({
      brandId: BRAND_ID, pageId: "p-200", intent: "confirm_business_facebook_page",
    });
    expect(api.selectFacebookPage).not.toHaveBeenCalled();
    expect(api.updateBrand).not.toHaveBeenCalled();
  });

  test("I80-C1: selectionOnly returns explicit Page identity without any writer", async () => {
    const onConnected = vi.fn();
    render(<FacebookPagePicker brandId={BRAND_ID} selectionOnly onConnected={onConnected} />);
    fireEvent.click(await screen.findByRole("radio", { name: /Second Page/ }));
    expect(onConnected).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use this Page" }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("p-200"));
    expect(api.setFacebookBrandPage).not.toHaveBeenCalled();
    expect(api.selectFacebookPage).not.toHaveBeenCalled();
    expect(api.updateBrand).not.toHaveBeenCalled();
  });
});