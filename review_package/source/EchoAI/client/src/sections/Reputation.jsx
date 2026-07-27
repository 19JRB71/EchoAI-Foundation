import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import ReviewInbox from "./reputation/ReviewInbox.jsx";
import ReputationStats from "./reputation/ReputationStats.jsx";

const TABS = [
  { key: "inbox", label: "Review Inbox" },
  { key: "stats", label: "Reputation Stats" },
];

export default function Reputation({ brandId }) {
  const [tab, setTab] = useState("inbox");
  const [reviews, setReviews] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState(null);

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.getReviews(brandId);
      setReviews(data.reviews || []);
      setStats(data.stats || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setReviews([]);
    setStats(null);
    setFetchResult(null);
    load();
  }, [load]);

  async function handleFetch() {
    setFetching(true);
    setError("");
    try {
      const data = await api.fetchReviews(brandId);
      setFetchResult(data.platforms || null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setFetching(false);
    }
  }

  if (!brandId) {
    return (
      <p className="text-sm text-gray-400">
        Select or create a brand to manage your reputation.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-100">Reputation Management</h2>
        <p className="mt-1 text-sm text-gray-400">
          Monitor and respond to customer reviews in your brand voice.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-gray-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "border-sky-500 text-sky-300"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "inbox" && (
        <ReviewInbox
          brandId={brandId}
          reviews={reviews}
          loading={loading}
          error={error}
          onFetch={handleFetch}
          fetching={fetching}
          fetchResult={fetchResult}
          onChanged={load}
        />
      )}

      {tab === "stats" && <ReputationStats stats={stats} loading={loading} />}
    </div>
  );
}
