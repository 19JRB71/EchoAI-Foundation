// First-login welcome modal shown to new users right after onboarding. Greets
// them by business name, summarizes what EchoAI will do, and offers to start the
// guided tour or jump straight to the dashboard.

const POINTS = [
  {
    icon: "🎯",
    title: "Capture & qualify leads",
    text: "Your chatbot, ads, and phone agent capture leads and auto-score them by intent.",
  },
  {
    icon: "⚡",
    title: "Automate your marketing",
    text: "Ads, social, email, and SMS run on autopilot — generated, scheduled, and optimized for you.",
  },
  {
    icon: "📈",
    title: "Grow with insight",
    text: "Track ROI in real time and let EchoAI tell you exactly what to do next.",
  },
];

export default function WelcomeModal({ businessName, tourLabel, onStart, onSkip }) {
  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/80 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-900 p-7 shadow-2xl">
        <div className="text-center">
          <div className="text-4xl">👋</div>
          <h2 className="mt-3 text-2xl font-bold text-gray-100">
            Welcome{businessName ? `, ${businessName}` : ""}!
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-400">
            EchoAI is your AI marketing team — here's what it's about to do for your
            business:
          </p>
        </div>

        <ul className="mt-6 space-y-3">
          {POINTS.map((p) => (
            <li
              key={p.title}
              className="flex items-start gap-3 rounded-xl border border-gray-800 bg-gray-950/60 p-3"
            >
              <span className="text-xl leading-none">{p.icon}</span>
              <div>
                <div className="text-sm font-semibold text-gray-200">{p.title}</div>
                <div className="mt-0.5 text-sm text-gray-400">{p.text}</div>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-7 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            onClick={onStart}
            className="flex-1 rounded-lg bg-teal-500 px-5 py-2.5 text-sm font-semibold text-gray-900 hover:bg-teal-400"
          >
            Start the tour{tourLabel ? ` (${tourLabel})` : ""}
          </button>
          <button
            onClick={onSkip}
            className="flex-1 rounded-lg border border-gray-700 px-5 py-2.5 text-sm font-semibold text-gray-300 hover:bg-gray-800"
          >
            Go to dashboard
          </button>
        </div>
        <p className="mt-3 text-center text-xs text-gray-500">
          You can take the tour any time from the help button or Settings.
        </p>
      </div>
    </div>
  );
}
