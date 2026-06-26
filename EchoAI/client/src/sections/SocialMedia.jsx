import { useState } from "react";
import ContentCalendar from "./social/ContentCalendar.jsx";
import ContentGenerator from "./social/ContentGenerator.jsx";
import ConnectedAccounts from "./social/ConnectedAccounts.jsx";
import Performance from "./social/Performance.jsx";

const TABS = [
  { key: "calendar", label: "Content Calendar" },
  { key: "generate", label: "AI Content Generator" },
  { key: "accounts", label: "Connected Accounts" },
  { key: "performance", label: "Performance" },
];

export default function SocialMedia({ brandId }) {
  const [tab, setTab] = useState("calendar");

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-900">Social Media</h2>

      {!brandId ? (
        <p className="text-sm text-gray-500">
          Select or create a brand to manage your social media.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 border-b border-gray-200">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
                  tab === t.key
                    ? "border-amber-500 text-amber-700"
                    : "border-transparent text-gray-500 hover:text-gray-800"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "calendar" && <ContentCalendar brandId={brandId} />}
          {tab === "generate" && <ContentGenerator brandId={brandId} />}
          {tab === "accounts" && <ConnectedAccounts brandId={brandId} />}
          {tab === "performance" && <Performance brandId={brandId} />}
        </>
      )}
    </div>
  );
}
