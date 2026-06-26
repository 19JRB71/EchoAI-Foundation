import { PlatformBadge, platformMeta } from "../social/platformMeta.jsx";

const LENGTH_LABELS = {
  short: "Short (under 60s)",
  medium: "Medium (1–3 min)",
  long: "Long (5–10 min)",
};

export function lengthLabel(length) {
  return LENGTH_LABELS[length] || length;
}

// Flattens a generated video package into a single plain-text block for the
// "Copy to clipboard" action.
export function videoPackageToText(pkg, { platform, length, topic } = {}) {
  if (!pkg) return "";
  const lines = [];
  if (pkg.title) lines.push(pkg.title);
  if (platform) lines.push(`Platform: ${platformMeta(platform).label}`);
  if (length) lines.push(`Length: ${lengthLabel(length)}`);
  if (topic) lines.push(`Topic: ${topic}`);
  lines.push("");
  if (pkg.hook) {
    lines.push("HOOK (first 3 seconds):");
    lines.push(pkg.hook);
    lines.push("");
  }
  (pkg.scenes || []).forEach((s, i) => {
    lines.push(`SCENE ${s.scene || i + 1}`);
    if (s.script) lines.push(`Script: ${s.script}`);
    if (s.visual) lines.push(`Visual: ${s.visual}`);
    if (s.onScreenText) lines.push(`On-screen text: ${s.onScreenText}`);
    lines.push("");
  });
  if (pkg.callToAction) {
    lines.push("CALL TO ACTION:");
    lines.push(pkg.callToAction);
    lines.push("");
  }
  if (pkg.musicStyle) lines.push(`Background music: ${pkg.musicStyle}`);
  if (pkg.thumbnailConcept)
    lines.push(`Thumbnail concept: ${pkg.thumbnailConcept}`);
  return lines.join("\n").trim();
}

// Renders a generated/saved video package in a clean, readable layout.
export default function VideoPackageView({ pkg, platform, length, topic }) {
  if (!pkg) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {platform && <PlatformBadge platform={platform} />}
        <div>
          {pkg.title && (
            <h3 className="text-base font-semibold text-gray-100">{pkg.title}</h3>
          )}
          <p className="text-xs text-gray-400">
            {platform && platformMeta(platform).label}
            {length ? ` · ${lengthLabel(length)}` : ""}
            {topic ? ` · ${topic}` : ""}
          </p>
        </div>
      </div>

      {pkg.hook && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
            Hook · first 3 seconds
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-100">
            {pkg.hook}
          </p>
        </div>
      )}

      {Array.isArray(pkg.scenes) && pkg.scenes.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Script &amp; scenes
          </p>
          {pkg.scenes.map((scene, i) => (
            <div
              key={i}
              className="rounded-xl border border-gray-800 bg-gray-900 p-4"
            >
              <div className="mb-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-gray-900">
                {scene.scene || i + 1}
              </div>
              {scene.script && (
                <p className="whitespace-pre-wrap text-sm text-gray-200">
                  {scene.script}
                </p>
              )}
              {scene.visual && (
                <p className="mt-2 text-xs text-gray-400">
                  <span className="font-semibold text-gray-300">Visual:</span>{" "}
                  {scene.visual}
                </p>
              )}
              {scene.onScreenText && (
                <p className="mt-1 text-xs text-gray-400">
                  <span className="font-semibold text-gray-300">
                    On-screen text:
                  </span>{" "}
                  {scene.onScreenText}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {pkg.callToAction && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
            Call to action
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-100">
            {pkg.callToAction}
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {pkg.musicStyle && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Background music
            </p>
            <p className="mt-1 text-sm text-gray-200">{pkg.musicStyle}</p>
          </div>
        )}
        {pkg.thumbnailConcept && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Thumbnail concept
            </p>
            <p className="mt-1 text-sm text-gray-200">{pkg.thumbnailConcept}</p>
          </div>
        )}
      </div>
    </div>
  );
}
