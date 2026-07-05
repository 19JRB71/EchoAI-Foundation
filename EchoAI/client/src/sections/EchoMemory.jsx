/**
 * Echo · Memory (Echo department → Memory). Owner-only.
 *
 * The full window into everything Echo remembers, across four views:
 *   Recall     — ask a natural-language question ("what happened with Sarah?").
 *   History    — searchable, deletable timeline of every remembered moment.
 *   People     — the living relationship profile Echo keeps for each key person.
 *   About You  — what Echo has learned about how the owner thinks/decides (editable).
 *
 * Echo builds most of this automatically from conversations and activity; this
 * screen lets the owner see, search, correct and delete any of it.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";

const TABS = [
  { key: "recall", label: "Recall" },
  { key: "history", label: "History" },
  { key: "people", label: "People" },
  { key: "about", label: "About You" },
];

const CATEGORY_LABELS = {
  conversation: "Conversation",
  preference: "Preference",
  goal: "Goal",
  concern: "Concern",
  decision: "Decision",
  personal_context: "Personal",
  relationship: "Relationship",
  event: "Activity",
  note: "Note",
};

const PERSON_TYPES = ["lead", "customer", "partner", "team_member", "other"];
const PERSON_TYPE_LABELS = {
  lead: "Lead",
  customer: "Customer",
  partner: "Partner",
  team_member: "Team member",
  other: "Contact",
};

function fmt(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function EchoMemory() {
  const [tab, setTab] = useState("recall");
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-1 text-xl font-semibold text-white">Echo's Memory</div>
      <p className="mb-5 text-sm text-gray-400">
        Everything Echo remembers about your business, your people and you — searchable,
        and yours to correct or clear at any time.
      </p>

      <div className="mb-5 flex gap-1 rounded-lg bg-gray-900/60 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
              tab === t.key ? "bg-teal-500 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "recall" && <RecallView />}
      {tab === "history" && <HistoryView />}
      {tab === "people" && <PeopleView />}
      {tab === "about" && <AboutYouView />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recall
// ---------------------------------------------------------------------------
function RecallView() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [facts, setFacts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleRecall() {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError("");
    setAnswer("");
    setFacts([]);
    try {
      const res = await api.recallEchoMemory(q);
      setAnswer(res.answer || "No answer.");
      setFacts(res.facts || []);
    } catch (e) {
      setError(e.message || "Couldn't recall that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-teal-500 focus:outline-none"
          placeholder="e.g. What did Sarah want? How is the summer campaign doing?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleRecall()}
          disabled={busy}
        />
        <button
          className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={handleRecall}
          disabled={busy || !query.trim()}
        >
          {busy ? "…" : "Recall"}
        </button>
      </div>
      {error && <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>}
      {answer && (
        <div className="mt-4 rounded-lg border border-teal-500/30 bg-teal-500/5 px-4 py-3 text-sm leading-relaxed text-gray-100">
          {answer}
        </div>
      )}
      {facts.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Based on</div>
          <div className="flex flex-col gap-1.5">
            {facts.map((f, i) => (
              <div key={i} className="rounded-md bg-gray-900/60 px-3 py-2 text-xs text-gray-400">
                {f}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History (search + delete)
// ---------------------------------------------------------------------------
function HistoryView() {
  const [q, setQ] = useState("");
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (term) => {
    setLoading(true);
    setError("");
    try {
      const res = term && term.trim() ? await api.searchEchoMemory(term.trim()) : await api.getEchoMemory();
      setEvents(res.events || []);
    } catch (e) {
      setError(e.message || "Couldn't load memory.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  async function handleDelete(id) {
    if (!window.confirm("Delete this memory? Echo will forget it permanently.")) return;
    try {
      await api.deleteEchoMemory(id);
      setEvents((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      setError(e.message || "Couldn't delete that memory.");
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-teal-500 focus:outline-none"
          placeholder="Search everything Echo remembers…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(q)}
        />
        <button
          className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white"
          onClick={() => load(q)}
        >
          Search
        </button>
        {q && (
          <button
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:text-white"
            onClick={() => {
              setQ("");
              load("");
            }}
          >
            Clear
          </button>
        )}
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>}

      {loading ? (
        <div className="mt-8 flex justify-center"><Spinner /></div>
      ) : events.length === 0 ? (
        <div className="mt-8 text-center text-sm text-gray-500">
          {q ? "Nothing matched your search." : "Nothing recorded yet. Echo logs key moments as you work together."}
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {events.map((ev) => (
            <div key={ev.id} className="group rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {ev.category && (
                      <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-teal-400">
                        {CATEGORY_LABELS[ev.category] || ev.category}
                      </span>
                    )}
                    <span className="truncate text-sm font-medium text-white">{ev.title}</span>
                  </div>
                  {ev.detail && <div className="mt-1 text-sm text-gray-400">{ev.detail}</div>}
                  <div className="mt-1 text-xs text-gray-600">{fmt(ev.occurredAt)}</div>
                </div>
                <button
                  className="shrink-0 rounded px-2 py-1 text-xs text-gray-500 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                  onClick={() => handleDelete(ev.id)}
                  title="Forget this memory"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// People (relationship profiles)
// ---------------------------------------------------------------------------
const BLANK_PROFILE = {
  personName: "",
  personType: "lead",
  caresAbout: "",
  history: "",
  nextStep: "",
  sentiment: "",
};

function PeopleView() {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // draft object or null

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.getEchoProfiles();
      setProfiles(res.profiles || []);
    } catch (e) {
      setError(e.message || "Couldn't load relationship profiles.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!editing || !editing.personName.trim()) return;
    try {
      await api.saveEchoProfile(editing);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e.message || "Couldn't save that profile.");
    }
  }

  async function remove(id) {
    if (!window.confirm("Delete this person's profile?")) return;
    try {
      await api.deleteEchoProfile(id);
      setProfiles((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setError(e.message || "Couldn't delete that profile.");
    }
  }

  if (loading) return <div className="mt-8 flex justify-center"><Spinner /></div>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-400">
          Echo keeps a living profile for each important person and updates it as things happen.
        </p>
        {!editing && (
          <button
            className="shrink-0 rounded-lg bg-teal-500 px-3 py-1.5 text-sm font-medium text-white"
            onClick={() => setEditing({ ...BLANK_PROFILE })}
          >
            + Add person
          </button>
        )}
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>}

      {editing && (
        <ProfileEditor
          draft={editing}
          onChange={setEditing}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}

      {profiles.length === 0 && !editing ? (
        <div className="mt-8 text-center text-sm text-gray-500">
          No relationship profiles yet. As you talk to Echo about people, it builds these automatically.
        </div>
      ) : (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {profiles.map((p) => (
            <div key={p.id} className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-semibold text-white">{p.personName}</div>
                  <div className="text-xs text-teal-400">{PERSON_TYPE_LABELS[p.personType] || p.personType}</div>
                </div>
                <div className="flex gap-2">
                  <button className="text-xs text-gray-500 hover:text-white" onClick={() => setEditing({
                    id: p.id,
                    personName: p.personName || "",
                    personType: p.personType || "other",
                    caresAbout: p.caresAbout || "",
                    history: p.history || "",
                    nextStep: p.nextStep || "",
                    sentiment: p.sentiment || "",
                  })}>Edit</button>
                  <button className="text-xs text-gray-500 hover:text-red-400" onClick={() => remove(p.id)}>Delete</button>
                </div>
              </div>
              {p.caresAbout && <Field label="Cares about" value={p.caresAbout} />}
              {p.nextStep && <Field label="Next step" value={p.nextStep} />}
              {p.history && <Field label="History" value={p.history} />}
              {p.sentiment && <Field label="Sentiment" value={p.sentiment} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="mt-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">{label}</div>
      <div className="whitespace-pre-line text-sm text-gray-300">{value}</div>
    </div>
  );
}

function ProfileEditor({ draft, onChange, onSave, onCancel }) {
  const set = (patch) => onChange({ ...draft, ...patch });
  return (
    <div className="mb-4 rounded-lg border border-teal-500/30 bg-gray-900/60 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-400">Name</span>
          <input
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-teal-500 focus:outline-none"
            value={draft.personName}
            onChange={(e) => set({ personName: e.target.value })}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-400">Relationship</span>
          <select
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-teal-500 focus:outline-none"
            value={draft.personType}
            onChange={(e) => set({ personType: e.target.value })}
          >
            {PERSON_TYPES.map((t) => (
              <option key={t} value={t}>{PERSON_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </label>
      </div>
      <EditorText label="What they care about" value={draft.caresAbout} onChange={(v) => set({ caresAbout: v })} />
      <EditorText label="Right next step" value={draft.nextStep} onChange={(v) => set({ nextStep: v })} />
      <EditorText label="History / notes" value={draft.history} onChange={(v) => set({ history: v })} rows={3} />
      <EditorText label="Sentiment (e.g. positive, at_risk)" value={draft.sentiment} onChange={(v) => set({ sentiment: v })} />
      <div className="mt-3 flex gap-2">
        <button
          className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={onSave}
          disabled={!draft.personName.trim()}
        >
          Save
        </button>
        <button className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function EditorText({ label, value, onChange, rows = 2 }) {
  return (
    <label className="mt-3 block text-sm">
      <span className="mb-1 block text-xs text-gray-400">{label}</span>
      <textarea
        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-teal-500 focus:outline-none"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// About You (owner profile)
// ---------------------------------------------------------------------------
const OWNER_FIELDS = [
  { key: "goals", label: "Goals", hint: "What you're working toward." },
  { key: "values", label: "Values", hint: "What matters most in how you run the business." },
  { key: "riskTolerance", label: "Risk tolerance", hint: "How bold or cautious you like to be." },
  { key: "preferences", label: "Preferences", hint: "How you like things done." },
  { key: "decisionPatterns", label: "Decision patterns", hint: "How you tend to make calls." },
  { key: "communicationStyle", label: "Communication style", hint: "How you like Echo to talk to you." },
  { key: "blindSpots", label: "Blind spots", hint: "Things to keep an eye on for you." },
];

function AboutYouView() {
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await api.getEchoOwnerProfile();
        setDraft(res.profile || {});
      } catch (e) {
        setError(e.message || "Couldn't load your profile.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await api.saveEchoOwnerProfile(draft);
      setDraft(res.profile || draft);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e.message || "Couldn't save your profile.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="mt-8 flex justify-center"><Spinner /></div>;

  return (
    <div>
      <p className="mb-4 text-sm text-gray-400">
        What Echo has learned about how you think and decide. Echo uses this to make better
        recommendations and to flag anything that conflicts with your values. Edit anything that's off.
      </p>
      {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>}
      <div className="flex flex-col gap-4">
        {OWNER_FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-sm font-medium text-white">{f.label}</span>
            <span className="mb-1.5 block text-xs text-gray-500">{f.hint}</span>
            <textarea
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-teal-500 focus:outline-none"
              rows={2}
              value={(draft && draft[f.key]) || ""}
              onChange={(e) => setDraft((prev) => ({ ...prev, [f.key]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          className="rounded-lg bg-teal-500 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {savedAt > 0 && !saving && <span className="text-sm text-teal-400">Saved.</span>}
      </div>
    </div>
  );
}
