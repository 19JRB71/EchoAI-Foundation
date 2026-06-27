import { useState } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import {
  PLATFORMS,
  PlatformBadge,
  platformMeta,
} from "./platformMeta.jsx";

// Joins post copy with its hashtags into the single content string the schedule
// endpoint stores.
function composeContent(variation) {
  const tags = (variation.hashtags || [])
    .map((t) => (t.startsWith("#") ? t : `#${t}`))
    .join(" ");
  return tags ? `${variation.postText}\n\n${tags}` : variation.postText;
}

// Default the schedule picker to one hour from now (in the <input datetime-local>
// format, which is local time without a timezone suffix).
function defaultScheduleValue() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default function ContentGenerator({
  brandId,
  attachedImage,
  onClearAttachedImage,
}) {
  const [topic, setTopic] = useState("");
  const [selected, setSelected] = useState(["facebook"]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // results: { [platform]: { loading, error, variations: [] } }
  const [results, setResults] = useState({});

  function togglePlatform(p) {
    setSelected((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  async function generateFor(platform) {
    const data = await api.generateSocial(brandId, topic.trim(), platform);
    return data.variations || [];
  }

  async function handleGenerate(e) {
    e.preventDefault();
    setError("");
    if (!topic.trim()) {
      setError("Enter a content topic or theme to generate posts.");
      return;
    }
    if (selected.length === 0) {
      setError("Select at least one platform.");
      return;
    }

    setLoading(true);
    const next = {};
    for (const p of selected) next[p] = { loading: true, error: "", variations: [] };
    setResults(next);

    const outcomes = await Promise.allSettled(
      selected.map((p) => generateFor(p))
    );

    setResults(() => {
      const updated = {};
      selected.forEach((p, i) => {
        const outcome = outcomes[i];
        updated[p] =
          outcome.status === "fulfilled"
            ? { loading: false, error: "", variations: outcome.value }
            : { loading: false, error: outcome.reason.message, variations: [] };
      });
      return updated;
    });
    setLoading(false);
  }

  // Replace a single card with one freshly generated variation (the generate
  // endpoint always returns 5; we take the first for this card).
  async function handleRegenerateOne(platform, index) {
    const variations = await generateFor(platform);
    const fresh = variations[0];
    if (!fresh) return;
    setResults((prev) => {
      const current = prev[platform];
      if (!current) return prev;
      const copy = [...current.variations];
      copy[index] = fresh;
      return { ...prev, [platform]: { ...current, variations: copy } };
    });
  }

  async function handleRegenerate(platform) {
    setResults((prev) => ({
      ...prev,
      [platform]: { ...prev[platform], loading: true, error: "" },
    }));
    try {
      const variations = await generateFor(platform);
      setResults((prev) => ({
        ...prev,
        [platform]: { loading: false, error: "", variations },
      }));
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [platform]: { ...prev[platform], loading: false, error: err.message },
      }));
    }
  }

  const platformsWithResults = Object.keys(results);

  return (
    <div className="space-y-6">
      {attachedImage && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <img
            src={attachedImage.image_url}
            alt="Attached"
            className="h-16 w-16 shrink-0 rounded-lg border border-gray-800 object-cover"
          />
          <div className="flex-1 text-sm text-amber-200">
            <p className="font-medium">Image attached from Image Studio</p>
            <p className="text-xs text-amber-300/80">
              Generate copy for this image, then schedule your post.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onClearAttachedImage?.()}
            className="rounded-lg border border-amber-500/40 px-2 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/20"
          >
            Remove
          </button>
        </div>
      )}

      <form
        onSubmit={handleGenerate}
        className="space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm"
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">
            Content topic or theme
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Spring promotion for new customers"
            className="w-full rounded-lg border border-gray-700 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-300">
            Platforms
          </label>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => {
              const meta = platformMeta(p);
              const on = selected.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                    on
                      ? "border-amber-500 bg-amber-500/10 text-amber-300"
                      : "border-gray-800 text-gray-400 hover:bg-gray-800"
                  }`}
                >
                  <PlatformBadge platform={p} size={20} />
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>

        <ErrorBanner message={error} />

        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
        >
          {loading ? "Generating…" : "Generate"}
        </button>
      </form>

      {platformsWithResults.map((platform) => {
        const res = results[platform];
        const meta = platformMeta(platform);
        return (
          <div key={platform} className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PlatformBadge platform={platform} />
                <h3 className="text-sm font-semibold text-gray-100">
                  {meta.label}
                </h3>
              </div>
              <button
                onClick={() => handleRegenerate(platform)}
                disabled={res.loading}
                className="rounded-lg border border-gray-800 px-3 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-800 disabled:opacity-60"
              >
                {res.loading ? "Regenerating…" : "Regenerate all"}
              </button>
            </div>

            {res.error && <ErrorBanner message={res.error} />}

            {res.loading ? (
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-400 shadow-sm">
                Generating variations…
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {res.variations.map((variation, i) => (
                  <VariationCard
                    key={i}
                    brandId={brandId}
                    platform={platform}
                    variation={variation}
                    onRegenerate={() => handleRegenerateOne(platform, i)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function VariationCard({ brandId, platform, variation, onRegenerate }) {
  const [scheduling, setScheduling] = useState(false);
  const [when, setWhen] = useState(defaultScheduleValue);
  const [busy, setBusy] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function handleRegenerate() {
    setRegenerating(true);
    setError("");
    setNotice("");
    try {
      await onRegenerate();
    } catch (err) {
      setError(err.message);
    } finally {
      setRegenerating(false);
    }
  }

  async function handleSchedule() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.scheduleSocial({
        brandId,
        platform,
        postContent: composeContent(variation),
        scheduledTime: new Date(when).toISOString(),
      });
      setNotice("Scheduled.");
      setScheduling(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-gray-800 bg-gray-900 p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <PlatformBadge platform={platform} size={22} />
        <span className="text-xs font-semibold text-gray-400">
          {platformMeta(platform).label}
        </span>
      </div>

      <p className="flex-1 whitespace-pre-wrap text-sm text-gray-200">
        {variation.postText}
      </p>

      {variation.hashtags && variation.hashtags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {variation.hashtags.map((tag, i) => (
            <span
              key={i}
              className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300"
            >
              {tag.startsWith("#") ? tag : `#${tag}`}
            </span>
          ))}
        </div>
      )}

      {variation.bestPostingTime && (
        <p className="mt-3 text-xs text-gray-400">
          Best time: {variation.bestPostingTime}
        </p>
      )}

      {notice && (
        <p className="mt-3 rounded-lg bg-green-50 px-2 py-1 text-xs text-green-700">
          {notice}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </p>
      )}

      {scheduling ? (
        <div className="mt-4 space-y-2 border-t border-gray-800 pt-3">
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="w-full rounded-lg border border-gray-700 px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSchedule}
              disabled={busy}
              className="flex-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
            >
              {busy ? "Scheduling…" : "Confirm"}
            </button>
            <button
              onClick={() => setScheduling(false)}
              className="rounded-lg border border-gray-800 px-3 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex gap-2 border-t border-gray-800 pt-3">
          <button
            onClick={() => {
              setScheduling(true);
              setNotice("");
            }}
            className="flex-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-amber-600"
          >
            Schedule This Post
          </button>
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="rounded-lg border border-gray-800 px-3 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-800 disabled:opacity-60"
          >
            {regenerating ? "Regenerating…" : "Regenerate"}
          </button>
        </div>
      )}
    </div>
  );
}
