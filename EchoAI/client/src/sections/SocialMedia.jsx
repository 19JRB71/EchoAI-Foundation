import { useState } from "react";
import AICalendar from "./social/AICalendar.jsx";
import ContentCalendar from "./social/ContentCalendar.jsx";
import ContentGenerator from "./social/ContentGenerator.jsx";
import ConnectedAccounts from "./social/ConnectedAccounts.jsx";
import Performance from "./social/Performance.jsx";

const TABS = [
  { key: "ai-calendar", label: "Content Calendar" },
  { key: "schedule", label: "Post Schedule" },
  { key: "generate", label: "AI Content Generator" },
  { key: "accounts", label: "Connected Accounts" },
  { key: "performance", label: "Performance" },
];

export default function SocialMedia({ brandId, tier, prefillImage, onPrefillConsumed, initialTab }) {
  // Open the generator tab when an image was handed off from Image Studio;
  // otherwise honor an explicit initialTab (e.g. the Content Calendar nav item).
  const [tab, setTab] = useState(
    prefillImage ? "generate" : initialTab || "ai-calendar",
  );

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-100">Social Media</h2>

      {!brandId ? (
        <p className="text-sm text-gray-400">
          Select or create a brand to manage your social media.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 border-b border-gray-800">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
                  tab === t.key
                    ? "border-amber-500 text-amber-300"
                    : "border-transparent text-gray-400 hover:text-gray-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "ai-calendar" && <AICalendar brandId={brandId} />}
          {tab === "schedule" && <ContentCalendar brandId={brandId} />}
          {tab === "generate" && (
            <ContentGenerator
              brandId={brandId}
              tier={tier}
              attachedImage={prefillImage}
              onClearAttachedImage={onPrefillConsumed}
            />
          )}
          {tab === "accounts" && <ConnectedAccounts brandId={brandId} />}
          {tab === "performance" && <Performance brandId={brandId} />}
        </>
      )}
    </div>
  );
}
