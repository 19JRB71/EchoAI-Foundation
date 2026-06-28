import { useState } from "react";
import { api } from "../../api.js";

/**
 * A single generated image with Save / Download / Use in Social actions.
 * `ensureSaved` persists the (temporary) DALL-E URL to disk on first use so
 * downloads and social hand-off always reference the permanent copy.
 */
export default function GeneratedImageCard({
  brandId,
  purpose,
  platform,
  image,
  contentDescription,
  styleNotes,
  label,
  filenameBase,
  onSaved,
  onUseInSocial,
}) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState("");

  async function ensureSaved() {
    if (saved) return saved;
    const data = await api.saveImage({
      brandId,
      purpose,
      prompt: image.prompt,
      imageUrl: image.imageUrl,
      platform,
      contentDescription,
      styleNotes,
    });
    setSaved(data.image);
    onSaved?.();
    return data.image;
  }

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleSave() {
    run(ensureSaved);
  }

  function handleUseInSocial() {
    run(async () => {
      const row = await ensureSaved();
      onUseInSocial?.(row);
    });
  }

  function handleDownload() {
    run(async () => {
      const row = await ensureSaved();
      const res = await fetch(row.image_url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filenameBase || purpose}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  const previewUrl = saved ? saved.image_url : image.imageUrl;

  return (
    <div className="flex flex-col rounded-xl border border-gray-800 bg-gray-900 p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400">
          {label || "Generated image"}
        </span>
        {saved && (
          <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
            Saved
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-800 bg-black">
        <img src={previewUrl} alt={label || "Generated"} className="h-auto w-full" />
      </div>

      {error && (
        <p className="mt-2 rounded-lg bg-red-500/10 px-2 py-1 text-xs text-red-300">
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
        {onUseInSocial && (
          <button
            onClick={handleUseInSocial}
            disabled={busy}
            className="rounded-lg border border-gray-700 px-2 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-60"
          >
            Use in Social
          </button>
        )}
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
