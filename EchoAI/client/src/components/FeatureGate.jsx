// Wraps a gated dashboard section. When the user's tier meets the requirement,
// the children render. Otherwise a persuasive upgrade prompt is shown instead.
//
// While the tier is still unknown (status not yet loaded) we render nothing to
// avoid flashing the upgrade prompt to a user who actually has access.

import { meetsTier, tierName, tierPrice } from "../lib/tiers.js";
import Spinner from "./Spinner.jsx";

const FEATURE_COPY = {
  video: {
    title: "Video Content",
    blurb: "Generate complete AI video packages — hook, scenes, CTA, and thumbnail — ready to shoot.",
  },
  sales: {
    title: "Sales Scripts",
    blurb: "Get AI-written sales scripts for cold calls, warm follow-ups, and in-person meetings.",
  },
  reputation: {
    title: "Reputation Management",
    blurb: "Pull in your reviews and post AI-assisted replies across Google and Facebook.",
  },
  phone: {
    title: "AI Phone Agent",
    blurb: "Let a Twilio-powered AI agent answer inbound calls and follow up with hot leads.",
  },
  zapier: {
    title: "Zapier Integration",
    blurb: "Send leads and events to Zapier, Make, Slack, and thousands of other apps.",
  },
  adstudio: {
    title: "AI Ad Creative Studio",
    blurb: "Generate complete ad creative packages and launch them straight into Facebook.",
  },
  feedback: {
    title: "Customer Feedback & Surveys",
    blurb: "Design AI surveys and turn responses into actionable feedback reports.",
  },
  affiliate: {
    title: "Affiliate Program",
    blurb: "Earn recurring commission by referring new businesses to EchoAI.",
  },
};

export default function FeatureGate({
  feature,
  requiredTier,
  currentTier,
  onUpgrade,
  children,
}) {
  // Tier not known yet — don't flash the prompt.
  if (currentTier == null) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner label="Loading…" />
      </div>
    );
  }

  if (meetsTier(currentTier, requiredTier)) {
    return children;
  }

  const copy = FEATURE_COPY[feature] || { title: "This feature", blurb: "" };
  const name = tierName(requiredTier);
  const price = tierPrice(requiredTier);

  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-b from-amber-500/10 to-gray-900 p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 text-amber-300">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 0h10.5a2.25 2.25 0 012.25 2.25v6.75a2.25 2.25 0 01-2.25 2.25H6.75a2.25 2.25 0 01-2.25-2.25v-6.75a2.25 2.25 0 012.25-2.25z"
            />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-100">{copy.title} is a {name} feature</h2>
        {copy.blurb && <p className="mt-2 text-sm leading-relaxed text-gray-400">{copy.blurb}</p>}
        <p className="mt-4 text-sm text-gray-300">
          Upgrade to <span className="font-semibold text-amber-300">{name}</span>
          {price != null && (
            <>
              {" "}
              — <span className="font-semibold text-gray-100">${price}/month</span>
            </>
          )}{" "}
          to unlock it instantly. You currently have the{" "}
          <span className="font-medium text-gray-200">{tierName(currentTier)}</span> plan.
        </p>
        <button
          onClick={onUpgrade}
          className="mt-6 rounded-lg bg-amber-500 px-6 py-2.5 text-sm font-semibold text-gray-900 hover:bg-amber-600"
        >
          Upgrade to {name}
        </button>
      </div>
    </div>
  );
}
