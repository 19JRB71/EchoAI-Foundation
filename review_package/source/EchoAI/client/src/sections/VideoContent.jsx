import { useState } from "react";
import ScriptGenerator from "./video/ScriptGenerator.jsx";
import SavedScripts from "./video/SavedScripts.jsx";

const TABS = [
  { key: "generate", label: "Script Generator" },
  { key: "saved", label: "Saved Scripts" },
];

export default function VideoContent({ brandId }) {
  const [tab, setTab] = useState("generate");
  const [savedRefreshKey, setSavedRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-100">Video Content</h2>

      {!brandId ? (
        <p className="text-sm text-gray-400">
          Select or create a brand to generate video scripts.
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
