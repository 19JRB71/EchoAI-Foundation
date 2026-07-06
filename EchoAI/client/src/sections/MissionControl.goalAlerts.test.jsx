// Regression coverage: daily goal alerts logged by the sweep must be visibly
// surfaced in Mission Control, not only sent over voice/push. A full-validation
// review caught that the alert log was never read back into the UI. This renders
// the real <MissionControl> with a mocked api whose getMissionControl payload
// carries goalAlerts, and asserts they render in the "Recent goal alerts" panel.

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../api.js", () => ({
  api: {
    getMissionControl: vi.fn(),
    getGoalsOverview: vi.fn(),
  },
}));

import { api } from "../api.js";
import MissionControl from "./MissionControl.jsx";

beforeEach(() => {
  vi.clearAllMocks();
  api.getGoalsOverview.mockResolvedValue(null);
});

describe("MissionControl goal alerts", () => {
  test("renders logged goal alerts in the Recent goal alerts panel", async () => {
    api.getMissionControl.mockResolvedValue({
      brandName: "Acme",
      briefing: "Good morning.",
      agents: [],
      stats: {},
      upcoming: [],
      goalAlerts: [
        {
          goalId: "g1",
          kind: "at_risk_urgent",
          label: "Monthly revenue",
          metricKey: "revenue",
          brandId: "b1",
          brandName: "Acme",
          alertDate: "2026-07-06",
        },
      ],
    });

    render(<MissionControl onNavigate={() => {}} onOpenDepartment={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Recent goal alerts")).toBeInTheDocument();
    });
    expect(screen.getByText("Monthly revenue")).toBeInTheDocument();
    expect(screen.getByText("Urgently behind")).toBeInTheDocument();
  });

  test("omits the panel when there are no logged goal alerts", async () => {
    api.getMissionControl.mockResolvedValue({
      brandName: "Acme",
      briefing: "Good morning.",
      agents: [],
      stats: {},
      upcoming: [],
      goalAlerts: [],
    });

    render(<MissionControl onNavigate={() => {}} onOpenDepartment={() => {}} />);

    await waitFor(() => {
      expect(screen.queryByText("Recent goal alerts")).not.toBeInTheDocument();
    });
  });
});
