// The calendar/scheduling views must warn the owner when a connected social
// account's stored login has stopped working (connection_status 'error') so
// they can reconnect BEFORE more scheduled posts fail. The banner lists the
// broken platforms and jumps to the Connected Accounts tab via the same
// onReconnect wiring the failed-post shortcut uses. It stays hidden when all
// accounts are healthy and when the accounts fetch itself fails (best-effort).

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../api.js", () => ({
  api: {
    getSocialAccounts: vi.fn(),
  },
}));

import { api } from "../../api.js";
import AccountHealthBanner from "./AccountHealthBanner.jsx";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AccountHealthBanner", () => {
  test("renders nothing when every account is healthy", async () => {
    api.getSocialAccounts.mockResolvedValue({
      accounts: [
        { platform: "facebook", status: "connected" },
        { platform: "twitter", status: "connected" },
      ],
    });
    render(<AccountHealthBanner brandId="b1" onReconnect={() => {}} />);
    await waitFor(() => expect(api.getSocialAccounts).toHaveBeenCalledWith("b1"));
    expect(screen.queryByTestId("account-health-banner")).toBeNull();
  });

  test("renders nothing when the accounts fetch fails (best-effort)", async () => {
    api.getSocialAccounts.mockRejectedValue(new Error("network down"));
    render(<AccountHealthBanner brandId="b1" onReconnect={() => {}} />);
    await waitFor(() => expect(api.getSocialAccounts).toHaveBeenCalled());
    expect(screen.queryByTestId("account-health-banner")).toBeNull();
  });

  test("does not fetch without a brandId", () => {
    render(<AccountHealthBanner brandId={null} onReconnect={() => {}} />);
    expect(api.getSocialAccounts).not.toHaveBeenCalled();
  });

  test("warns about a single broken account and reconnects via onReconnect(platform)", async () => {
    api.getSocialAccounts.mockResolvedValue({
      accounts: [
        { platform: "facebook", status: "error" },
        { platform: "twitter", status: "connected" },
      ],
    });
    const onReconnect = vi.fn();
    render(<AccountHealthBanner brandId="b1" onReconnect={onReconnect} />);

    expect(
      await screen.findByText("Your Facebook account needs attention")
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect Facebook" }));
    expect(onReconnect).toHaveBeenCalledWith("facebook");
  });

  test("lists every broken platform with its own reconnect button", async () => {
    api.getSocialAccounts.mockResolvedValue({
      accounts: [
        { platform: "facebook", status: "error" },
        { platform: "linkedin", status: "error" },
        { platform: "twitter", status: "connected" },
      ],
    });
    const onReconnect = vi.fn();
    render(<AccountHealthBanner brandId="b1" onReconnect={onReconnect} />);

    expect(
      await screen.findByText("2 connected accounts need attention")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reconnect Facebook" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect LinkedIn" }));
    expect(onReconnect).toHaveBeenCalledWith("linkedin");
  });
});
