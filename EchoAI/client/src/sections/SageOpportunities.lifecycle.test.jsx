import { describe, expect, it } from "vitest";
import { lifecycleLabel, LIFECYCLE_LABELS } from "./SageOpportunities.jsx";

// CEO refinement: executive lifecycle labels are a pure client-side mapping
// onto internal statuses — the server vocabulary never changes.

describe("executive lifecycle labels", () => {
  it("maps New → Reviewed on first open (reviewed_at stamped server-side)", () => {
    expect(lifecycleLabel({ status: "proposed", reviewed_at: null })).toBe("New");
    expect(lifecycleLabel({ status: "proposed", reviewed_at: "2026-07-19T00:00:00Z" })).toBe(
      "Reviewed",
    );
  });

  it("maps decisions and execution states to executive terms", () => {
    expect(lifecycleLabel({ status: "approved" })).toBe("Approved");
    expect(lifecycleLabel({ status: "declined" })).toBe("Rejected");
    expect(lifecycleLabel({ status: "directed" })).toBe("Assigned");
    expect(lifecycleLabel({ status: "in_progress" })).toBe("In Progress");
    expect(lifecycleLabel({ status: "executed" })).toBe("In Progress");
    expect(lifecycleLabel({ status: "measuring" })).toBe("In Progress");
  });

  it("maps every measured outcome to Completed (honest: outcome shown separately)", () => {
    for (const s of ["succeeded", "failed", "inconclusive"]) {
      expect(lifecycleLabel({ status: s })).toBe("Completed");
    }
  });

  it("maps terminal shelving to Archived", () => {
    expect(lifecycleLabel({ status: "archived" })).toBe("Archived");
    expect(lifecycleLabel({ status: "expired" })).toBe("Archived (expired)");
  });

  it("never hides an unknown status — falls back to the raw value", () => {
    expect(lifecycleLabel({ status: "weird_new_status" })).toBe("weird_new_status");
    expect(LIFECYCLE_LABELS.proposed).toBe("New");
  });
});
