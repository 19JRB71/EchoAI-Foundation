/**
 * Readiness gate ("no green button without a green backend"): when the
 * server reports a provider's OAuth backend is not configured, the
 * Connections section must show "Setup required" instead of a Connect
 * button — including cards that connect THROUGH that provider (calendar
 * via google, instagram via facebook).
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Connections from "./Connections.jsx";
import { api } from "../api.js";

vi.mock("../api.js", () => ({
  api: { getSetupChecklist: vi.fn() },
}));

function checklist(readiness, verification) {
  return {
    providerVerification: verification,
    items: [
      { key: "google", label: "Google", status: "not_connected" },
      { key: "calendar", label: "Calendar", status: "not_connected" },
      { key: "facebook", label: "Facebook", status: "not_connected" },
      { key: "instagram", label: "Instagram", status: "not_connected" },
      { key: "jobber", label: "Jobber", status: "not_connected" },
    ],
    providerReadiness: readiness,
  };
}

const SETUP_REQUIRED = /Setup required — not configured on this system yet/;

describe("Connections readiness gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("google not ready blocks BOTH the google and calendar cards", async () => {
    api.getSetupChecklist.mockResolvedValue(
      checklist({ google: false, facebook: true, instagram: true, jobber: true }),
    );
    render(<Connections />);
    await waitFor(() =>
      expect(screen.getAllByText(SETUP_REQUIRED)).toHaveLength(2),
    );
    expect(screen.queryByText("Connect Google")).toBeNull();
    expect(screen.queryByText("Connect via Google")).toBeNull();
    // Unaffected providers keep their buttons.
    expect(screen.getByText("Connect Facebook")).toBeTruthy();
    expect(screen.getByText("Connect Jobber")).toBeTruthy();
  });

  it("facebook not ready blocks facebook and instagram; jobber not ready blocks jobber", async () => {
    api.getSetupChecklist.mockResolvedValue(
      checklist({ google: true, facebook: false, instagram: false, jobber: false }),
    );
    render(<Connections />);
    await waitFor(() =>
      expect(screen.getAllByText(SETUP_REQUIRED)).toHaveLength(3),
    );
    expect(screen.queryByText("Connect Facebook")).toBeNull();
    expect(screen.queryByText("Connect via Facebook")).toBeNull();
    expect(screen.queryByText("Connect Jobber")).toBeNull();
    expect(screen.getByText("Connect Google")).toBeTruthy();
  });

  it("configured-but-unverified providers show the awaiting-verification note with Connect still live", async () => {
    api.getSetupChecklist.mockResolvedValue(
      checklist(
        { google: true, facebook: true, instagram: true, jobber: true },
        { google: false, facebook: false, instagram: false, jobber: true },
      ),
    );
    render(<Connections />);
    await waitFor(() =>
      expect(
        screen.getAllByText(/Configured but awaiting verification/),
      ).toHaveLength(4), // google, calendar, facebook, instagram
    );
    // Connect stays available so verification can actually happen.
    expect(screen.getByText("Connect Google")).toBeTruthy();
    expect(screen.getByText("Connect Facebook")).toBeTruthy();
    // Verified provider carries no note.
    expect(screen.getByText("Connect Jobber")).toBeTruthy();
  });

  it("fails open (buttons stay) when readiness is absent from the response", async () => {
    api.getSetupChecklist.mockResolvedValue(checklist(undefined));
    render(<Connections />);
    await waitFor(() => expect(screen.getByText("Connect Google")).toBeTruthy());
    expect(screen.queryByText(SETUP_REQUIRED)).toBeNull();
    expect(screen.getByText("Connect Facebook")).toBeTruthy();
    expect(screen.getByText("Connect Jobber")).toBeTruthy();
  });
});
