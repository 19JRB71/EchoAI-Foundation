/**
 * Prompt 022 — Sage pre-interview research panel (guided wizard, profile step).
 *
 * Lets the owner ask Sage to research their business's PUBLIC presence and
 * shows the resulting UNAPPROVED draft: every field carries its source,
 * confidence, and a CONTESTED marker (with the alternatives) when sources
 * disagree. Nothing here writes the profile — the draft only informs the
 * upcoming interview. The wizard NEVER blocks on this panel: every state
 * (running, empty, partial, complete, failed) leaves the Continue button
 * untouched.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";

const SOURCE_LABELS = {
  website: "Their website",
  facebook: "Facebook Page",
  public_web: "Public web",
  inferred: "Inferred",
};

const FIELD_LABELS = {
  business_name: "Business name",
  description: "Description",
  services: "Services",
  service_area: "Service area",
  address: "Address",
  phone: "Phone",
  email: "Email",
  hours: "Hours",
  target_audience: "Target audience",
};

function SourceChip({ source }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-gray-800 px-1.5 py-0.5 text-[11px] text-gray-300">
      {SOURCE_LABELS[source.source] || source.source}
      {source.source_url ? (
        <span className="max-w-[180px] truncate text-gray-500">{source.source_url}</span>
      ) : null}
    </span>
  );
}

function FieldCard({ fieldKey, field }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-3" data-testid={`research-field-${fieldKey}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {FIELD_LABELS[fieldKey] || fieldKey}
        </span>
        <span className="rounded bg-amber-900/50 px-1.5 py-0.5 text-[11px] font-bold text-amber-300">
          UNAPPROVED
        </span>
        <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[11px] text-gray-400">
          confidence: {field.confidence}
        </span>
        {field.conflict ? (
          <span
            data-testid={`research-contested-${fieldKey}`}
            className="rounded bg-red-900/50 px-1.5 py-0.5 text-[11px] font-bold text-red-300"
          >
            CONTESTED
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-gray-100">{field.value}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {(field.sources || []).map((s, i) => (
          <SourceChip key={i} source={s} />
        ))}
      </div>
      {field.conflict && (field.alternatives || []).length > 0 ? (
        <div className="mt-2 border-t border-gray-800 pt-2">
          <p className="text-[11px] font-semibold text-red-300">Sources disagree — also found:</p>
          {field.alternatives.map((alt, i) => (
            <div key={i} className="mt-1" data-testid={`research-alternative-${fieldKey}-${i}`}>
              <p className="text-sm text-gray-300">{alt.value}</p>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {(alt.sources || []).map((s, j) => (
                  <SourceChip key={j} source={s} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function SageResearchPanel({ brandId: brandIdProp = null }) {
  const [resolvedBrandId, setResolvedBrandId] = useState(brandIdProp);
  const brandId = brandIdProp || resolvedBrandId;
  const [draft, setDraft] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);
  const mountedRef = useRef(true);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const load = useCallback(async () => {
    if (!brandId) return;
    try {
      const data = await api.getBrandResearch(brandId);
      if (!mountedRef.current) return;
      setDraft(data.draft);
      if (!data.draft || data.draft.status !== "running") stopPolling();
    } catch {
      // Polling is best-effort; the wizard must never break over it.
      if (mountedRef.current) stopPolling();
    }
  }, [brandId, stopPolling]);

  // The wizard renders this panel before a brand may exist; resolve the
  // owner's first brand the same way OnlineLinksPanel does. No brand yet ->
  // the panel simply renders nothing (never blocks the wizard).
  useEffect(() => {
    if (brandIdProp) return undefined;
    let cancelled = false;
    api
      .getBrands()
      .then((brands) => {
        const list = Array.isArray(brands) ? brands : brands?.brands || [];
        if (!cancelled && list.length) setResolvedBrandId(list[0].brand_id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [brandIdProp]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [load, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(load, 4000);
  }, [load, stopPolling]);

  const start = useCallback(async () => {
    if (!brandId || starting) return;
    setStarting(true);
    setError(null);
    try {
      await api.startBrandResearch(brandId);
      setDraft({ status: "running", fields: {} });
      startPolling();
    } catch (e) {
      if (e && e.status === 409) {
        setDraft((d) => d || { status: "running", fields: {} });
        startPolling();
      } else {
        setError("Sage couldn't start researching right now. You can keep going — nothing is blocked.");
      }
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  }, [brandId, starting, startPolling]);

  useEffect(() => {
    if (draft && draft.status === "running" && !pollRef.current) startPolling();
  }, [draft, startPolling]);

  // Prompt 035 Section D1 — confirm an UNATTRIBUTED candidate: the owner's
  // click turns a "maybe" into a real anchor (website/facebook saved on the
  // brand), which the server-side orchestrator picks up as an anchor arrival
  // and investigates immediately. Nothing is attributed without this click.
  const [confirming, setConfirming] = useState(null);
  const confirmCandidate = useCallback(
    async (cand) => {
      if (!brandId || confirming) return;
      setConfirming(cand.url);
      setError(null);
      try {
        const payload =
          cand.kind === "facebook" ? { facebookPageUrl: cand.url } : { websiteUrl: cand.url };
        await api.updateBrand(brandId, payload);
        // The orchestrator starts a fresh anchored run server-side; poll for it.
        setDraft({ status: "running", fields: {} });
        startPolling();
      } catch {
        setError("Couldn't save that link. You can add it under Business Links instead.");
      } finally {
        if (mountedRef.current) setConfirming(null);
      }
    },
    [brandId, confirming, startPolling],
  );

  if (!brandId) return null;

  const fields = (draft && draft.fields) || {};
  // Prompt 035: `_candidates` is a reserved non-field key (unattributed
  // entity leads from a name-only run) — rendered separately, never as facts.
  const candidates = Array.isArray(fields._candidates) ? fields._candidates : [];
  const fieldKeys = Object.keys(fields).filter((k) => k !== "_candidates");

  return (
    <div className="mt-4 rounded-xl border border-gray-800 bg-gray-950/50 p-4" data-testid="sage-research-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-gray-100">Let Sage look you up first</h3>
          <p className="text-xs text-gray-400">
            Sage can check your public presence so the interview skips what you already publish.
            Nothing is saved to your profile until you confirm it.
          </p>
        </div>
        {(!draft || ["complete", "partial", "empty", "failed"].includes(draft.status)) && (
          <button
            type="button"
            onClick={start}
            disabled={starting}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            data-testid="research-start"
          >
            {draft ? "Research again" : "Research my business"}
          </button>
        )}
      </div>

      {error ? <p className="mt-2 text-xs text-amber-300">{error}</p> : null}

      {draft && draft.status === "running" ? (
        <p className="mt-3 text-sm text-gray-300" data-testid="research-running">
          <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent align-middle" />
          Sage is researching your business… this can take a couple of minutes. Feel free to keep going.
        </p>
      ) : null}

      {draft && draft.status === "failed" ? (
        <p className="mt-3 text-sm text-gray-300" data-testid="research-failed">
          {draft.errorMessage || "Research didn't finish. You can continue — Sage will just ask a few more questions."}
        </p>
      ) : null}

      {draft && ["complete", "partial", "empty"].includes(draft.status) ? (
        <div className="mt-3">
          {draft.summary ? (
            <p className="text-sm text-gray-300" data-testid="research-summary">
              {draft.summary}
            </p>
          ) : null}
          {candidates.length > 0 ? (
            <div className="mt-2 rounded-lg border border-indigo-900/60 bg-indigo-950/30 p-3" data-testid="research-candidates">
              <p className="text-xs font-semibold text-indigo-300">
                Sage found businesses that might be yours — nothing is attributed until you confirm:
              </p>
              <div className="mt-2 grid gap-2">
                {candidates.map((c, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2" data-testid={`research-candidate-${i}`}>
                    <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[11px] text-gray-300">
                      {c.kind === "facebook" ? "Facebook Page" : c.kind === "website" ? "Website" : "Source"}
                    </span>
                    <span className="max-w-[260px] truncate text-sm text-gray-100">{c.url}</span>
                    {c.kind === "website" || c.kind === "facebook" ? (
                      <button
                        type="button"
                        onClick={() => confirmCandidate(c)}
                        disabled={Boolean(confirming)}
                        className="rounded bg-indigo-700 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-indigo-600 disabled:opacity-50"
                        data-testid={`research-candidate-confirm-${i}`}
                      >
                        {confirming === c.url ? "Saving…" : "Yes, that's mine"}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {fieldKeys.length > 0 ? (
            <div className="mt-2 grid gap-2">
              {fieldKeys.map((k) => (
                <FieldCard key={k} fieldKey={k} field={fields[k]} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
