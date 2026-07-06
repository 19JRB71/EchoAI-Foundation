// Regression coverage for the Settings half of the goal-alert deep link: the
// focusGoals nonce must force the Account tab (even if another tab was the
// initial one) and scroll to the Goals + Goal Alert History container, and a
// fresh nonce must re-scroll on repeated click-throughs.

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../api.js", () => ({
  api: {
    getProfile: vi.fn(),
    getTwilioConfig: vi.fn(),
    getBrand: vi.fn(),
    getTourStatus: vi.fn(),
  },
}));

// Account-tab children irrelevant to the scroll behavior become stubs; the
// goals cards get recognizable markers so we can assert which tab rendered.
vi.mock("./BrandDiscovery.jsx", () => ({ default: () => null }));
vi.mock("./billing/Billing.jsx", () => ({
  default: () => <div>billing-tab-content</div>,
}));
vi.mock("../components/FacebookConnect.jsx", () => ({ default: () => null }));
vi.mock("../components/GoalEditorCard.jsx", () => ({
  default: ({ brandId }) => <div>goal-editor:{String(brandId)}</div>,
}));
vi.mock("../components/GoalAlertHistory.jsx", () => ({
  default: () => <div>goal-alert-history</div>,
}));
vi.mock("./team/TeamManagement.jsx", () => ({ default: () => null }));

import { api } from "../api.js";
import Settings from "./Settings.jsx";

beforeEach(() => {
  vi.clearAllMocks();
  api.getProfile.mockResolvedValue({ email: "owner@example.com" });
  api.getTwilioConfig.mockResolvedValue({ configured: false });
  api.getBrand.mockResolvedValue({ brand_id: 202, brand_name: "Business B" });
  api.getTourStatus.mockResolvedValue({ tours: {} });
  Element.prototype.scrollIntoView = vi.fn();
});

describe("Settings focusGoals deep link", () => {
  test("the focusGoals nonce lands on the Account tab and scrolls the goals container", async () => {
    // Start on the Billing tab to prove the nonce forces the switch back.
    render(
      <Settings
        brandId={202}
        initialTab="billing"
        focusGoals={Date.now()}
        workspaceRole="owner"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("goal-editor:202")).toBeInTheDocument();
    });
    expect(screen.getByText("goal-alert-history")).toBeInTheDocument();
    expect(screen.queryByText("billing-tab-content")).not.toBeInTheDocument();

    // The scroll targets the container wrapping the goals cards.
    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
      });
    });
    const scrolled =
      Element.prototype.scrollIntoView.mock.instances[0] ||
      Element.prototype.scrollIntoView.mock.contexts?.[0];
    expect(scrolled).toBeTruthy();
    expect(scrolled.contains(screen.getByText("goal-editor:202"))).toBe(true);
    expect(scrolled.contains(screen.getByText("goal-alert-history"))).toBe(true);
  });

  test("no focusGoals → no forced tab switch and no scrolling", async () => {
    render(
      <Settings
        brandId={202}
        initialTab="billing"
        focusGoals={null}
        workspaceRole="owner"
      />,
    );

    expect(screen.getByText("billing-tab-content")).toBeInTheDocument();
    expect(screen.queryByText("goal-editor:202")).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 80));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  test("a fresh nonce re-scrolls on a repeated click-through", async () => {
    const { rerender } = render(
      <Settings
        brandId={202}
        initialTab="account"
        focusGoals={1000}
        workspaceRole="owner"
      />,
    );
    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    });

    rerender(
      <Settings
        brandId={202}
        initialTab="account"
        focusGoals={2000}
        workspaceRole="owner"
      />,
    );
    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
    });
  });
});
