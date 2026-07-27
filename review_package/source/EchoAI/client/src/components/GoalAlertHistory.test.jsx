// Regression coverage: the Settings goals panel must let owners browse the full
// 30-day goal-alert history for a brand (via api.getGoalAlerts), including
// dismissed alerts shown faded/tagged, with the same dismiss/mute controls as
// the Mission Control feed. Unlike Mission Control, dismissing here keeps the
// row visible (it's a history, not an inbox).

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../api.js", () => ({
  api: {
    getGoalAlerts: vi.fn(),
    dismissGoalAlert: vi.fn(),
    muteGoalAlerts: vi.fn(),
  },
}));

import { api } from "../api.js";
import GoalAlertHistory from "./GoalAlertHistory.jsx";

const ACTIVE = {
  alertId: "a1",
  goalId: "g1",
  kind: "at_risk_urgent",
  label: "Monthly revenue",
  metricKey: "revenue",
  alertDate: "2026-07-06",
  createdAt: "2026-07-06T08:00:00Z",
  percentToGoal: 42,
  dismissed: false,
  muted: false,
};

const DISMISSED = {
  alertId: "a2",
  goalId: "g2",
  kind: "swing_down",
  label: "New leads",
  metricKey: "leads",
  alertDate: "2026-06-20",
  createdAt: "2026-06-20T08:00:00Z",
  percentToGoal: 61,
  dismissed: true,
  muted: false,
};

function payload(alerts) {
  return { brandId: "b1", brandName: "Acme", alerts };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GoalAlertHistory", () => {
  test("renders the 30-day history including dismissed alerts, tagged and without a dismiss button", async () => {
    api.getGoalAlerts.mockResolvedValue(payload([ACTIVE, DISMISSED]));

    render(<GoalAlertHistory brandId="b1" />);

    await waitFor(() => {
      expect(screen.getByText("Goal Alert History")).toBeInTheDocument();
    });
    expect(api.getGoalAlerts).toHaveBeenCalledWith("b1");
    expect(screen.getByText("Monthly revenue")).toBeInTheDocument();
    expect(screen.getByText("Urgently behind")).toBeInTheDocument();
    expect(screen.getByText("42% to goal")).toBeInTheDocument();
    // Dismissed alert stays in the history, visibly tagged.
    expect(screen.getByText("New leads")).toBeInTheDocument();
    expect(screen.getByText("Dismissed")).toBeInTheDocument();
    // Only the active alert offers a Dismiss button.
    expect(screen.getAllByText("Dismiss")).toHaveLength(1);
  });

  test("shows an empty state when there are no alerts", async () => {
    api.getGoalAlerts.mockResolvedValue(payload([]));

    render(<GoalAlertHistory brandId="b1" />);

    await waitFor(() => {
      expect(
        screen.getByText("No goal alerts in the last 30 days.")
      ).toBeInTheDocument();
    });
  });

  test("dismiss calls the API and fades the row in place instead of removing it", async () => {
    api.getGoalAlerts.mockResolvedValue(payload([ACTIVE]));
    api.dismissGoalAlert.mockResolvedValue({ alertId: "a1", dismissed: true });

    render(<GoalAlertHistory brandId="b1" />);

    await waitFor(() => {
      expect(screen.getByText("Dismiss")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Dismiss"));

    await waitFor(() => {
      expect(api.dismissGoalAlert).toHaveBeenCalledWith("b1", "a1");
      // Row remains (history), now tagged Dismissed with no Dismiss button.
      expect(screen.getByText("Monthly revenue")).toBeInTheDocument();
      expect(screen.getByText("Dismissed")).toBeInTheDocument();
      expect(screen.queryByText("Dismiss")).not.toBeInTheDocument();
    });
  });

  test("mute calls the API and flips the row to muted/unmute", async () => {
    api.getGoalAlerts.mockResolvedValue(payload([ACTIVE]));
    api.muteGoalAlerts.mockResolvedValue({ goalId: "g1", muted: true });

    render(<GoalAlertHistory brandId="b1" />);

    await waitFor(() => {
      expect(screen.getByText("Mute")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Mute"));

    await waitFor(() => {
      expect(api.muteGoalAlerts).toHaveBeenCalledWith("b1", "g1", true);
      expect(screen.getByText("Muted")).toBeInTheDocument();
      expect(screen.getByText("Unmute")).toBeInTheDocument();
    });
  });

  test("a failed dismiss keeps the alert active and shows an error", async () => {
    api.getGoalAlerts.mockResolvedValue(payload([ACTIVE]));
    api.dismissGoalAlert.mockRejectedValue(new Error("nope"));

    render(<GoalAlertHistory brandId="b1" />);

    await waitFor(() => {
      expect(screen.getByText("Dismiss")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Dismiss"));

    await waitFor(() => {
      expect(screen.getByText("nope")).toBeInTheDocument();
    });
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
    expect(screen.queryByText("Dismissed")).not.toBeInTheDocument();
  });

  test("a failed load shows an error instead of a fabricated empty history", async () => {
    api.getGoalAlerts.mockRejectedValue(new Error("boom"));

    render(<GoalAlertHistory brandId="b1" />);

    await waitFor(() => {
      expect(screen.getByText("boom")).toBeInTheDocument();
    });
    expect(
      screen.queryByText("No goal alerts in the last 30 days.")
    ).not.toBeInTheDocument();
  });

  test("renders nothing without a brandId", () => {
    const { container } = render(<GoalAlertHistory brandId={null} />);
    expect(container.firstChild).toBeNull();
    expect(api.getGoalAlerts).not.toHaveBeenCalled();
  });
});
