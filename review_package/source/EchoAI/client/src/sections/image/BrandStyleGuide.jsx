import { useState, useEffect, useCallback } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import Spinner from "../../components/Spinner.jsx";
import PromptCard from "./PromptCard.jsx";

// A purpose to anchor the regenerated base prompts. Square posts read well as a
// generic on-brand reference set.
const BASE_PURPOSE = "instagram_post";
const BASE_BRIEF =
  "A signature, on-brand marketing visual that captures the brand's core aesthetic, palette, and mood.";

export default function BrandStyleGuide({ brandId, onSaved, onUseInSocial }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [guide, setGuide] = useState(null);

  const [promptsLoading, setPromptsLoading] = useState(false);
  const [promptsError, setPromptsError] = useState("");
  const [basePrompts, setBasePrompts] = useState(null); // { purpose, platform, description, prompts }

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getBrandStyleGuide(brandId);
      setGuide(data.styleGuide);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRegenerate() {
    setPromptsLoading(true);
    setPromptsError("");
    setBasePrompts(null);
    try {
      const data = await api.generateImagePrompts({
        brandId,
        purpose: BASE_PURPOSE,
        description: BASE_BRIEF,
      });
      setBasePrompts(data);
    } catch (err) {
      setPromptsError(err.message);
    } finally {
      setPromptsLoading(false);
    }
  }

  if (loading) return <Spinner label="Loading brand style guide…" />;

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} />

      {guide && (
        <div className="space-y-5 rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">Color palette</h3>
            {guide.palette?.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {guide.palette.map((c, i) => (
                  <Swatch key={i} value={c} />
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-gray-500">
                No palette saved yet — refine your brand profile in Settings.
              </p>
            )}
          </div>

          <Field label="Visual style" value={guide.visualStyle} />
          <Field label="Mood" value={guide.mood} />
          <Field label="Brand personality" value={guide.personality} />
          <Field label="Voice" value={guide.voice} />
          <Field label="Target audience" value={guide.audience} />
        </div>
      )}

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">
              Base brand prompts
            </h3>
            <p className="mt-0.5 text-xs text-gray-400">
              Refresh a set of 5 foundational, on-brand image prompts from your
              current brand profile.
            </p>
          </div>
          <button
            onClick={handleRegenerate}
            disabled={promptsLoading}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
          >
            {promptsLoading ? "Refreshing…" : "Regenerate Brand Prompts"}
          </button>
        </div>

        <div className="mt-4">
          <ErrorBanner message={promptsError} />
        </div>

        {basePrompts && basePrompts.prompts?.length > 0 && (
          <div className="mt-2 space-y-4">
            {basePrompts.prompts.map((p, i) => (
              <PromptCard
                key={i}
                index={i}
                brandId={brandId}
                purpose={basePrompts.purpose}
                platform={basePrompts.platform}
                contentDescription={basePrompts.description}
                prompt={p}
                onSaved={onSaved}
                onUseInSocial={onUseInSocial}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-100">{label}</h3>
      <p className="mt-1 text-sm text-gray-300">
        {value || <span className="text-gray-500">Not set</span>}
      </p>
    </div>
  );
}

function Swatch({ value }) {
  const isColor = /^#?[0-9a-fA-F]{3,8}$/.test(value.trim());
  const bg = isColor ? (value.startsWith("#") ? value : `#${value}`) : null;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-gray-700 bg-gray-950 px-3 py-1 text-xs text-gray-200">
      {bg && (
        <span
          className="h-4 w-4 rounded-full border border-gray-600"
          style={{ backgroundColor: bg }}
        />
      )}
      {value}
    </span>
  );
}
