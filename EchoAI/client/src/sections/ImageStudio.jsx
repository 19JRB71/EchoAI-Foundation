import { useState } from "react";
import ImageGenerator from "./image/ImageGenerator.jsx";
import ImageLibrary from "./image/ImageLibrary.jsx";

const TABS = [
  { key: "generate", label: "AI Image Generator" },
  { key: "library", label: "Image Library" },
];

export default function ImageStudio({ brandId, onUseInSocial }) {
  const [tab, setTab] = useState("generate");
  // Bumped to force the library to reload after a new image is saved.
  const [refreshKey, setRefreshKey] = useState(0);

  if (!brandId) {
    return (
      <div className="rounded-lg bg-amber-500/10 p-4 text-sm text-amber-300">
        Select a brand to start generating images.
      </div>
    );
  }

  function handleSaved() {
    setRefreshKey((k) => k + 1);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Image Studio</h1>
        <p className="mt-1 text-sm text-gray-400">
          Generate on-brand marketing images for ads, social posts, and email
          headers with AI.
        </p>
      </div>

      <div className="mb-6 flex gap-1 border-b border-gray-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "border-amber-500 text-amber-400"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "generate" ? (
        <ImageGenerator
          brandId={brandId}
          onSaved={handleSaved}
          onUseInSocial={onUseInSocial}
        />
      ) : (
        <ImageLibrary brandId={brandId} refreshKey={refreshKey} />
      )}
    </div>
  );
}
