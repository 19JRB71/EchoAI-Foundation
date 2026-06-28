import { useState } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import PromptCard from "./PromptCard.jsx";
import { PURPOSES } from "./purposes.js";

export default function ImageGenerator({ brandId, onSaved, onUseInSocial }) {
  const [purpose, setPurpose] = useState("instagram_post");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { purpose, platform, description, prompts: [] }

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
      const data = await api.generateImagePrompts({
        brandId,
        purpose,
        description: description.trim(),
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
            The AI Image Prompt Engineer will design 5 on-brand prompts. Generate
            an image from any prompt, then spin off variations.
          </p>
        </div>

        <ErrorBanner message={error} />

        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
        >
          {loading ? "Designing prompts…" : "Generate Prompts"}
        </button>
      </form>

      {loading && (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-xl border border-gray-800 bg-gray-900"
            />
          ))}
        </div>
      )}

      {result && result.prompts?.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-100">
            5 on-brand prompt directions
          </h3>
          {result.prompts.map((p, i) => (
            <PromptCard
              key={i}
              index={i}
              brandId={brandId}
              purpose={result.purpose}
              platform={result.platform}
              contentDescription={result.description}
              prompt={p}
              onSaved={onSaved}
              onUseInSocial={onUseInSocial}
            />
          ))}
        </div>
      )}
    </div>
  );
}
