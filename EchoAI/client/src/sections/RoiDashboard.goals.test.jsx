// Regression coverage: the ROI dashboard's "Revenue Goals" panel must render on
// BOTH tier paths. A full-validation review caught that Enterprise users (who get
// AdvancedRoiDashboard) were missing the goals panel entirely, since it lived only
// inside the basic dashboard. These tests render the real <RoiDashboard> with a
// mocked api and assert the Revenue Goals panel shows for both Enterprise and a
// lower tier.

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../api.js", () => ({
  api: {
    getDepartmentGoals: vi.fn(),
    getRoi: vi.fn(),
    getRoiHistory: vi.fn(),
    generateRoiReport: vi.fn(),
    getRoiAdvancedSummary: vi.fn(),
    getRoiAdvancedHistory: vi.fn(),
    generateRoiAdvancedAnalysis: vi.fn(),
    getRoiAdvancedSnapshot: vi.fn(),
  },
}));

import { api } from "../api.js";
import RoiDashboard from "./RoiDashboard.jsx";

beforeEach(() => {
  vi.clearAllMocks();
  // DepartmentGoals self-fetches the department's goals; return one revenue goal.
  api.getDepartmentGoals.mockResolvedValue({
    score: 50,
    goals: [
      {
        goalId: "g1",
        category: "revenue",
        metricKey: "revenue",
        label: "Monthly revenue",
        targetValue: 10000,
        currentValue: 5000,
        percentToGoal: 50,
        status: "on_track",
        period: "monthly",
      },
    ],
  });
  // Basic path needs a truthy roi object so the body (with the goals panel) renders.
  api.getRoi.mockResolvedValue({
    roi: { headline: {}, subscription: { monthlyPrice: 100 } },
  });
  api.getRoiHistory.mockResolvedValue({ history: [] });
  // Advanced path (Enterprise) — safe rejects; the goals panel is a sibling and
  // renders regardless of the advanced dashboard's own load state.
  api.getRoiAdvancedSummary.mockRejectedValue(new Error("no data"));
  api.getRoiAdvancedHistory.mockRejectedValue(new Error("no data"));
});

describe("RoiDashboard revenue goals panel", () => {
  test("renders the Revenue Goals panel for Enterprise (advanced path)", async () => {
    render(<RoiDashboard brandId="b1" currentTier="enterprise" onUpgrade={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("Revenue Goals")).toBeInTheDocument();
    });
  });

  test("renders the Revenue Goals panel for a lower tier (basic path)", async () => {
    render(<RoiDashboard brandId="b1" currentTier="starter" onUpgrade={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("Revenue Goals")).toBeInTheDocument();
    });
  });
});
