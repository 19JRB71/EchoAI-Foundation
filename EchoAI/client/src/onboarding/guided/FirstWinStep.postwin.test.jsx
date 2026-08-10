// Prompt 024 — client regression: the honest first-post flow.
//
// The post is PREPARED ("saved, ready for your say-so"), never "on the
// calendar"; publishing requires explicit artifact-bound consent (ARM) and
// the consent panel states exact-post / once / destination semantics / 7-day
// lifetime / park-doesn't-cancel; the armed banner offers a real Cancel; an
// invalidated or failed authorization renders honest reconfirmation copy; a
// handed-off post renders the truthful post-claim state.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import FirstWinStep, { CONSENT_COPY_UNBOUND } from "./FirstWinStep.jsx";
import { api } from "../../api";

vi.mock("../../api", () => ({
  api: {
    getBrands: vi.fn(),
    getSubscriptionStatus: vi.fn(),
    generateSocial: vi.fn(),
    getOnboardingStatus: vi.fn(),
    prepareFirstWinPost: vi.fn(),
    armFirstWinPost: vi.fn(),
    disarmFirstWinPost: vi.fn(),
  },
}));

const BRAND = { brand_id: "b1", brand_name: "Test Brand" };

function renderStep({ flags = {}, done = false } = {}) {
  const updateFlags = vi.fn().mockResolvedValue(undefined);
  const merged = done
    ? { firstwin: { choice: "post", done: true }, ...flags }
    : { firstwin: { choice: "post" }, ...flags };
  render(
    <FirstWinStep
      flags={merged}
      updateFlags={updateFlags}
      speak={() => {}}
      onNext={() => {}}
      onBack={() => {}}
    />,
  );
  return { updateFlags };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getBrands.mockResolvedValue({ brands: [BRAND] });
  api.getSubscriptionStatus.mockResolvedValue({ tier: "starter" });
  api.getOnboardingStatus.mockResolvedValue({
    firstWin: null,
    authorization: null,
  });
});

