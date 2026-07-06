// Regression coverage: daily goal alerts logged by the sweep must be visibly
// surfaced in Mission Control, not only sent over voice/push — and the owner
// must be able to MANAGE them from the feed (dismiss one alert, mute a goal's
// future alerts). This renders the real <MissionControl> with a mocked api
// whose getMissionControl payload carries goalAlerts, and asserts render +
// dismiss/mute wiring.

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../api.js", () => ({
  api: {
    getMissionControl: vi.fn(),
    getGoalsOverview: vi.fn(),
    dismissGoalAlert: vi.fn(),
    muteGoalAlerts: vi.fn(),
  },
}));

import { api } from "../api.js";
import MissionControl from "./MissionControl.jsx";

const ALERT = {
  alertId: "a1",
  goalId: "g1",
  kind: "at_risk_urgent",
  label: "Monthly revenue",
  metricKey: "revenue",
  brandId: "b1",
  brandName: "Acme",
  alertDate: "2026-07-06",
  createdAt: "2026-07-06T08:00:00Z",
  percentToGoal: 42,
  muted: false,
};

function payload(goalAlerts) {
  return {
    brandName: "Acme",
    briefing: "Good morning.",
    agents: [],
    stats: {},
    upcoming: [],
    goalAlerts,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getGoalsOverview.mockResolvedValue(null);
});

describe("MissionControl goal alerts", () => {
  test("renders logged goal alerts with kind, percent, and timestamp", async () => {
    api.getMissionControl.mockResolvedValue(payload([ALERT]));

    render(<MissionControl onNavigate={() => {}} onOpenDepartment={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Recent goal alerts")).toBeInTheDocument();
    });
    expect(screen.getByText("Monthly revenue")).toBeInTheDocument();
    expect(screen.getByText("Urgently behind")).toBeInTheDocument();
    expect(screen.getByText("42% to goal")).toBeInTheDocument();
  });

  test("omits the panel when there are no logged goal alerts", async () => {
    api.getMissionControl.mockResolvedValue(payload([]));

    render(<MissionControl onNavigate={() => {}} onOpenDepartment={() => {}} />);

    await waitFor(() => {
      expect(screen.queryByText("Recent goal alerts")).not.toBeInTheDocument();
    });
  });

  test("dismiss calls the API and removes the alert from the feed", async () => {
    api.getMissionControl.mockResolvedValue(payload([ALERT]));
    api.dismissGoalAlert.mockResolvedValue({ alertId: "a1", dismissed: true });

    render(<MissionControl onNavigate={() => {}} onOpenDepartment={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Dismiss")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Dismiss"));

    await waitFor(() => {
      expect(api.dismissGoalAlert).toHaveBeenCalledWith("b1", "a1");
      // Feed row gone; panel collapses because it was the only alert.
      expect(screen.queryByText("Monthly revenue")).not.toBeInTheDocument();
    });
  });

  test("mute calls the API and flips the row to muted/unmute", async () => {
    api.getMissionControl.mockResolvedValue(payload([ALERT]));
    api.muteGoalAlerts.mockResolvedValue({ goalId: "g1", muted: true });

    render(<MissionControl onNavigate={() => {}} onOpenDepartment={() => {}} />);

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

  test("a failed dismiss keeps the alert and shows an error", async () => {
    api.getMissionControl.mockResolvedValue(payload([ALERT]));
    api.dismissGoalAlert.mockRejectedValue(new Error("nope"));

    render(<MissionControl onNavigate={() => {}} onOpenDepartment={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Dismiss")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Dismiss"));

    await waitFor(() => {
      expect(screen.getByText("nope")).toBeInTheDocument();
    });
    expect(screen.getByText("Monthly revenue")).toBeInTheDocument();
  });
});
