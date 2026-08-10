// Prompt 024 (Section G) — client regression: the connections step presents
// progressive tiers. Nothing is REQUIRED to finish setup; Facebook/Google are
// "Recommended next — pick one"; email and the rest are explicitly optional,
// with the later connectors pointed at Settings → Connections.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ConnectionsStep from "./ConnectionsStep.jsx";

vi.mock("../../api", () => ({
  api: {
    connectEmailAccount: vi.fn(),
  },
}));

function renderStep() {
  render(
    <ConnectionsStep
      statuses={{}}
      readiness={null}
      verification={null}
      flags={{}}
      updateFlags={vi.fn().mockResolvedValue(undefined)}
      speak={() => {}}
      notice={null}
      onDismissNotice={() => {}}
      onNext={() => {}}
      onBack={() => {}}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ConnectionsStep — progressive tiers (Prompt 024)", () => {
  it("says nothing is required and recommends picking ONE account", () => {
    renderStep();
    expect(
      screen.getByText(/Nothing here is required to finish setup/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Recommended next — pick one to start/i),
    ).toBeInTheDocument();
  });

  it("marks the trailing connections as optional and points later connectors at Settings", () => {
    renderStep();
    expect(
      screen.getByText(/Optional — whenever you're ready/i),
    ).toBeInTheDocument();
    const later = screen.getByText(/Later, when you need them/i);
    expect(later.textContent).toMatch(/Twilio/);
    expect(later.textContent).toMatch(/Jobber/);
    expect(later.textContent).toMatch(/ad account/i);
    expect(later.textContent).toMatch(/Settings → Connections/);
  });

  it("still renders the Facebook and Google cards with per-card skip", () => {
    renderStep();
    expect(screen.getByText("Facebook")).toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.getAllByText("Skip for now").length).toBeGreaterThanOrEqual(2);
  });
});
