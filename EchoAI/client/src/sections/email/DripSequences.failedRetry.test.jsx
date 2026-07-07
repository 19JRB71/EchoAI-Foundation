// End-to-end UI coverage for drip-sequence failed-recipient recovery: a drip
// with failedCount > 0 shows a "N failed recipients — view & retry" toggle;
// opening it lists the failed recipients from getEmailCampaignDetail; per-row
// Retry calls retryEmailDripRecipient and flips the row to "Queued for retry".

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../api.js", () => ({
  api: {
    getEmailCampaigns: vi.fn(),
    getEmailCampaignDetail: vi.fn(),
    retryEmailDripRecipient: vi.fn(),
  },
}));

import { api } from "../../api.js";
import DripSequences from "./DripSequences.jsx";

const CAMPAIGN = {
  campaignId: "c-1",
  campaignName: "Welcome series",
  campaignType: "drip",
  status: "active",
  segment: "all",
  sentCount: 8,
  openCount: 4,
  openRate: 0.5,
  clickCount: 1,
  clickRate: 0.125,
  failedCount: 2,
};

const FAILED_RECIPIENTS = [
  {
    recipient_id: "r-1",
    email_address: "alice@example.com",
    delivery_status: "failed",
    current_step: 0,
  },
  {
    recipient_id: "r-2",
    email_address: "bob@example.com",
    delivery_status: "failed",
    current_step: 1,
  },
  {
    recipient_id: "r-3",
    email_address: "carol@example.com",
    delivery_status: "sent",
    current_step: 2,
  },
];

describe("DripSequences failed-recipient retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getEmailCampaigns.mockResolvedValue({ campaigns: [CAMPAIGN] });
    api.getEmailCampaignDetail.mockResolvedValue({ recipients: FAILED_RECIPIENTS });
    api.retryEmailDripRecipient.mockResolvedValue({});
  });

  test("renders the failed-recipient toggle and lists only failed recipients", async () => {
    render(<DripSequences brandId="b-1" />);

    const toggle = await screen.findByRole("button", {
      name: "2 failed recipients — view & retry",
    });
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(api.getEmailCampaignDetail).toHaveBeenCalledWith("c-1")
    );

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    // The "sent" recipient must be filtered out of the failed list.
    expect(screen.queryByText("carol@example.com")).not.toBeInTheDocument();
  });

  test("per-row Retry calls retryEmailDripRecipient and shows Queued for retry", async () => {
    render(<DripSequences brandId="b-1" />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "2 failed recipients — view & retry",
      })
    );

    await screen.findByText("alice@example.com");
    const retryButtons = screen.getAllByRole("button", { name: "Retry" });
    expect(retryButtons).toHaveLength(2);

    fireEvent.click(retryButtons[0]);

    await waitFor(() =>
      expect(api.retryEmailDripRecipient).toHaveBeenCalledWith("c-1", "r-1")
    );
    expect(await screen.findByText("Queued for retry")).toBeInTheDocument();
    // The second row is untouched — still one live Retry button.
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
  });
});
