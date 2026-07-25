/**
 * Formatted display of a generated sales script, plus a salesScriptToText helper
 * used for the "Copy to Clipboard" buttons.
 */

const SALE_TYPE_LABELS = {
  cold_call: "Cold Call",
  warm_follow_up: "Warm Follow-Up",
  in_person_meeting: "In-Person Meeting",
};

export function saleTypeLabel(saleType) {
  return SALE_TYPE_LABELS[saleType] || saleType || "";
}

const STYLE_LABELS = {
  soft: "Soft",
  medium: "Medium",
  direct: "Direct",
};

function Section({ title, children }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-300">
        {title}
      </h4>
      {children}
    </div>
  );
}

export function salesScriptToText(script, meta = {}) {
  if (!script) return "";
  const lines = [];
  if (meta.targetPersona) lines.push(`Persona: ${meta.targetPersona}`);
  if (meta.saleType) lines.push(`Type: ${saleTypeLabel(meta.saleType)}`);
  if (meta.desiredOutcome) lines.push(`Goal: ${meta.desiredOutcome}`);
  if (lines.length) lines.push("");

  if (script.opening) {
    lines.push("OPENING");
    lines.push(script.opening);
    lines.push("");
  }
  if (Array.isArray(script.discoveryQuestions) && script.discoveryQuestions.length) {
    lines.push("DISCOVERY QUESTIONS");
    script.discoveryQuestions.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
    lines.push("");
  }
  if (script.pitch) {
    lines.push("PITCH");
    lines.push(script.pitch);
    lines.push("");
  }
  if (Array.isArray(script.objectionHandling) && script.objectionHandling.length) {
    lines.push("OBJECTION HANDLING");
    script.objectionHandling.forEach((o) => {
      lines.push(`Objection: ${o.objection}`);
      lines.push(`Response: ${o.response}`);
      lines.push("");
    });
  }
  if (Array.isArray(script.closingTechniques) && script.closingTechniques.length) {
    lines.push("CLOSING TECHNIQUES");
    script.closingTechniques.forEach((c) => {
      const label = c.style ? `${c.name} (${STYLE_LABELS[c.style] || c.style})` : c.name;
      lines.push(`- ${label}`);
      lines.push(`  ${c.script}`);
    });
    lines.push("");
  }
  if (Array.isArray(script.followUpSequence) && script.followUpSequence.length) {
    lines.push("FOLLOW-UP SEQUENCE");
    script.followUpSequence.forEach((f) => {
      const head = [f.day ? `Day ${f.day}` : null, f.channel].filter(Boolean).join(" · ");
      lines.push(head ? `${head}:` : "Follow-up:");
      lines.push(f.message);
      lines.push("");
    });
  }
  return lines.join("\n").trim();
}

export default function SalesScriptView({ script, saleType, targetPersona, desiredOutcome }) {
  if (!script) return null;

  return (
    <div className="space-y-5 text-sm text-gray-200">
      <div className="flex flex-wrap items-center gap-2">
        {saleType && (
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300">
            {saleTypeLabel(saleType)}
          </span>
        )}
        {targetPersona && (
          <span className="rounded-full bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-300">
            {targetPersona}
          </span>
        )}
      </div>

      {desiredOutcome && (
        <p className="text-xs text-gray-400">
          <span className="font-medium text-gray-300">Goal:</span> {desiredOutcome}
        </p>
      )}

      {script.opening && (
        <Section title="Opening">
          <p className="whitespace-pre-wrap leading-relaxed">{script.opening}</p>
        </Section>
      )}

      {Array.isArray(script.discoveryQuestions) &&
        script.discoveryQuestions.length > 0 && (
          <Section title="Discovery Questions">
            <ul className="list-decimal space-y-1.5 pl-5 leading-relaxed">
              {script.discoveryQuestions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </Section>
        )}

      {script.pitch && (
        <Section title="Pitch">
          <p className="whitespace-pre-wrap leading-relaxed">{script.pitch}</p>
        </Section>
      )}

      {Array.isArray(script.objectionHandling) &&
        script.objectionHandling.length > 0 && (
          <Section title="Objection Handling">
            <div className="space-y-3">
              {script.objectionHandling.map((o, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-gray-800 bg-gray-900/60 p-3"
                >
                  <p className="font-medium text-gray-100">“{o.objection}”</p>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed text-gray-300">
                    {o.response}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        )}

      {Array.isArray(script.closingTechniques) &&
        script.closingTechniques.length > 0 && (
          <Section title="Closing Techniques">
            <div className="space-y-3">
              {script.closingTechniques.map((c, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-gray-800 bg-gray-900/60 p-3"
                >
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-100">{c.name}</p>
                    {c.style && (
                      <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
                        {STYLE_LABELS[c.style] || c.style}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed text-gray-300">
                    {c.script}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        )}

      {Array.isArray(script.followUpSequence) &&
        script.followUpSequence.length > 0 && (
          <Section title="Follow-Up Sequence">
            <div className="space-y-3">
              {script.followUpSequence.map((f, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-gray-800 bg-gray-900/60 p-3"
                >
                  <p className="text-xs font-medium text-amber-300">
                    {[f.day ? `Day ${f.day}` : null, f.channel]
                      .filter(Boolean)
                      .join(" · ") || "Follow-up"}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed text-gray-300">
                    {f.message}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        )}
    </div>
  );
}
