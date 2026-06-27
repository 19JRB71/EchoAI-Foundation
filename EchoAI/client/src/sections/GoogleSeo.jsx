import { useState } from "react";
import GoogleConnectTab from "./googleseo/GoogleConnectTab.jsx";
import SeoGenerator from "./googleseo/SeoGenerator.jsx";
import KeywordResearch from "./googleseo/KeywordResearch.jsx";
import AnalyticsDashboard from "./googleseo/AnalyticsDashboard.jsx";

const TABS = [
  { key: "connect", label: "Google Connect" },
  { key: "seo", label: "SEO Content Generator" },
  { key: "keywords", label: "Keyword Research" },
  { key: "analytics", label: "Google Analytics" },
];

export default function GoogleSeo({ brandId }) {
  const [tab, setTab] = useState("connect");

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-100">Google &amp; SEO</h2>

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

      {tab === "connect" && <GoogleConnectTab />}

      {tab === "seo" &&
        (brandId ? (
          <SeoGenerator brandId={brandId} />
        ) : (
          <p className="text-sm text-gray-400">
            Select or create a brand to generate SEO content.
          </p>
        ))}

      {tab === "keywords" && <KeywordResearch />}

      {tab === "analytics" && <AnalyticsDashboard />}
    </div>
  );
}
