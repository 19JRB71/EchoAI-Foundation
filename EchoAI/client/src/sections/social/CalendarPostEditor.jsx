import { useEffect, useState } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";

function postId(post) {
  return post?.post_id || post?.postId;
}

function postContent(post) {
  return post?.post_content ?? post?.postContent ?? "";
}

export default function CalendarPostEditor({
  post,
  expectedStatus,
  onCancel,
  onSaved,
  onStateChange,
}) {
  const initialContent = postContent(post);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = content !== initialContent;

  useEffect(() => {
    onStateChange?.({ open: true, dirty, saving });
  }, [dirty, saving, onStateChange]);

  useEffect(
    () => () => onStateChange?.({ open: false, dirty: false, saving: false }),
    [onStateChange],
  );

  async function save(event) {
    event.preventDefault();
    const nextContent = content.trim();
    if (!nextContent || !dirty || saving) return;
    setSaving(true);
    setError("");
    try {
      const data = expectedStatus
        ? await api.updateCalendarPost(postId(post), nextContent, expectedStatus)
        : await api.updateCalendarPost(postId(post), nextContent);
      await onSaved?.(data.post || { ...post, post_content: nextContent });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} data-testid="calendar-post-editor">
      <label className="mb-1 block text-xs font-medium text-gray-400">
        Edit post text
      </label>
      <textarea
        aria-label="Post text"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={8}
        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
      />
      <ErrorBanner message={error} />
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !dirty || !content.trim()}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}