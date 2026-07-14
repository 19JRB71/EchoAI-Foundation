import { useState } from "react";
import { api } from "../../api.js";
import GeneratedImageCard from "./GeneratedImageCard.jsx";

/**
 * One AI-engineered image prompt: shows the style + notes, lets you expand the
 * full prompt, generate an image from it, and then spin off 3 variations.
 */
export default function PromptCard({
  index,
  brandId,
  purpose,
  platform,
  contentDescription,
  referencePath,
  prompt, // { style, prompt, styleNotes }
  onSaved,
  onUseInSocial,
}) {
  const [expanded, setExpanded] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [varBusy, setVarBusy] = useState(false);
  const [error, setError] = useState("");
  const [image, setImage] = useState(null); // { imageUrl, prompt }
  const [variations, setVariations] = useState([]);

  async function handleGenerate() {
    setGenBusy(true);
    setError("");
    try {
      const data = await api.generateImageFromPrompt({
        brandId,
        purpose,
        prompt: prompt.prompt,
        referencePath,
      });
      setImage(data.image);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenBusy(false);
    }
  }

  async function handleVariations() {
    setVarBusy(true);
    setError("");
    try {
      const data = await api.generateImageVariations({
        brandId,
        purpose,
        prompt: prompt.prompt,
        referencePath,
      });
      setVariations(data.images || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setVarBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-100">
            {prompt.style || `Direction ${index + 1}`}
          </p>
          {prompt.styleNotes && (
            <p className="mt-0.5 text-xs text-gray-400">{prompt.styleNotes}</p>
          )}
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-xs font-medium text-amber-400 hover:text-amber-300"
        >
          {expanded ? "Hide prompt" : "View prompt"}
        </button>
      </div>

      {expanded && (
        <p className="mt-3 rounded-lg border border-gray-800 bg-gray-950 p-3 text-xs leading-relaxed text-gray-300">
          {prompt.prompt}
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-red-500/10 px-2 py-1 text-xs text-red-300">
          {error}
        </p>
      )}

      {!image ? (
        <button
          onClick={handleGenerate}
          disabled={genBusy}
          className="mt-3 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
        >
          {genBusy ? "Generating…" : "Generate Image"}
        </button>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            <GeneratedImageCard
              brandId={brandId}
              purpose={purpose}
              platform={platform}
              image={image}
              contentDescription={contentDescription}
              styleNotes={prompt.styleNotes}
              label={prompt.style || `Direction ${index + 1}`}
              filenameBase={`${purpose}-${index + 1}`}
              onSaved={onSaved}
              onUseInSocial={onUseInSocial}
            />
            {variations.map((v, i) => (
              <GeneratedImageCard
                key={i}
                brandId={brandId}
                purpose={purpose}
                platform={platform}
                image={v}
                contentDescription={contentDescription}
                styleNotes={prompt.styleNotes}
                label={`Variation ${i + 1}`}
                filenameBase={`${purpose}-${index + 1}-var-${i + 1}`}
                onSaved={onSaved}
                onUseInSocial={onUseInSocial}
              />
            ))}
          </div>

          {variations.length === 0 && (
            <button
              onClick={handleVariations}
              disabled={varBusy}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-60"
            >
              {varBusy ? "Generating variations…" : "Generate Variations (3)"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
