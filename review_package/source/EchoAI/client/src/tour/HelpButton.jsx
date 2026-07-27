// Floating "Take the Tour" button, present on every page. Carries the
// data-tour="tour-help-button" anchor so the tour itself can point at it.

export default function HelpButton({ onClick, hidden = false }) {
  if (hidden) return null;
  return (
    <button
      data-tour="tour-help-button"
      onClick={onClick}
      className="fixed bottom-5 right-5 z-[900] flex items-center gap-2 rounded-full bg-teal-500 px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-lg shadow-teal-500/20 transition hover:bg-teal-400"
      aria-label="Take the guided tour"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M12 17.25h.007v.008H12v-.008z"
        />
        <circle cx="12" cy="12" r="9" />
      </svg>
      Take the Tour
    </button>
  );
}