describe("PostWin (Prompt 024 honest flow)", () => {
  it("prepares the chosen variation and shows the consent panel — never 'on the calendar'", async () => {
    api.generateSocial.mockResolvedValue({ variations: ["Hello world post"] });
    api.prepareFirstWinPost.mockResolvedValue({
      post: { postId: "p1", postContent: "Hello world post", status: "prepared" },
    });
    renderStep();

    fireEvent.click(await screen.findByText("Publish my first social post"));
    const input = await screen.findByPlaceholderText(/summer special/i);
    fireEvent.change(input, { target: { value: "our opening" } });
    fireEvent.click(screen.getByText("Write my post"));
    fireEvent.click(await screen.findByText("Use this one"));

    await waitFor(() =>
      expect(
        screen.getByText(/Publish this automatically when I connect Facebook\?/),
      ).toBeInTheDocument(),
    );
    expect(api.prepareFirstWinPost).toHaveBeenCalledWith({
      brandId: "b1",
      postContent: "Hello world post",
    });
    // Honest consent copy: exact post, once, destination semantics, 7 days,
    // park-doesn't-cancel, cancel instructions.
    const consent = screen.getByText(/this exact post/i);
    expect(consent.textContent).toMatch(/published ONCE/);
    expect(consent.textContent).toMatch(/Page you connect\s+during onboarding/);
    expect(consent.textContent).toMatch(/lasts 7 days/);
    expect(consent.textContent).toMatch(/does NOT cancel it/);
    expect(consent.textContent).toMatch(/cancel any time before you\s+connect/i);
    // The dishonest legacy claim is gone.
    expect(screen.queryByText(/on the calendar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/scheduled for tomorrow/i)).not.toBeInTheDocument();
  });

  it("arms with the unbound consent copy version and shows the armed banner with Cancel", async () => {
    api.generateSocial.mockResolvedValue({ variations: ["Post A"] });
    api.prepareFirstWinPost.mockResolvedValue({
      post: { postId: "p1", postContent: "Post A", status: "prepared" },
    });
    api.armFirstWinPost.mockResolvedValue({
      authorization: {
        authorizationId: "a1",
        status: "armed",
        expiresAt: "2026-08-17T00:00:00Z",
      },
    });
    // After arming, the step reloads the truth from the status projection.
    api.getOnboardingStatus.mockResolvedValue({
      firstWin: { postId: "p1", postContent: "Post A", status: "prepared" },
      authorization: {
        authorizationId: "a1",
        status: "armed",
        expired: false,
        expiresAt: "2026-08-17T00:00:00Z",
      },
    });
    renderStep();

    fireEvent.click(await screen.findByText("Publish my first social post"));
    fireEvent.change(await screen.findByPlaceholderText(/summer special/i), {
      target: { value: "t" },
    });
    fireEvent.click(screen.getByText("Write my post"));
    fireEvent.click(await screen.findByText("Use this one"));
    fireEvent.click(
      await screen.findByText("Yes — publish it when I connect Facebook"),
    );

    await waitFor(() =>
      expect(
        screen.getByText(/Ready to publish the moment you connect Facebook/),
      ).toBeInTheDocument(),
    );
    expect(api.armFirstWinPost).toHaveBeenCalledWith({
      postId: "p1",
      consentCopyVersion: CONSENT_COPY_UNBOUND,
    });
    expect(screen.getByText("Cancel this authorization")).toBeInTheDocument();
  });

  it("Cancel disarms and returns to the un-armed consent panel", async () => {
    api.getOnboardingStatus.mockResolvedValue({
      firstWin: { postId: "p1", postContent: "Armed post", status: "prepared" },
      authorization: { authorizationId: "a1", status: "armed", expired: false },
    });
    api.disarmFirstWinPost.mockResolvedValue({ disarmed: true });
    renderStep({ done: true });

    fireEvent.click(await screen.findByText("Cancel this authorization"));
    await waitFor(() => expect(api.disarmFirstWinPost).toHaveBeenCalledWith("a1"));
    await waitFor(() =>
      expect(
        screen.getByText(/Publish this automatically when I connect Facebook\?/),
      ).toBeInTheDocument(),
    );
  });

  it("an expired authorization renders honest reconfirmation copy (nothing was published)", async () => {
    api.getOnboardingStatus.mockResolvedValue({
      firstWin: { postId: "p1", postContent: "Old post", status: "prepared" },
      authorization: {
        authorizationId: "a1",
        status: "armed",
        expired: true,
        reconfirmationRequired: true,
      },
    });
    renderStep({ done: true });

    const notice = await screen.findByText(/authorization expired/i);
    expect(notice.textContent).toMatch(/nothing was published/i);
    expect(notice.textContent).toMatch(/confirm again/i);
    // Re-arming is offered through the same consent panel.
    expect(
      screen.getByText("Yes — publish it when I connect Facebook"),
    ).toBeInTheDocument();
  });

  it("a content_changed invalidation explains itself honestly", async () => {
    api.getOnboardingStatus.mockResolvedValue({
      firstWin: { postId: "p1", postContent: "Edited post", status: "prepared" },
      authorization: {
        authorizationId: "a1",
        status: "invalidated",
        invalidationReason: "content_changed",
        reconfirmationRequired: true,
      },
    });
    renderStep({ done: true });

    const notice = await screen.findByText(/post changed after you authorized it/i);
    expect(notice.textContent).toMatch(/nothing was published/i);
  });

  it("an execution_failed authorization says the publish failed before reaching Facebook", async () => {
    api.getOnboardingStatus.mockResolvedValue({
      firstWin: { postId: "p1", postContent: "Failed post", status: "prepared" },
      authorization: {
        authorizationId: "a1",
        status: "execution_failed",
        reconfirmationRequired: true,
      },
    });
    renderStep({ done: true });

    const notice = await screen.findByText(/publish attempt failed/i);
    expect(notice.textContent).toMatch(/nothing was posted/i);
  });

  it("a handed-off post (no longer prepared) renders the truthful post-claim state", async () => {
    api.getOnboardingStatus.mockResolvedValue({
      firstWin: { postId: "p1", postContent: "Live post", status: "scheduled" },
      authorization: { authorizationId: "a1", status: "claimed" },
    });
    renderStep({ done: true });

    expect(
      await screen.findByText(/handed to the publishing system/i),
    ).toBeInTheDocument();
    // No Cancel — a claimed authorization can no longer be disarmed here.
    expect(screen.queryByText("Cancel this authorization")).not.toBeInTheDocument();
  });
});
