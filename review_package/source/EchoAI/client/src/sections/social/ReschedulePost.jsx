import { useState } from "react";
import { api } from "../../api.js";
import { isInterruptedPublish } from "./postFailure.js";

// Local YYYY-MM-DDTHH:MM string one hour from now, for the datetime-local input.
function defaultLocalValue() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/**
 * One-click recovery for a FAILED post: pick a new future time and put it back
 * on the schedule (status -> 'scheduled', stored failure reason cleared).
 * Interrupted publishes ("may or may not have gone out") additionally require
 * an explicit checkbox confirming the owner checked the platform, because
 * re-publishing could double-post. Parent must only render this for posts with
 * status === 'failed'.
 */
export default function ReschedulePost({ post, onRescheduled }) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState(defaultLocalValue);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const interrupted = isInterruptedPublish(post);

  async function submit() {
    setError("");
    const d = new Date(when);
    if (!when || Number.isNaN(d.getTime())) {
      setError("Pick a valid date and time.");
      return;
    }
    if (d.getTime() <= Date.now()) {
      setError("The new time must be in the future.");
      return;
    }
    setBusy(true);
    try {
      const data = await api.rescheduleSocialPost(post.post_id, d.toISOString());
      await onRescheduled(data.post);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-3">
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Reschedule
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-800 bg-gray-800/60 p-3">
      {interrupted && (
        <div className="mb-3 rounded-lg border border-amber-700/60 bg-amber-900/20 p-3 text-xs">
          <p className="mb-1 font-semibold text-amber-300">
            Careful — this post may already be live
          </p>
          <p className="mb-2 text-amber-200">
            Publishing was interrupted, so this post may or may not have gone
            out. Rescheduling it could post it twice. Check the platform first.
          </p>
          <label className="flex items-start gap-2 text-amber-100">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span>I checked the platform — this post did not go out</span>
          </label>
        </div>
      )}

      <label className="mb-1 block text-xs font-medium text-gray-400">
        New publish time
      </label>
      <input
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
      />

      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={() => {
            setOpen(false);
            setError("");
          }}
          disabled={busy}
          className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={busy || (interrupted && !confirmed)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Rescheduling…" : "Confirm reschedule"}
        </button>
      </div>
    </div>
  );
}
