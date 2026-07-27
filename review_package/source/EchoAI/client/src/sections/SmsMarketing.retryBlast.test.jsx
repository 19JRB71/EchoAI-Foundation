// End-to-end UI coverage for one-tap SMS blast recovery: a failed campaign
// shows an amber "Retry Blast" button that calls retrySmsCampaign and reloads;
// non-failed campaigns must not show it.

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../api.js", () => ({
  api: {
    getSmsCampaigns: vi.fn(),
    retrySmsCampaign: vi.fn(),
  },
}));

import { api } from "../api.js";
import SmsMarketing from "./SmsMarketing.jsx";

function campaign(overrides) {
  return {
    campaign_id: "sms-1",
    campaign_name: "Flash sale",
    message_content: "50% off today only!",
    status: "failed",
    recipient_count: 120,
    delivered_count: 0,
    reply_count: 0,
    created_at: "2026-07-01T10:00:00Z",
    sent_at: null,
    ...overrides,
  };
}

describe("SmsMarketing Retry Blast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.retrySmsCampaign.mockResolvedValue({});
  });

  test("failed campaign shows Retry Blast, calls retrySmsCampaign, and reloads", async () => {
    // First load returns the failed campaign; after retry it comes back sending.
    api.getSmsCampaigns
      .mockResolvedValueOnce({ campaigns: [campaign()] })
      .mockResolvedValueOnce({ campaigns: [campaign({ status: "sending" })] });

    render(<SmsMarketing brandId="b-1" />);

    const retry = await screen.findByRole("button", { name: "Retry Blast" });
    fireEvent.click(retry);

    await waitFor(() =>
      expect(api.retrySmsCampaign).toHaveBeenCalledWith("sms-1")
    );
    // load() runs again after retry (initial + post-retry reload).
    await waitFor(() => expect(api.getSmsCampaigns).toHaveBeenCalledTimes(2));
    // Once re-fetched as "sending", the Retry Blast button is gone.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Retry Blast" })
      ).not.toBeInTheDocument()
    );
  });

  test("a non-failed campaign does not render Retry Blast", async () => {
    api.getSmsCampaigns.mockResolvedValue({
      campaigns: [campaign({ status: "sent", delivered_count: 120 })],
    });

    render(<SmsMarketing brandId="b-1" />);

    expect(await screen.findByText("Flash sale")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry Blast" })
    ).not.toBeInTheDocument();
    expect(api.retrySmsCampaign).not.toHaveBeenCalled();
  });
});
