import { useState } from "react";
import Campaigns from "./email/Campaigns.jsx";
import DripSequences from "./email/DripSequences.jsx";
import Contacts from "./email/Contacts.jsx";
import Analytics from "./email/Analytics.jsx";

const TABS = [
  { key: "campaigns", label: "Campaigns" },
  { key: "drip", label: "Drip Sequences" },
  { key: "contacts", label: "Contacts" },
  { key: "analytics", label: "Analytics" },
];

export default function EmailMarketing({ brandId }) {
  const [tab, setTab] = useState("campaigns");
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-100">Email Marketing</h2>
        <p className="mt-1 text-sm text-gray-400">
          AI-written one-time email blasts and automated drip sequences sent to
          your contacts, with open/click tracking and unsubscribe handling.
        </p>
      </div>

      {!brandId ? (
        <p className="text-sm text-gray-400">
          Select or create a brand to start email marketing.
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

          {tab === "campaigns" && (
            <Campaigns brandId={brandId} refreshKey={refreshKey} onChange={bump} />
          )}
          {tab === "drip" && (
            <DripSequences brandId={brandId} refreshKey={refreshKey} onChange={bump} />
          )}
          {tab === "contacts" && <Contacts brandId={brandId} refreshKey={refreshKey} />}
          {tab === "analytics" && <Analytics brandId={brandId} refreshKey={refreshKey} />}
        </>
      )}
    </div>
  );
}
