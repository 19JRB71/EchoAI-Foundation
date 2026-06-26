import { useState } from "react";

/**
 * Renders an AI-generated email sequence as a list of expandable cards. Each
 * card shows the subject and send timing collapsed, and expands to reveal the
 * preview text, full body, and call to action.
 */
export default function EmailSequenceView({ emails }) {
  const list = Array.isArray(emails) ? emails : [];
  const [open, setOpen] = useState(() => (list.length ? { 0: true } : {}));

  if (list.length === 0) {
    return <p className="text-sm text-gray-400">No emails in this sequence.</p>;
  }

  function toggle(i) {
    setOpen((prev) => ({ ...prev, [i]: !prev[i] }));
  }

  return (
    <div className="space-y-3">
      {list.map((email, i) => {
        const isOpen = !!open[i];
        return (
          <div
            key={i}
            className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900 shadow-sm"
          >
            <button
              onClick={() => toggle(i)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-xs font-semibold text-amber-300">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-100">
                    {email.subject || `Email ${i + 1}`}
                  </p>
                  {email.sendTiming && (
                    <p className="truncate text-xs text-gray-400">
                      {email.sendTiming}
                    </p>
                  )}
                </div>
              </div>
              <span className="shrink-0 text-gray-500">{isOpen ? "−" : "+"}</span>
            </button>

            {isOpen && (
              <div className="space-y-4 border-t border-gray-800 px-4 py-4">
                {email.previewText && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Preview text
                    </p>
                    <p className="mt-1 text-sm text-gray-300">
                      {email.previewText}
                    </p>
                  </div>
                )}

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Body
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-200">
                    {email.body || ""}
                  </p>
                </div>

                {email.callToAction && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Call to action
                    </p>
                    <p className="mt-1 text-sm font-medium text-amber-300">
                      {email.callToAction}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
