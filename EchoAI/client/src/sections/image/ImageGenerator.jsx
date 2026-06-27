import { useState } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";

// Mirrors the backend PURPOSES map (label + platform).
const PURPOSES = [
  { key: "facebook_ad", label: "Facebook Ad", platform: "facebook" },
  { key: "instagram_post", label: "Instagram Post", platform: "instagram" },
  { key: "twitter_post", label: "Twitter Post", platform: "twitter" },
  { key: "linkedin_post", label: "LinkedIn Post", platform: "linkedin" },
  { key: "email_header", label: "Email Header", platform: "email" },
  { key: "youtube_thumbnail", label: "YouTube Thumbnail", platform: "youtube" },
];

export default function ImageGenerator({ brandId, onSaved, onUseInSocial }) {
  const [purpose, setPurpose] = useState("instagram_post");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { purpose, platform, images: [] }

  async function handleGenerate(e) {
    e.preventDefault();
    setError("");
    if (!description.trim()) {
      setError("Describe the image you want to generate.");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const data = await api.generateImage({
        brandId,
        purpose,
        description: description.trim(),
        variations: 3,
      });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleGenerate}
        className="space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm"
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">
            Image purpose
          </label>
          <select
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          >
            {PURPOSES.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">
            Describe the image
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="e.g. A cozy coffee shop interior with warm morning light and a steaming latte on a wooden table"
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            Three on-brand variations will be generated side by side.
          </p>
        </div>

        <ErrorBanner message={error} />

        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
        >
          {loading ? "Generating…" : "Generate Variations"}
        </button>
      </form>

      {loading && (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex aspect-square animate-pulse items-center justify-center rounded-xl border border-gray-800 bg-gray-900 text-sm text-gray-500"
            >
              Generating…
            </div>
          ))}
        </div>
      )}

      {result && result.images.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          {result.images.map((img, i) => (
            <VariationCard
              key={i}
              index={i}
              brandId={brandId}
              purpose={result.purpose}
              platform={result.platform}
              image={img}
              onSaved={onSaved}
              onUseInSocial={onUseInSocial}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function VariationCard({
  index,
  brandId,
  purpose,
  platform,
  image,
  onSaved,
  onUseInSocial,
}) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null); // the persisted image row
  const [error, setError] = useState("");

  // Ensures the image is persisted (download + store) and returns the row.
  async function ensureSaved() {
    if (saved) return saved;
    const data = await api.saveImage({
      brandId,
      purpose,
      prompt: image.prompt,
      imageUrl: image.imageUrl,
      platform,
    });
    setSaved(data.image);
    onSaved?.();
    return data.image;
  }

  async function handleSave() {
    setBusy(true);
    setError("");
    try {
      await ensureSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUseInSocial() {
    setBusy(true);
    setError("");
    try {
      const row = await ensureSaved();
      onUseInSocial?.(row);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload() {
    setBusy(true);
    setError("");
    try {
      // Persist first so we download the stored (non-expiring) copy.
      const row = await ensureSaved();
      const res = await fetch(row.image_url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${purpose}-${index + 1}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const previewUrl = saved ? saved.image_url : image.imageUrl;

  return (
    <div className="flex flex-col rounded-xl border border-gray-800 bg-gray-900 p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400">
          Variation {index + 1}
        </span>
        {saved && (
          <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
            Saved
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-800 bg-black">
        <img
          src={previewUrl}
          alt={`Variation ${index + 1}`}
          className="h-auto w-full"
        />
      </div>

      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </p>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2">
        <button
          onClick={handleSave}
          disabled={busy || Boolean(saved)}
          className="rounded-lg bg-amber-500 px-2 py-1.5 text-xs font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
        >
          {saved ? "Saved" : busy ? "…" : "Save"}
        </button>
        <button
          onClick={handleUseInSocial}
          disabled={busy}
          className="rounded-lg border border-gray-700 px-2 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-60"
        >
          Use in Social
        </button>
        <button
          onClick={handleDownload}
          disabled={busy}
          className="rounded-lg border border-gray-700 px-2 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-60"
        >
          Download
        </button>
      </div>
    </div>
  );
}
