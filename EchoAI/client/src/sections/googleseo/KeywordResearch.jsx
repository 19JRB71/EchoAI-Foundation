import { useState } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";

const VOLUME_STYLES = {
  high: "bg-green-500/15 text-green-400",
  medium: "bg-amber-500/15 text-amber-300",
  low: "bg-gray-700 text-gray-300",
};

export default function KeywordResearch() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [keywords, setKeywords] = useState(null);

  async function handleSearch(e) {
    e.preventDefault();
    setError("");
    if (!topic.trim()) {
      setError("Enter a topic to research keywords.");
      return;
    }
    setLoading(true);
    setKeywords(null);
    try {
      const data = await api.getKeywordSuggestions(topic.trim());
      setKeywords(data.keywords || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleSearch}
        className="space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm"
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">
            Topic
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. email marketing for ecommerce"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>

        <ErrorBanner message={error} />

        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
        >
          {loading ? "Researching…" : "Find Keywords"}
        </button>
      </form>

      {loading && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-400 shadow-sm">
          Generating keyword ideas…
        </div>
      )}

      {keywords && !loading && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 shadow-sm">
          {keywords.length === 0 ? (
            <p className="text-sm text-gray-400">No keyword ideas were returned.</p>
          ) : (
            <ul className="divide-y divide-gray-800">
              {keywords.map((k, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-sm text-gray-200">{k.keyword}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {k.intent && (
                      <span className="text-xs text-gray-500">{k.intent}</span>
                    )}
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        VOLUME_STYLES[k.volume] || VOLUME_STYLES.low
                      }`}
                    >
                      {k.volume} volume
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
