// Prompt 011 corrective FIX 2 — mandated client coverage for the native
// knowledge-revision card in the Approvals Inbox: native badge, approve /
// reject through the knowledge endpoints, and projection refresh after a
// decision.

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../api.js", () => ({
  api: {
    getApprovalsInbox: vi.fn(),
    approveKnowledgeRevision: vi.fn(),
    rejectKnowledgeRevision: vi.fn(),
    resolveApprovalTask: vi.fn(),
  },
}));

import { api } from "../api.js";
import ApprovalsInbox from "./ApprovalsInbox.jsx";

const BRAND = "b-1";

// Shape mirrors controllers/approvalsController.js native revision items.
const KNOWLEDGE_ITEM = {
  id: "revision:r-9",
  source: "native",
  kind: "knowledge_revision",
  feature: "Business Profile",
  title: "Proposed update to description (sage draft)",
  detail: null,
  brandId: BRAND,
  brandName: "Pole Barn Kits",
  createdAt: "2026-08-08T12:00:00Z",
  revisionId: "r-9",
  fieldKey: "description",
  sourceKind: "public_web",
  actions: ["approve", "reject"],
  goToSection: "sage",
};

function inbox(items) {
  return {
    items,
    counts: { total: items.length, spine: 0, native: items.length, adapter: 0 },
    adapterInventory: [
      { key: "autopilot_item" },
      { key: "growth_action" },
      { key: "email_draft" },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ApprovalsInbox native knowledge-revision card", () => {
  test("renders the card with the Native badge and the business-profile label", async () => {
    api.getApprovalsInbox.mockResolvedValue(inbox([KNOWLEDGE_ITEM]));
    render(<ApprovalsInbox brandId={BRAND} />);
    expect(await screen.findByText(/business profile proposal/i)).toBeInTheDocument();
    expect(screen.getByText(/^native$/i)).toBeInTheDocument();
    expect(
      screen.getByText("Proposed update to description (sage draft)")
    ).toBeInTheDocument();
  });

  test("a contested proposal surfaces the CONTESTED warning on the card", async () => {
    api.getApprovalsInbox.mockResolvedValue(
      inbox([{ ...KNOWLEDGE_ITEM, detail: "CONTESTED — sources disagree; review the provenance before deciding." }])
    );
    render(<ApprovalsInbox brandId={BRAND} />);
    expect(await screen.findByText(/contested — sources disagree/i)).toBeInTheDocument();
  });

  test("Approve decides through the knowledge endpoint and refreshes the projection", async () => {
    api.getApprovalsInbox
      .mockResolvedValueOnce(inbox([KNOWLEDGE_ITEM]))
      .mockResolvedValueOnce(inbox([]));
    api.approveKnowledgeRevision.mockResolvedValue({ ok: true });
    render(<ApprovalsInbox brandId={BRAND} />);
    fireEvent.click(await screen.findByRole("button", { name: /approve/i }));
    await waitFor(() =>
      expect(api.approveKnowledgeRevision).toHaveBeenCalledWith(BRAND, "r-9"));
    await waitFor(() => expect(api.getApprovalsInbox).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(/approved — recorded as a new version/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/business profile proposal/i)).not.toBeInTheDocument();
  });

  test("Reject decides through the knowledge endpoint and the card leaves the inbox", async () => {
    api.getApprovalsInbox
      .mockResolvedValueOnce(inbox([KNOWLEDGE_ITEM]))
      .mockResolvedValueOnce(inbox([]));
    api.rejectKnowledgeRevision.mockResolvedValue({ ok: true });
    render(<ApprovalsInbox brandId={BRAND} />);
    fireEvent.click(await screen.findByRole("button", { name: /reject/i }));
    await waitFor(() =>
      expect(api.rejectKnowledgeRevision).toHaveBeenCalledWith(BRAND, "r-9"));
    await waitFor(() => expect(api.getApprovalsInbox).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(/rejected — the proposal is kept in history/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/business profile proposal/i)).not.toBeInTheDocument();
  });
});
