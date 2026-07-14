// "Here's what you'll see" — shown right before an official OAuth window
// opens. A static annotated illustration of the upcoming third-party screen
// with the correct button visually marked, plus Echo's one-line instruction
// (spoken when voice is available, always shown as text).

export default function PreviewPanel({ connection, onContinue, onCancel, busy }) {
  const { name, previewImage, previewInstruction, Logo } = connection;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`What you'll see on ${name}`}
    >
      <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <Logo className="h-9 w-9" />
          <div>
            <h3 className="text-lg font-bold text-gray-100">Here&apos;s what you&apos;ll see</h3>
            <p className="text-xs text-gray-400">{name} will open its own secure page.</p>
          </div>
        </div>

        <img
          src={previewImage}
          alt={`Illustration of the ${name} screen you're about to see, with the button to press highlighted`}
          className="mt-4 w-full rounded-xl border border-gray-800"
        />

        <p className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-200">
          {previewInstruction}
        </p>
        <p className="mt-2 text-xs text-gray-500">
          You&apos;ll sign in on {name}&apos;s own page — Echo never sees your password.
        </p>

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-gray-700 px-5 py-2.5 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={onContinue}
            disabled={busy}
            className="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-50"
          >
            {busy ? "Opening…" : `Take me to ${name}`}
          </button>
        </div>
      </div>
    </div>
  );
}
