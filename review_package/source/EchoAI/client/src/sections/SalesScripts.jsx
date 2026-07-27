import { useState } from "react";
import ScriptGenerator from "./sales/ScriptGenerator.jsx";
import SavedScripts from "./sales/SavedScripts.jsx";

const TABS = [
  { key: "generate", label: "Script Generator" },
  { key: "saved", label: "Saved Scripts" },
];

export default function SalesScripts({ brandId }) {
  const [tab, setTab] = useState("generate");
  const [savedRefreshKey, setSavedRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-100">Sales Scripts</h2>
        <p className="mt-1 text-sm text-gray-400">
          Generate natural, on-brand sales scripts — openings, discovery
          questions, pitch, objection handling, closes, and follow-ups.
        </p>
      </div>

      {!brandId ? (
        <p className="text-sm text-gray-400">
          Select a brand to generate sales scripts.
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
            <ScriptGenerator
              brandId={brandId}
              onSaved={() => setSavedRefreshKey((k) => k + 1)}
            />
          )}
          {tab === "saved" && (
            <SavedScripts brandId={brandId} refreshKey={savedRefreshKey} />
          )}
        </>
      )}
    </div>
  );
}
