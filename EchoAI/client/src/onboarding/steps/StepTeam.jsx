// Onboarding step: invite your team (optional / skippable).
//
// The account owner can invite teammates and assign roles right after choosing
// a plan, or skip and do it later from Settings → Team. Inviting here is
// entirely optional, so this step always lets them continue.

import TeamManagement from "../../sections/team/TeamManagement.jsx";

const navBtn =
  "rounded-lg px-5 py-2.5 text-sm font-semibold transition disabled:opacity-60";

export default function StepTeam({ onNext, onBack }) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-100">Invite your team</h2>
        <p className="mt-2 text-sm text-gray-400">
          Add teammates and assign roles so they can collaborate in your
          workspace. You can always do this later from Settings → Team.
        </p>
      </div>

      <TeamManagement />

      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className={`${navBtn} border border-gray-700 text-gray-300 hover:bg-gray-800`}
        >
          Back
        </button>
        <button
          onClick={onNext}
          className={`${navBtn} bg-amber-500 text-gray-900 hover:bg-amber-600`}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
