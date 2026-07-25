import { useState } from "react";
import { api } from "../../api.js";
import StarRating from "../../components/StarRating.jsx";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import { ReviewPlatformBadge, REVIEW_PLATFORMS } from "./reviewPlatformMeta.jsx";

function StatusBadge({ status }) {
  const map = {
    pending: { label: "Needs response", cls: "bg-amber-500/15 text-amber-300" },
    responded: { label: "Responded", cls: "bg-green-500/15 text-green-300" },
    ignored: { label: "Ignored", cls: "bg-gray-600/30 text-gray-400" },
  };
  const s = map[status] || map.pending;
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

function formatDate(d) {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function ReviewCard({ review, onChanged }) {
  const [draft, setDraft] = useState(review.response_text || "");
  const [editing, setEditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function handleGenerate() {
    setGenerating(true);
    setError("");
    setNote("");
    try {
      const data = await api.generateReviewResponse(review.review_id);
      setDraft(data.response || "");
      setEditing(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handlePost() {
    if (!draft.trim()) return;
    setPosting(true);
    setError("");
    setNote("");
    try {
      const data = await api.postReviewResponse(review.review_id, draft.trim());
      if (data.note) setNote(data.note);
      setEditing(false);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setPosting(false);
    }
  }

  async function handleIgnore() {
    setError("");
    try {
      await api.ignoreReview(review.review_id);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    }
  }

  const showActions = review.response_status === "pending";

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <ReviewPlatformBadge platform={review.platform} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-100">
                {review.reviewer_name}
              </span>
              <StarRating value={review.star_rating} size={15} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">
                {formatDate(review.posted_at || review.created_at)}
              </span>
              <StatusBadge status={review.response_status} />
            </div>
          </div>

          {review.review_text && (
            <p className="mt-2 text-sm leading-relaxed text-gray-300">
              {review.review_text}
            </p>
          )}

          {/* Existing or generated response */}
          {review.response_text && !editing && (
            <div className="mt-3 rounded-lg border border-gray-800 bg-gray-950/50 p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Your response
              </p>
              <p className="text-sm text-gray-200">{review.response_text}</p>
            </div>
          )}

          {editing && (
            <div className="mt-3">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                className="w-full rounded-lg border border-gray-700 bg-gray-950 p-3 text-sm text-gray-100 focus:border-sky-500 focus:outline-none"
                placeholder="Edit the AI-generated response before posting…"
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={handlePost}
                  disabled={posting || !draft.trim()}
                  className="rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
                >
                  {posting ? "Posting…" : "Post Response"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-lg border border-gray-700 px-4 py-1.5 text-sm font-semibold text-gray-300 hover:bg-gray-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <ErrorBanner message={error} />
          {note && (
            <p className="mt-2 rounded-lg bg-sky-500/10 p-2 text-xs text-sky-200">
              {note}
            </p>
          )}

          {/* Primary actions for un-responded reviews */}
          {showActions && !editing && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
              >
                {generating ? "Generating…" : "Generate Response"}
              </button>
              {draft.trim() && (
                <button
                  onClick={() => setEditing(true)}
                  className="rounded-lg border border-gray-700 px-4 py-1.5 text-sm font-semibold text-gray-300 hover:bg-gray-800"
                >
                  Edit draft
                </button>
              )}
              <button
                onClick={handleIgnore}
                className="rounded-lg border border-gray-700 px-4 py-1.5 text-sm font-semibold text-gray-400 hover:bg-gray-800"
              >
                Ignore
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddReviewForm({ brandId, onAdded }) {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState("yelp");
  const [reviewerName, setReviewerName] = useState("");
  const [starRating, setStarRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.addReview(brandId, {
        platform,
        reviewerName,
        starRating,
        reviewText,
      });
      setReviewerName("");
      setReviewText("");
      setStarRating(5);
      setOpen(false);
      onAdded?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800"
      >
        + Add review manually
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-4"
    >
      <p className="text-sm font-semibold text-gray-200">
        Add a review manually (e.g. from Yelp)
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-gray-400">
          Platform
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-sm text-gray-100"
          >
            {REVIEW_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-400">
          Reviewer name
          <input
            value={reviewerName}
            onChange={(e) => setReviewerName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-sm text-gray-100"
            placeholder="Jane D."
          />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">Rating</span>
        <StarRating value={starRating} size={20} interactive onChange={setStarRating} />
      </div>
      <textarea
        value={reviewText}
        onChange={(e) => setReviewText(e.target.value)}
        rows={3}
        required
        className="w-full rounded-lg border border-gray-700 bg-gray-950 p-3 text-sm text-gray-100"
        placeholder="Paste the review text here…"
      />
      <ErrorBanner message={error} />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || !reviewText.trim()}
          className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Add review"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function ReviewInbox({
  brandId,
  reviews,
  loading,
  error,
  onFetch,
  fetching,
  fetchResult,
  onChanged,
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-400">
          All your reviews across Google, Facebook, and Yelp in one place.
        </p>
        <div className="flex gap-2">
          <AddReviewForm brandId={brandId} onAdded={onChanged} />
          <button
            onClick={onFetch}
            disabled={fetching}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
          >
            {fetching ? "Syncing…" : "Sync reviews"}
          </button>
        </div>
      </div>

      {fetchResult && (
        <div className="space-y-1 rounded-lg border border-gray-800 bg-gray-900 p-3 text-xs text-gray-400">
          {Object.entries(fetchResult).map(([platform, r]) => (
            <div key={platform}>
              <span className="font-semibold capitalize text-gray-300">
                {platform}:
              </span>{" "}
              {r.error ? (
                <span className="text-amber-300">{r.error}</span>
              ) : (
                <span>
                  {r.fetched} fetched, {r.saved} new
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <ErrorBanner message={error} />

      {loading ? (
        <p className="text-sm text-gray-400">Loading reviews…</p>
      ) : reviews.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-800 p-6 text-center text-sm text-gray-500">
          No reviews yet. Click “Sync reviews” to pull from Google &amp; Facebook,
          or add one manually.
        </p>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <ReviewCard key={r.review_id} review={r} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}
