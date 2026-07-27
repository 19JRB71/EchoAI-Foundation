import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";

const CONTENT_TYPES = [
  { key: "blog_post", label: "Blog post" },
  { key: "landing_page", label: "Landing page" },
  { key: "product_description", label: "Product description" },
];

function ScoreBadge({ score }) {
  if (score == null) return null;
  const color =
    score >= 80
      ? "bg-green-500/15 text-green-400"
      : score >= 50
        ? "bg-amber-500/15 text-amber-300"
        : "bg-red-500/15 text-red-400";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}>
      SEO score {score}/100
    </span>
  );
}

function ContentView({ content }) {
  if (!content) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ScoreBadge score={content.seoScore} />
      </div>

      {content.title && (
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Title (H1)</p>
          <p className="text-lg font-semibold text-gray-100">{content.title}</p>
        </div>
      )}

      {content.metaDescription && (
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Meta description</p>
          <p className="text-sm text-gray-300">{content.metaDescription}</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {content.metaDescription.length} characters
          </p>
        </div>
      )}

      {Array.isArray(content.headers) && content.headers.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Header structure</p>
          <ul className="mt-1 space-y-1">
            {content.headers.map((h, i) => (
              <li key={i} className="text-sm text-gray-300">
                <span className="mr-2 rounded bg-gray-800 px-1.5 py-0.5 text-xs font-semibold text-amber-300">
                  {h.level}
                </span>
                {h.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {content.body && (
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Body</p>
          <div className="mt-1 whitespace-pre-wrap rounded-lg border border-gray-800 bg-gray-950 p-4 text-sm leading-relaxed text-gray-200">
            {content.body}
          </div>
        </div>
      )}

      {Array.isArray(content.internalLinks) && content.internalLinks.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Internal link suggestions</p>
          <ul className="mt-1 space-y-1">
            {content.internalLinks.map((l, i) => (
              <li key={i} className="text-sm text-gray-300">
                <span className="font-medium text-amber-300">{l.anchorText}</span>
                {l.target ? <span className="text-gray-500"> → {l.target}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {Array.isArray(content.relatedKeywords) && content.relatedKeywords.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Related keywords woven in</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {content.relatedKeywords.map((k, i) => (
              <span key={i} className="rounded-full bg-gray-800 px-2.5 py-0.5 text-xs text-gray-300">
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {content.seoScoreExplanation && (
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Why this ranks</p>
          <p className="text-sm text-gray-300">{content.seoScoreExplanation}</p>
        </div>
      )}
    </div>
  );
}

export default function SeoGenerator({ brandId }) {
  const [keyword, setKeyword] = useState("");
  const [contentType, setContentType] = useState("blog_post");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { keyword, contentType, content }

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");

  const [saved, setSaved] = useState([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState("");

  const loadSaved = useCallback(async () => {
    if (!brandId) return;
    setSavedLoading(true);
    setSavedError("");
    try {
      const data = await api.getSeoContent(brandId);
      setSaved(data.content || []);
    } catch (err) {
      setSavedError(err.message);
    } finally {
      setSavedLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  async function handleGenerate(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setSaveError("");
    if (!keyword.trim()) {
      setError("Enter a target keyword to generate SEO content.");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const data = await api.generateSeoContent({
        brandId,
        keyword: keyword.trim(),
        contentType,
      });
      setResult({ keyword: data.keyword, contentType: data.contentType, content: data.content });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    setSaveError("");
    setNotice("");
    try {
      await api.saveSeoContent({
        brandId,
        keyword: result.keyword,
        contentType: result.contentType,
        content: result.content,
        seoScore: result.content?.seoScore,
      });
      setNotice("SEO content saved.");
      loadSaved();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(contentId) {
    try {
      await api.deleteSeoContent(contentId);
      setSaved((list) => list.filter((c) => c.contentId !== contentId));
    } catch (err) {
      setSavedError(err.message);
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
            Target keyword or topic
          </label>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="e.g. best project management software for small teams"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">
            Content type
          </label>
          <select
            value={contentType}
            onChange={(e) => setContentType(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          >
            {CONTENT_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <ErrorBanner message={error} />

        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
        >
          {loading ? "Generating…" : "Generate SEO Content"}
        </button>
      </form>

      {loading && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-400 shadow-sm">
          Writing SEO-optimized content…
        </div>
      )}

      {result && !loading && (
        <div className="space-y-4 rounded-xl border border-gray-800 bg-gray-900/60 p-5 shadow-sm">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save Content"}
            </button>
          </div>
          {notice && (
            <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-400">
              {notice}
            </p>
          )}
          <ErrorBanner message={saveError} />
          <ContentView content={result.content} />
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-100">Saved SEO content</h3>
        <ErrorBanner message={savedError} />
        {savedLoading ? (
          <p className="text-sm text-gray-400">Loading saved content…</p>
        ) : saved.length === 0 ? (
          <p className="text-sm text-gray-400">No saved SEO content yet.</p>
        ) : (
          <ul className="space-y-2">
            {saved.map((item) => (
              <li
                key={item.contentId}
                className="rounded-lg border border-gray-800 bg-gray-900 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-100">
                      {item.content?.title || item.keyword}
                    </p>
                    <p className="text-xs text-gray-500">
                      {item.keyword} · {item.contentType}
                      {item.seoScore != null ? ` · SEO ${item.seoScore}/100` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(item.contentId)}
                    className="shrink-0 rounded-lg border border-red-700/50 px-3 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/10"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
