import { useState } from "react";
import CampaignGenerator from "./email/CampaignGenerator.jsx";
import ActiveCampaigns from "./email/ActiveCampaigns.jsx";
import Performance from "./email/Performance.jsx";

const TABS = [
  { key: "generate", label: "Campaign Generator" },
  { key: "active", label: "Active Campaigns" },
  { key: "performance", label: "Performance" },
];

export default function EmailMarketing({ brandId }) {
  const [tab, setTab] = useState("generate");
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-100">Email Marketing</h2>

      {!brandId ? (
        <p className="text-sm text-gray-400">
          Select or create a brand to build email campaigns.
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

          {tab === "generate" && (
            <CampaignGenerator
              brandId={brandId}
              onSaved={() => setRefreshKey((k) => k + 1)}
            />
          )}
          {tab === "active" && (
            <ActiveCampaigns brandId={brandId} refreshKey={refreshKey} />
          )}
          {tab === "performance" && (
            <Performance brandId={brandId} refreshKey={refreshKey} />
          )}
        </>
      )}
    </div>
  );
}
