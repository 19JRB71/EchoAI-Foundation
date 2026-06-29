// Contextual "?" help icon shown next to a section title. Click toggles a small
// popover explaining what the section does, its key features, and a pro tip.
//
// Pass `tourAnchor` on one instance so the tour's "contextual help" step can find
// it via data-tour="section-help".

import { useEffect, useRef, useState } from "react";
import { helpFor } from "./helpContent.js";

export default function SectionHelp({ sectionKey, tourAnchor = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const help = helpFor(sectionKey);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!help) return null;

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        data-tour={tourAnchor ? "section-help" : undefined}
        onClick={() => setOpen((o) => !o)}
        aria-label={`Help: ${help.title}`}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-600 text-[11px] font-bold text-gray-400 transition hover:border-teal-400 hover:text-teal-300"
      >
        ?
      </button>

      {open && (
        <div className="absolute left-0 top-7 z-50 w-72 rounded-xl border border-gray-700 bg-gray-900 p-4 text-left shadow-2xl">
          <div className="text-sm font-bold text-gray-100">{help.title}</div>
          <p className="mt-1 text-xs leading-relaxed text-gray-400">{help.what}</p>
          {help.features && help.features.length > 0 && (
            <ul className="mt-3 space-y-1">
              {help.features.map((f) => (
                <li key={f} className="flex items-start gap-1.5 text-xs text-gray-300">
                  <span className="mt-0.5 text-teal-400">•</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          )}
          {help.tip && (
            <div className="mt-3 rounded-lg bg-teal-500/10 p-2 text-xs leading-relaxed text-teal-200">
              <span className="font-semibold">Tip:</span> {help.tip}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
