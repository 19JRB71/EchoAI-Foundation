import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";

/**
 * Business Profile review screen (Prompt 011).
 *
 * Shows each versioned knowledge field with its approved value (or the
 * legacy unversioned value), any pending proposal with a diff, provenance,
 * and history. Approving/rejecting takes effect immediately — approvals
 * write a new version; rejections keep the proposal in history unchanged.
 */

const FIELD_LABELS = {
  business_name: "Business name",
  tagline: "Tagline",
  description: "Description",
  industry: "Industry",
  services: "Products & services",
  service_area: "Service area",
  hours: "Hours",
  contact_info: "Contact info",
  differentiators: "What makes you different",
  brand_personality: "Brand personality",
  voice_description: "Voice description",
  target_audience: "Target audience",
};

function fieldLabel(key) {
  return FIELD_LABELS[key] || String(key).replace(/_/g, " ");
}

function asDisplay(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function SourceChips({ provenance }) {
  const sources = (provenance && provenance.sources) || [];
  if (!sources.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {sources.map((s, i) => (
        <span
          key={i}
          className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-300"
          title={s.url || s.basis || ""}
        >
          {String(s.source || "source").replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
}

function ProvenanceDrawer({ provenance }) {
  const [open, setOpen] = useState(false);
  if (!provenance) return null;
  const sources = provenance.sources || [];
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-semibold text-teal-400 hover:text-teal-300"
      >
        {open ? "Hide provenance" : "Where this came from"}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg border border-gray-800 bg-gray-900/60 p-3 text-xs text-gray-300">
          {sources.map((s, i) => (
            <div key={i} className="border-b border-gray-800 pb-2 last:border-0 last:pb-0">
              <div className="font-semibold uppercase tracking-wide text-gray-400">
                {String(s.source || "source").replace(/_/g, " ")}
              </div>
              {s.url && (
                <div className="break-all text-gray-400" title={s.url}>
                  {s.url}
                </div>
              )}
              {s.excerpt && <div className="mt-1 italic text-gray-300">&ldquo;{s.excerpt}&rdquo;</div>}
              {s.basis && <div className="mt-1 text-gray-300">{s.basis}</div>}
            </div>
          ))}
          {provenance.confidence && (
            <div>
              Confidence: <span className="font-semibold">{provenance.confidence}</span>
            </div>
          )}
          {Array.isArray(provenance.alternatives) && provenance.alternatives.length > 0 && (
            <div>
              <div className="font-semibold text-gray-400">Alternatives considered</div>
              {provenance.alternatives.map((a, i) => (
                <div key={i} className="text-gray-300">
                  {asDisplay(a && a.value !== undefined ? a.value : a)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryDrawer({ brandId, fieldKey }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [versions, setVersions] = useState(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && versions == null) {
      setLoading(true);
      setError("");
      try {
        const data = await api.getKnowledgeHistory(brandId, fieldKey);
        setVersions(data.versions || []);
      } catch (err) {
        setError(err.message || "Could not load history");
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="mt-2">
      <button onClick={toggle} className="text-xs font-semibold text-teal-400 hover:text-teal-300">
        {open ? "Hide history" : "History"}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-gray-800 bg-gray-900/60 p-3 text-xs text-gray-300">
          {loading && <div className="text-gray-400">Loading history…</div>}
          {error && <div className="text-red-400">{error}</div>}
          {!loading && !error && versions && versions.length === 0 && (
            <div className="text-gray-400">No versions yet for this field.</div>
          )}
          {!loading &&
            !error &&
            (versions || []).map((v) => (
              <div key={v.version_id || v.versionId} className="border-b border-gray-800 py-2 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-200">v{v.version_no ?? v.versionNo}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                      v.status === "current" ? "bg-emerald-900/60 text-emerald-300" : "bg-gray-800 text-gray-400"
                    }`}
                  >
                    {v.status}
                  </span>
                  <span className="text-gray-500">
                    {String(v.source_kind || v.sourceKind || "").replace(/_/g, " ")}
                    {" · "}
                    {String(v.proposed_by || v.proposedBy || "").replace(/_/g, " ")}
                  </span>
                </div>
                <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-gray-300">
                  {asDisplay(v.value)}
                </pre>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function FieldCard({ brandId, field, onDecide, onOwnerSave, busy }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const pending = field.pending || null;
  const approved = field.approved || null;
  const legacy = field.legacy || null;
  const currentValue = approved ? approved.value : legacy ? legacy.value : null;
  const contested = !!(pending && pending.provenance && pending.provenance.conflict === true);

  function startEdit() {
    setDraft(typeof currentValue === "string" ? currentValue : asDisplay(currentValue));
    setEditing(true);
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-100">{fieldLabel(field.fieldKey)}</h3>
        {approved ? (
          <span className="rounded-full bg-emerald-900/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
            Current (v{approved.version_no ?? approved.versionNo})
          </span>
        ) : legacy ? (
          <span
            className="rounded-full bg-amber-900/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300"
            title="This value predates versioned knowledge and has never been through a review."
          >
            Current (unversioned — never reviewed)
          </span>
        ) : (
          <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Not set
          </span>
        )}
        {contested && (
          <span
            className="rounded-full bg-red-900/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300"
            title="Sources disagree about this field — review the provenance before deciding."
          >
            Contested
          </span>
        )}
      </div>

      {currentValue != null && !editing && (
        <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm text-gray-300">
          {asDisplay(currentValue)}
        </pre>
      )}
      {currentValue == null && !pending && !editing && (
        <p className="mt-2 text-sm text-gray-500">Nothing on file for this field yet.</p>
      )}
      {approved && <SourceChips provenance={approved.provenance} />}

      {pending && (
        <div className="mt-3 rounded-lg border border-sky-900/60 bg-sky-950/30 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-sky-300">
            Proposed change ({String(pending.proposed_by || pending.proposedBy || "").replace(/_/g, " ")})
          </div>
          <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm text-gray-200">
            {asDisplay(pending.proposed_value ?? pending.proposedValue)}
          </pre>
          <SourceChips provenance={pending.provenance} />
          <ProvenanceDrawer provenance={pending.provenance} />
          <p className="mt-2 text-xs text-gray-400">
            Approving takes effect immediately: Echo starts using the new value everywhere. Rejecting
            keeps the proposal in history and changes nothing.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              disabled={busy}
              onClick={() => onDecide(pending, "approve")}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              disabled={busy}
              onClick={() => onDecide(pending, "reject")}
              className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-gray-600 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              disabled={busy}
              onClick={startEdit}
              className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-700 disabled:opacity-50"
            >
              Edit it myself
            </button>
          </div>
        </div>
      )}

      {!pending && !editing && (
        <div className="mt-2">
          <button
            disabled={busy}
            onClick={startEdit}
            className="text-xs font-semibold text-teal-400 hover:text-teal-300 disabled:opacity-50"
          >
            Edit
          </button>
        </div>
      )}

      {editing && (
        <div className="mt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-sm text-gray-200"
          />
          <p className="mt-1 text-xs text-gray-400">
            Your edit is authoritative and takes effect immediately.
            {pending ? " It also retires the pending proposal above (kept in history)." : ""}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              disabled={busy || !draft.trim()}
              onClick={async () => {
                const ok = await onOwnerSave(field.fieldKey, draft.trim());
                if (ok) setEditing(false);
              }}
              className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
            >
              Save
            </button>
            <button
              disabled={busy}
              onClick={() => setEditing(false)}
              className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <HistoryDrawer brandId={brandId} fieldKey={field.fieldKey} />
    </div>
  );
}

export default function ProfileReview({ brandId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (showSpinner = true) => {
      if (!brandId) return;
      if (showSpinner) setLoading(true);
      setError("");
      try {
        const res = await api.getBrandKnowledge(brandId);
        setData(res);
      } catch (err) {
        setError(err.message || "Could not load the business profile");
      } finally {
        setLoading(false);
      }
    },
    [brandId]
  );

  useEffect(() => {
    load(true);
  }, [load]);

  async function onDecide(pending, decision) {
    setBusy(true);
    setNotice("");
    setError("");
    const revisionId = pending.revision_id || pending.revisionId;
    try {
      if (decision === "approve") {
        await api.approveKnowledgeRevision(brandId, revisionId);
        setNotice("Approved — Echo is using the new value now.");
      } else {
        await api.rejectKnowledgeRevision(brandId, revisionId);
        setNotice("Rejected — kept in history; nothing changed.");
      }
    } catch (err) {
      setError(err.message || "Failed to record your decision");
    } finally {
      setBusy(false);
      await load(false);
    }
  }

  async function onOwnerSave(fieldKey, value) {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await api.ownerEditKnowledge(brandId, { [fieldKey]: value });
      setNotice("Saved — your edit is now the current value.");
      await load(false);
      return true;
    } catch (err) {
      setError(err.message || "Failed to save your edit");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!brandId) {
    return <p className="text-sm text-gray-400">Select a business to review its profile.</p>;
  }
  if (loading) {
    return <p className="text-sm text-gray-400">Loading business profile…</p>;
  }
  if (error && !data) {
    return (
      <div className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300">
        {error}
        <button onClick={() => load(true)} className="ml-2 font-semibold text-red-200 underline">
          Retry
        </button>
      </div>
    );
  }
  const fields = (data && data.fields) || [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-100">Business Profile</h2>
        <p className="mt-1 text-sm text-gray-400">
          Everything Echo believes about your business, with where it came from. Nothing here changes
          without your say-so.
        </p>
        {data && data.orderingNote && <p className="mt-1 text-xs text-gray-500">{data.orderingNote}</p>}
      </div>
      {notice && (
        <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-2 text-sm text-emerald-300">
          {notice}
        </div>
      )}
      {error && data && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/30 p-2 text-sm text-red-300">{error}</div>
      )}
      <div className="grid gap-3">
        {fields.map((f) => (
          <FieldCard
            key={f.fieldKey}
            brandId={brandId}
            field={f}
            onDecide={onDecide}
            onOwnerSave={onOwnerSave}
            busy={busy}
          />
        ))}
      </div>
    </div>
  );
}
