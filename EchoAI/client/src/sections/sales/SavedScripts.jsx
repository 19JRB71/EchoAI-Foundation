import { useEffect, useState, useCallback } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import SalesScriptView, {
  saleTypeLabel,
  salesScriptToText,
} from "./SalesScriptView.jsx";

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function SavedScripts({ brandId, refreshKey }) {
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [copied, setCopied] = useState(false);

  // Inline persona edit for the selected script.
  const [editing, setEditing] = useState(false);
  const [personaDraft, setPersonaDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getSalesScripts(brandId);
      setScripts(data.scripts || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function handleDelete(scriptId) {
    try {
      await api.deleteSalesScript(scriptId);
      setScripts((prev) => prev.filter((s) => s.script_id !== scriptId));
      if (selected && selected.script_id === scriptId) setSelected(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleStatus(script) {
    const next = script.status === "active" ? "draft" : "active";
    try {
      const data = await api.updateSalesScript(script.script_id, {
        status: next,
      });
      const updated = data.script;
      setScripts((prev) =>
        prev.map((s) => (s.script_id === updated.script_id ? updated : s)),
      );
      if (selected && selected.script_id === updated.script_id)
        setSelected(updated);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSavePersona() {
    if (!selected || !personaDraft.trim()) return;
    setSavingEdit(true);
    setError("");
    try {
      const data = await api.updateSalesScript(selected.script_id, {
        targetPersona: personaDraft.trim(),
      });
      const updated = data.script;
      setSelected(updated);
      setScripts((prev) =>
        prev.map((s) => (s.script_id === updated.script_id ? updated : s)),
      );
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleCopy(script) {
    const text = salesScriptToText(script.script_content, {
      saleType: script.sale_type,
      targetPersona: script.target_persona,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy to clipboard.");
    }
  }

  if (selected) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setSelected(null);
              setEditing(false);
            }}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-gray-800"
          >
            ← Back to saved scripts
          </button>
          <button
            onClick={() => handleCopy(selected)}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-gray-800"
          >
            {copied ? "Copied!" : "Copy to Clipboard"}
          </button>
          <button
            onClick={() => {
              setPersonaDraft(selected.target_persona || "");
              setEditing((v) => !v);
            }}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-gray-800"
          >
            {editing ? "Cancel edit" : "Edit persona"}
          </button>
          <button
            onClick={() => handleToggleStatus(selected)}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-200 hover:bg-gray-800"
          >
            {selected.status === "active" ? "Mark as draft" : "Mark as active"}
          </button>
          <button
            onClick={() => handleDelete(selected.script_id)}
            className="rounded-lg border border-red-500/40 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/10"
          >
            Delete
          </button>
        </div>

        <ErrorBanner message={error} />

        {editing && (
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-sm font-medium text-gray-300">
                Target customer persona
              </label>
              <input
                type="text"
                value={personaDraft}
                onChange={(e) => setPersonaDraft(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
            <button
              onClick={handleSavePersona}
              disabled={savingEdit || !personaDraft.trim()}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
            >
              {savingEdit ? "Saving…" : "Save"}
            </button>
          </div>
        )}

        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 shadow-sm">
          <SalesScriptView
            script={selected.script_content}
            saleType={selected.sale_type}
            targetPersona={selected.target_persona}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />

      {loading ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-400 shadow-sm">
          Loading saved scripts…
        </div>
      ) : scripts.length === 0 ? (
        <p className="text-sm text-gray-400">
          No saved scripts yet. Generate one in the Script Generator and click
          Save Script.
        </p>
      ) : (
        <div className="space-y-3">
          {scripts.map((script) => {
            const title =
              script.target_persona || saleTypeLabel(script.sale_type);
            return (
              <div
                key={script.script_id}
                className="flex items-center justify-between gap-4 rounded-xl border border-gray-800 bg-gray-900 p-4 shadow-sm"
              >
                <button
                  onClick={() => setSelected(script)}
                  className="flex min-w-0 flex-1 flex-col text-left"
                >
                  <p className="truncate text-sm font-semibold text-gray-100">
                    {title}
                  </p>
                  <p className="truncate text-xs text-gray-400">
                    {saleTypeLabel(script.sale_type)} ·{" "}
                    {script.status === "active" ? "Active" : "Draft"} ·{" "}
                    {formatDate(script.created_at)}
                  </p>
                </button>
                <button
                  onClick={() => handleDelete(script.script_id)}
                  className="shrink-0 rounded-lg border border-gray-800 px-3 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-800 hover:text-red-400"
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
