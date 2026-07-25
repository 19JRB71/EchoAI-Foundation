import { useRef, useState } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import PromptCard from "./PromptCard.jsx";
import { PURPOSES } from "./purposes.js";

const REF_ACCEPT = "image/png,image/jpeg,image/webp";
const REF_MAX_BYTES = 8 * 1024 * 1024;

export default function ImageGenerator({ brandId, onSaved, onUseInSocial }) {
  const [purpose, setPurpose] = useState("instagram_post");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { purpose, platform, description, prompts: [] }
  // Reference photo of the real business: { referencePath, previewUrl, name }
  const [reference, setReference] = useState(null);
  const [refBusy, setRefBusy] = useState(false);
  const fileInputRef = useRef(null);

  async function handleReferenceFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("The reference photo must be a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > REF_MAX_BYTES) {
      setError("The reference photo must be under 8 MB.");
      return;
    }
    setRefBusy(true);
    try {
      const imageData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read the photo"));
        reader.readAsDataURL(file);
      });
      const data = await api.uploadImageReference({ imageData });
      setReference({
        referencePath: data.referencePath,
        previewUrl: imageData,
        name: file.name,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setRefBusy(false);
    }
  }

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
        referencePath: reference ? reference.referencePath : undefined,
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

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">
            Reference photo <span className="text-gray-500">(optional)</span>
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept={REF_ACCEPT}
            onChange={handleReferenceFile}
            className="hidden"
          />
          {!reference ? (
            <button
              type="button"
              disabled={refBusy}
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              className="rounded-lg border border-dashed border-gray-600 px-4 py-2 text-sm font-medium text-gray-300 hover:border-amber-500 hover:text-amber-400 disabled:opacity-60"
            >
              {refBusy ? "Uploading…" : "Upload a photo of your business"}
            </button>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-gray-700 bg-gray-950 p-2">
              <img
                src={reference.previewUrl}
                alt="Reference"
                className="h-14 w-14 rounded-md object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-gray-200">
                  {reference.name}
                </p>
                <p className="text-xs text-emerald-400">
                  Images will match this photo
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReference(null)}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-gray-400 hover:bg-gray-800 hover:text-red-300"
              >
                Remove
              </button>
            </div>
          )}
          <p className="mt-1 text-xs text-gray-500">
            Upload a real photo of your location or product and the AI will keep
            the generated images true to it — no more made-up buildings.
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
              referencePath={reference ? reference.referencePath : undefined}
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
