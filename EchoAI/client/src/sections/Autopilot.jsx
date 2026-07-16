import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";
import MediaUploader from "../components/MediaUploader.jsx";
import { agentMeta } from "../lib/departments.js";

// Who made what: Nova drafts the social posts, Atlas drafts the test ads.
// Every card is stamped with its team member so the two are unmistakable.
const ITEM_AGENT = {
  post: { agentId: "nova", label: "Social post" },
  ad: { agentId: "atlas", label: "Ad" },
};

const STATUS_STYLES = {
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  declined: "bg-gray-600/20 text-gray-400 border-gray-600/40",
};
const STATUS_LABELS = {
  pending: "Needs your OK",
  approved: "Approved",
  declined: "Declined",
};

// Hybrid Creative Engine: how each graphic is built. Mirrors the backend's
// creative modes (utils/creativeModes.js).
const CREATIVE_MODE_META = {
  asset: {
    label: "Your photo, enhanced",
    className: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  },
  assisted: {
    label: "Your photo + AI",
    className: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  },
  ai: {
    label: "AI original",
    className: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  },
};

const CONTENT_PREFERENCE_OPTIONS = [
  { value: "only_my_media", label: "Only use my uploaded media" },
  { value: "prefer_my_media", label: "Use my media whenever possible" },
  {
    value: "balanced_auto",
    label: "Let Echo decide automatically",
    recommended: true,
  },
  { value: "mostly_ai", label: "Generate mostly AI content" },
  { value: "ai_only", label: "Generate only AI content" },
];

const EDIT_PERMISSION_OPTIONS = [
  { key: "lighting", label: "Improve lighting" },
  { key: "colors", label: "Improve colors" },
  { key: "quality", label: "Enhance image quality" },
  { key: "remove_distractions", label: "Remove distractions" },
  { key: "replace_background", label: "Replace backgrounds / sky" },
  { key: "seasonal", label: "Seasonal changes" },
  { key: "day_night", label: "Day / night conversion" },
  { key: "landscaping", label: "Add landscaping" },
  { key: "branding", label: "Add branding" },
  { key: "layouts", label: "Create marketing layouts" },
];

function Badge({ children, className }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${className}`}
    >
      {children}
    </span>
  );
}

// Renders the post graphic; if the image file is missing on the server (e.g.
// it was lost in a redeploy), shows an honest note instead of a broken icon.
function PostGraphic({ src }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (broken) {
    return (
      <div className="mt-3 rounded-lg border border-amber-700/50 bg-amber-900/20 p-3 text-xs text-amber-300">
        The graphic file for this post is missing from the server (this can
        happen after a redeploy). Use &ldquo;Redo the graphic&rdquo; to create a
        fresh one before approving.
      </div>
    );
  }
  return (
    <img
      src={src}
      alt="Post graphic"
      onError={() => setBroken(true)}
      className="mt-3 max-h-64 rounded-lg border border-gray-700 object-cover"
    />
  );
}

function fmtWhen(d) {
  if (!d) return "";
  try {
    const at = new Date(d);
    if (Number.isNaN(at.getTime())) return "";
    return at.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function capInput(v) {
  // "" → null (no limit); otherwise a positive dollar number as entered.
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s;
}

export default function Autopilot({ brandId }) {
  const [settings, setSettings] = useState(null);
  const [batch, setBatch] = useState(null);
  const [loading, setLoading] = useState(false);
  const [firstLoaded, setFirstLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [draftWeeks, setDraftWeeks] = useState(1); // date range: 1-4 weeks per draft
  const [busyItemId, setBusyItemId] = useState("");
  const [creatingInstant, setCreatingInstant] = useState(false);
  const [instantTopic, setInstantTopic] = useState("");
  const [highlightItemId, setHighlightItemId] = useState("");
  const [reviseFor, setReviseFor] = useState(""); // itemId with the revise box open
  const [reviseText, setReviseText] = useState("");
  const [form, setForm] = useState({
    includePosts: true,
    postsPerWeek: 5,
    daily: "",
    weekly: "",
    monthly: "",
  });
  const formSeeded = useRef(false);
  const [learnings, setLearnings] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [answerFor, setAnswerFor] = useState(""); // questionId with the answer box open
  const [answerText, setAnswerText] = useState("");
  const [busyLearning, setBusyLearning] = useState("");

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const [s, b, l, q] = await Promise.all([
        api.autopilotGetSettings(brandId),
        api.autopilotGetBatch(brandId),
        api.autopilotLearnings(brandId).catch(() => ({ learnings: [] })),
        api.autopilotQuestions(brandId).catch(() => ({ questions: [] })),
      ]);
      setSettings(s);
      setBatch(b.batch || null);
      setLearnings(l.learnings || []);
      setQuestions(q.questions || []);
      if (!formSeeded.current) {
        formSeeded.current = true;
        setForm({
          includePosts: s.postsPerWeek > 0,
          postsPerWeek: s.postsPerWeek > 0 ? s.postsPerWeek : 5,
          daily: s.dailySpendCap != null ? String(s.dailySpendCap) : "",
          weekly: s.weeklySpendCap != null ? String(s.weeklySpendCap) : "",
          monthly: s.monthlySpendCap != null ? String(s.monthlySpendCap) : "",
        });
      }
    } catch (err) {
      setError(err.message || "Failed to load autopilot.");
    } finally {
      setLoading(false);
      setFirstLoaded(true);
    }
  }, [brandId]);

  useEffect(() => {
    formSeeded.current = false;
    load();
  }, [load]);

  async function saveSettings(extra = {}) {
    if (!brandId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const s = await api.autopilotSaveSettings({
        brandId,
        postsPerWeek: form.includePosts ? Math.max(1, Number(form.postsPerWeek) || 0) : 0,
        // Autopilot is Nova's content desk — posts only. Ads live with Atlas.
        adsPerWeek: 0,
        dailySpendCap: capInput(form.daily),
        weeklySpendCap: capInput(form.weekly),
        monthlySpendCap: capInput(form.monthly),
        ...extra,
      });
      setSettings(s);
      setNotice(
        s.enabled
          ? "Autopilot is ON. Echo drafts your week every Monday — nothing goes out until you approve it."
          : "Settings saved."
      );
      return s;
    } catch (err) {
      setError(err.message || "Failed to save settings.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  // Checkbox toggles save immediately — leaving the page and coming back must
  // never silently re-check a box the owner unchecked. If both end up off
  // while autopilot is on, autopilot turns off too (nothing left to draft).
  function toggleInclude(key, checked) {
    const next = { ...form, [key]: checked };
    setForm(next);
    const postsPerWeek = next.includePosts ? Math.max(1, Number(next.postsPerWeek) || 0) : 0;
    const extra = { postsPerWeek, adsPerWeek: 0 };
    if (settings?.enabled && postsPerWeek === 0) extra.enabled = false;
    saveSettings(extra);
  }

  // Turning autopilot ON mid-week drafts the first batch right away — no
  // waiting until next Monday. Skipped when a batch is already generating or
  // still has items awaiting review.
  async function enableAndMaybeDraft() {
    const s = await saveSettings({ enabled: true });
    if (!s || !s.enabled) return;
    const hasPending =
      batch &&
      (batch.status === "generating" ||
        (batch.items || []).some((i) => i.status === "pending"));
    if (!hasPending) await runNow();
  }

  async function runNow() {
    if (!brandId) return;
    setRunning(true);
    setError("");
    setNotice("");
    try {
      const b = await api.autopilotRunNow(brandId, !settings?.enabled, draftWeeks);
      setBatch(b);
      if (b && b.status === "failed") {
        setError(
          `Drafting failed${b.error ? `: ${b.error}` : ""}. Hit "Draft this week's batch now" to retry.`
        );
      } else {
        setNotice(
          draftWeeks > 1
            ? `Your ${draftWeeks}-week batch is drafted and ready for your review — approved posts start going out as soon as today.`
            : "Your batch is drafted and ready for your review — approved posts start going out as soon as today."
        );
      }
    } catch (err) {
      setError(err.message || "Failed to draft the batch.");
    } finally {
      setRunning(false);
    }
  }

  function patchItem(updated) {
    setBatch((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((i) =>
              i.itemId === updated.itemId ? { ...i, ...updated } : i
            ),
          }
        : prev
    );
  }

  async function deleteItem(item) {
    setBusyItemId(item.itemId);
    setError("");
    setNotice("");
    try {
      await api.autopilotDeleteItem(item.itemId);
      setBatch((prev) =>
        prev ? { ...prev, items: prev.items.filter((i) => i.itemId !== item.itemId) } : prev
      );
      setNotice("Deleted — the draft is gone from this week's batch.");
    } catch (err) {
      setError(err.message || "Failed to delete this draft.");
    } finally {
      setBusyItemId("");
    }
  }

  async function act(item, fn, failMsg) {
    setBusyItemId(item.itemId);
    setError("");
    setNotice("");
    try {
      const updated = await fn();
      // Approved items leave the batch list immediately (owner's rule) —
      // once a post has a linked calendar entry it lives in the Social
      // Media calendar, not here.
      if (updated.postedPostId) {
        setBatch((prev) =>
          prev
            ? { ...prev, items: prev.items.filter((i) => i.itemId !== updated.itemId) }
            : prev
        );
        if (updated.error) {
          setError(updated.error);
        } else if (updated.postedNow) {
          setNotice("Posted — it's live on the platform now. You'll find it in your Social Media calendar.");
        } else if (updated.publishing) {
          setNotice("Approved — the post is publishing right now. You'll find it in your Social Media calendar.");
        } else {
          setNotice("Approved — it's scheduled and now lives in your Social Media calendar.");
        }
        return;
      }
      patchItem(updated);
      // Declining a post drafts a fresh replacement for the same time slot.
      if (updated.replacement) {
        setBatch((prev) =>
          prev ? { ...prev, items: [...prev.items, updated.replacement] } : prev
        );
        setNotice(
          "Declined — Echo drafted a fresh post for the same time slot. It's at the bottom of the list, waiting for your OK."
        );
      } else if (updated.replacementError) {
        setNotice(updated.replacementError);
      } else if (updated.postedNow) {
        setNotice("Posted — it's live on the platform now.");
      } else if (updated.publishing) {
        setNotice("Approved — the post is publishing right now.");
      }
    } catch (err) {
      setError(err.message || failMsg);
    } finally {
      setBusyItemId("");
    }
  }

  async function createInstantPost() {
    setCreatingInstant(true);
    setError("");
    setNotice("");
    try {
      const result = await api.autopilotCreateInstantPost(
        brandId,
        instantTopic.trim() || undefined
      );
      setInstantTopic("");
      if (result.item) {
        setBatch((prev) =>
          prev
            ? { ...prev, items: [...(prev.items || []), result.item] }
            : { status: "ready", items: [result.item] }
        );
        // The new post lands at the END of the batch list — scroll it into
        // view and glow it briefly so it's impossible to miss.
        setHighlightItemId(result.item.itemId);
        setTimeout(() => {
          const el = document.getElementById(`autopilot-item-${result.item.itemId}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
        setTimeout(() => setHighlightItemId(""), 6000);
      }
      setNotice(
        result.notice ||
          "Instant post drafted — review it below, then hit Post instantly to publish."
      );
    } catch (err) {
      setError(err.message || "Echo couldn't draft an instant post right now.");
    } finally {
      setCreatingInstant(false);
    }
  }

  const readiness = settings?.readiness;
  const pendingCount = (batch?.items || []).filter((i) => i.status === "pending").length;

  if (!firstLoaded && loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Autopilot Mode</h2>
        <p className="mt-1 text-sm text-gray-400">
          Every Monday, Echo drafts your week of social posts with graphics and holds
          everything for your approval. Nothing is published without your OK.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}
      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {/* Readiness — connect everything first */}
      {readiness && !readiness.ready && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="text-sm font-semibold text-amber-300">
            Before autopilot can take over, a couple of connections are needed:
          </div>
          <ul className="mt-2 space-y-1 text-sm text-gray-300">
            {readiness.missing.map((m) => (
              <li key={m.key}>• {m.label}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">
            You can also say “Hey Echo, set up autopilot” and Echo will walk you
            through it by voice.
          </p>
        </div>
      )}

      {/* Settings */}
      {settings && (
        <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">
                Autopilot is {settings.enabled ? "ON" : "OFF"}
              </div>
              <div className="text-xs text-gray-500">
                {settings.enabled
                  ? "Echo drafts your week every Monday morning."
                  : "Turn it on and Echo handles the drafting — you just approve."}
              </div>
            </div>
            <button
              onClick={() =>
                settings.enabled ? saveSettings({ enabled: false }) : enableAndMaybeDraft()
              }
              disabled={saving || (!settings.enabled && !form.includePosts)}
              title={
                !settings.enabled && !form.includePosts
                  ? "Turn social posts on first"
                  : undefined
              }
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                settings.enabled
                  ? "bg-gray-700 text-gray-200 hover:bg-gray-600"
                  : "bg-teal-600 text-white hover:bg-teal-500"
              }`}
            >
              {saving ? "Saving…" : settings.enabled ? "Turn off" : "Turn on autopilot"}
            </button>
          </div>

          <div>
            <div className="text-sm font-semibold text-white">What should Echo draft each week?</div>
            <div className="text-xs text-gray-500">
              Autopilot is Nova's content desk — social posts and graphics only. Ads
              are Atlas's job, over in Ad Campaigns.
            </div>
            {!form.includePosts && (
              <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                Turn social posts on — with it off there's nothing for Echo to draft.
              </div>
            )}
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div
                className={`rounded-lg border p-3 ${
                  form.includePosts ? "border-pink-500/40 bg-pink-500/5" : "border-gray-700 bg-gray-900/40"
                }`}
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-white">
                  <input
                    type="checkbox"
                    checked={form.includePosts}
                    onChange={(e) => toggleInclude("includePosts", e.target.checked)}
                    className="h-4 w-4 accent-pink-500"
                  />
                  Social posts <span className="font-normal text-pink-300">(Nova)</span>
                </label>
                <label className={`mt-2 block text-sm ${form.includePosts ? "text-gray-300" : "text-gray-600"}`}>
                  Posts per week (7 = 1 a day, 21 = 3 a day)
                  <input
                    type="number"
                    min="1"
                    max="21"
                    value={form.postsPerWeek}
                    disabled={!form.includePosts}
                    onChange={(e) => setForm((f) => ({ ...f, postsPerWeek: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white disabled:opacity-40"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Hybrid Creative Engine: how Forge builds the graphics */}
          <div>
            <div className="text-sm font-semibold text-white">Creative style</div>
            <div className="text-xs text-gray-500">
              How should Forge build your graphics? Real photos come from your
              Vision reference library; AI originals never pretend to show your
              actual work.
            </div>
            <div className="mt-2 space-y-1.5">
              {CONTENT_PREFERENCE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    settings.contentPreference === opt.value
                      ? "border-teal-500/40 bg-teal-500/5 text-white"
                      : "border-gray-700 bg-gray-900/40 text-gray-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="contentPreference"
                    checked={settings.contentPreference === opt.value}
                    onChange={() => saveSettings({ contentPreference: opt.value })}
                    disabled={saving}
                    className="h-4 w-4 accent-teal-500"
                  />
                  {opt.label}
                  {opt.recommended && (
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-teal-400">
                      Recommended
                    </span>
                  )}
                </label>
              ))}
            </div>
            <div className="mt-3 text-sm font-semibold text-white">
              What may AI do to your photos?
            </div>
            <div className="text-xs text-gray-500">
              Applies whenever a graphic starts from one of your real photos.
              Your actual work always stays the centerpiece.
            </div>
            <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {EDIT_PERMISSION_OPTIONS.map((opt) => {
                const perms = settings.editingPermissions || {};
                const checked = perms[opt.key] !== false;
                return (
                  <label
                    key={opt.key}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-700 bg-gray-900/40 px-3 py-1.5 text-sm text-gray-300"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={saving}
                      onChange={(e) =>
                        saveSettings({
                          editingPermissions: {
                            ...perms,
                            [opt.key]: e.target.checked,
                          },
                        })
                      }
                      className="h-4 w-4 accent-teal-500"
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold text-white">Instant post</div>
            <div className="text-xs text-gray-500">
              Need something out right now? Echo drafts one extra post on the spot —
              it never touches this week's scheduled posts. Review it in the batch
              below, then hit Post instantly.
            </div>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={instantTopic}
                onChange={(e) => setInstantTopic(e.target.value)}
                placeholder="Topic (optional) — e.g. holiday hours, new arrival, quick tip"
                className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white sm:flex-1"
              />
              <button
                onClick={createInstantPost}
                disabled={creatingInstant}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                title="Draft an extra post to publish right now — doesn't touch this week's scheduled posts"
              >
                {creatingInstant ? "Drafting…" : "Create instant post"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => saveSettings()}
              disabled={saving}
              className="rounded-lg bg-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-600 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
            <div className="flex items-center gap-2">
              <label htmlFor="autopilot-draft-weeks" className="text-xs text-gray-400">
                Range
              </label>
              <select
                id="autopilot-draft-weeks"
                data-testid="autopilot-draft-weeks"
                value={draftWeeks}
                onChange={(e) => setDraftWeeks(Number(e.target.value))}
                disabled={running}
                className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-2 text-sm text-gray-200"
              >
                <option value={1}>1 week</option>
                <option value={2}>2 weeks</option>
                <option value={3}>3 weeks</option>
                <option value={4}>4 weeks</option>
              </select>
              <button
                onClick={runNow}
                disabled={running || (readiness && !readiness.ready)}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
                title={
                  readiness && !readiness.ready
                    ? "Connect the accounts above first"
                    : draftWeeks > 1
                      ? `Draft the next ${draftWeeks} weeks now`
                      : "Draft this week's batch now"
                }
              >
                {running
                  ? draftWeeks > 1
                    ? `Drafting ${draftWeeks} weeks…`
                    : "Drafting your week…"
                  : draftWeeks > 1
                    ? `Draft the next ${draftWeeks} weeks now`
                    : "Draft this week's batch now"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Current batch */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-white">This week's batch</h3>
          {batch && pendingCount > 0 && (
            <Badge className={STATUS_STYLES.pending}>
              {pendingCount} awaiting approval
            </Badge>
          )}
        </div>

        {!batch && (
          <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-6 text-sm text-gray-400">
            No batch yet. Turn autopilot on (or hit “Draft this week's batch now”) and
            Echo will put your week together. You can also review by voice: “Hey Echo,
            let's review the batch.”
          </div>
        )}

        {batch && batch.status === "failed" && (
          <ErrorBanner
            message={`This week's drafting failed${batch.error ? `: ${batch.error}` : ""}. Hit “Draft this week's batch now” to retry.`}
          />
        )}
        {batch && batch.status === "generating" && (
          <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-6 text-sm text-gray-400">
            Echo is drafting this week's batch right now — check back in a minute.
          </div>
        )}

        {batch &&
          (batch.items || []).map((item) => {
            const busy = busyItemId === item.itemId;
            const isPending = item.status === "pending";
            const kind = ITEM_AGENT[item.itemType] || ITEM_AGENT.post;
            const agent = agentMeta(kind.agentId);
            const agentColor = (agent && agent.color) || "#8B5CF6";
            const agentName = (agent && agent.name) || "";
            return (
              <div
                key={item.itemId}
                id={`autopilot-item-${item.itemId}`}
                className={`rounded-xl border bg-gray-800/60 p-4 border-l-4 transition-all duration-700 ${
                  highlightItemId === item.itemId
                    ? "border-emerald-400 ring-2 ring-emerald-400/60"
                    : "border-gray-700"
                }`}
                style={{ borderLeftColor: agentColor }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                    style={{
                      color: agentColor,
                      borderColor: `${agentColor}66`,
                      backgroundColor: `${agentColor}1f`,
                    }}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: agentColor }}
                    />
                    {agentName} · {kind.label}
                  </span>
                  {item.platform && (
                    <span className="text-xs uppercase tracking-wide text-gray-400">
                      {item.platform}
                    </span>
                  )}
                  <Badge className={STATUS_STYLES[item.status] || STATUS_STYLES.declined}>
                    {STATUS_LABELS[item.status] || item.status}
                  </Badge>
                  {item.creativeMode && CREATIVE_MODE_META[item.creativeMode] && (
                    <Badge className={CREATIVE_MODE_META[item.creativeMode].className}>
                      {CREATIVE_MODE_META[item.creativeMode].label}
                    </Badge>
                  )}
                  {item.itemType === "post" && item.scheduledTime && (
                    <span className="text-xs text-gray-500">
                      {item.status === "approved" ? "Scheduled" : "Planned"} for{" "}
                      {fmtWhen(item.scheduledTime)}
                    </span>
                  )}
                  {item.itemType === "ad" && item.adDailyBudget != null && (
                    <span className="text-xs text-gray-500">
                      ${item.adDailyBudget}/day{item.campaignId ? " — launched (paused for your final go-live in Ads Manager)" : ""}
                    </span>
                  )}
                </div>

                {item.adHeadline && (
                  <div className="mt-2 text-sm font-semibold text-white">
                    {item.adHeadline}
                  </div>
                )}
                <p className="mt-2 whitespace-pre-wrap text-sm text-gray-200">
                  {item.postContent}
                </p>
                {item.videoUrl ? (
                  <video
                    src={item.videoUrl}
                    controls
                    playsInline
                    className="mt-3 max-h-64 rounded-lg border border-gray-700"
                  />
                ) : item.imageUrl ? (
                  <PostGraphic src={item.imageUrl} />
                ) : (
                  item.visualIdea && (
                    <div className="mt-2 text-xs text-gray-500">
                      Visual idea: {item.visualIdea}
                    </div>
                  )
                )}
                {item.rationale && (
                  <div className="mt-2 text-xs text-gray-500">Why: {item.rationale}</div>
                )}

                {isPending && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      disabled={busy}
                      onClick={() =>
                        act(
                          item,
                          () => api.autopilotApproveItem(item.itemId),
                          "Failed to approve this item."
                        )
                      }
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {busy ? "Working…" : item.itemType === "ad" ? "Approve & launch" : "Approve & schedule"}
                    </button>
                    {item.itemType === "post" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          act(
                            item,
                            () => api.autopilotPostItemNow(item.itemId),
                            "Failed to post this item."
                          )
                        }
                        className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                      >
                        {busy ? "Working…" : "Post instantly"}
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() => {
                        setReviseFor(reviseFor === item.itemId ? "" : item.itemId);
                        setReviseText("");
                      }}
                      className="rounded-lg bg-gray-700 px-3 py-1.5 text-sm font-semibold text-gray-200 hover:bg-gray-600 disabled:opacity-50"
                    >
                      Request a change
                    </button>
                    {item.itemType === "post" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          act(
                            item,
                            () => api.autopilotItemImage(item.itemId),
                            "Failed to create the visual."
                          )
                        }
                        className="rounded-lg bg-gray-700 px-3 py-1.5 text-sm font-semibold text-gray-200 hover:bg-gray-600 disabled:opacity-50"
                      >
                        {item.imageUrl ? "Redo the graphic" : "Create the graphic"}
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() =>
                        act(
                          item,
                          () => api.autopilotDeclineItem(item.itemId),
                          "Failed to decline this item."
                        )
                      }
                      className="rounded-lg bg-gray-700 px-3 py-1.5 text-sm font-semibold text-rose-300 hover:bg-gray-600 disabled:opacity-50"
                    >
                      Decline
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => deleteItem(item)}
                      className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-sm font-semibold text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                )}

                {item.status === "declined" && (
                  <div className="mt-3">
                    <button
                      disabled={busy}
                      onClick={() => deleteItem(item)}
                      className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-sm font-semibold text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
                    >
                      {busy ? "Working…" : "Delete"}
                    </button>
                  </div>
                )}

                {isPending && item.itemType === "post" && (
                  <MediaUploader
                    platform={item.platform}
                    uploadedMedia={
                      item.videoUrl
                        ? { url: item.videoUrl, mediaType: "video" }
                        : item.imageUrl && item.imageUrl.startsWith("/uploads/media/")
                          ? { url: item.imageUrl, mediaType: "image" }
                          : null
                    }
                    onUploaded={(media) =>
                      act(
                        item,
                        () =>
                          api.autopilotItemMedia(
                            item.itemId,
                            media.mediaType === "video"
                              ? { videoUrl: media.url }
                              : { imageUrl: media.url }
                          ),
                        "Failed to attach your media."
                      )
                    }
                    onCleared={() =>
                      act(
                        item,
                        () => api.autopilotItemMedia(item.itemId, {}),
                        "Failed to remove the media."
                      )
                    }
                  />
                )}

                {isPending && reviseFor === item.itemId && (
                  <div className="mt-3 flex gap-2">
                    <input
                      value={reviseText}
                      onChange={(e) => setReviseText(e.target.value)}
                      placeholder="Tell Echo what to change…"
                      className="flex-1 rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white"
                    />
                    <button
                      disabled={busy || !reviseText.trim()}
                      onClick={async () => {
                        const instruction = reviseText.trim();
                        setReviseFor("");
                        setReviseText("");
                        await act(
                          item,
                          () => api.autopilotReviseItem(item.itemId, instruction),
                          "Failed to make that change."
                        );
                      }}
                      className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
                    >
                      Apply
                    </button>
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {/* Learning Engine: Echo's open questions + what it has learned */}
      {questions.length > 0 && (
        <div className="rounded-xl border border-teal-500/30 bg-teal-500/5 p-4 space-y-3">
          <div>
            <div className="text-sm font-semibold text-teal-300">
              Echo has a question for you
            </div>
            <div className="text-xs text-gray-500">
              When your yes-and-no calls don't make a pattern clear, Echo asks instead
              of guessing. Answers permanently shape future drafts.
            </div>
          </div>
          {questions.map((q) => (
            <div
              key={q.question_id}
              className="rounded-lg border border-gray-700 bg-gray-900/60 p-3"
            >
              <div className="text-sm text-white">{q.question}</div>
              {q.context && (
                <div className="mt-1 text-xs text-gray-500">{q.context}</div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  disabled={busyLearning === q.question_id}
                  onClick={() => {
                    setAnswerFor(answerFor === q.question_id ? "" : q.question_id);
                    setAnswerText("");
                  }}
                  className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
                >
                  Answer
                </button>
                <button
                  disabled={busyLearning === q.question_id}
                  onClick={async () => {
                    setBusyLearning(q.question_id);
                    setError("");
                    try {
                      await api.autopilotDismissQuestion(q.question_id);
                      setQuestions((prev) =>
                        prev.filter((x) => x.question_id !== q.question_id)
                      );
                    } catch (err) {
                      setError(err.message || "Failed to dismiss the question.");
                    } finally {
                      setBusyLearning("");
                    }
                  }}
                  className="rounded-lg bg-gray-700 px-3 py-1.5 text-sm font-semibold text-gray-300 hover:bg-gray-600 disabled:opacity-50"
                >
                  Skip this
                </button>
              </div>
              {answerFor === q.question_id && (
                <div className="mt-2 flex gap-2">
                  <input
                    value={answerText}
                    onChange={(e) => setAnswerText(e.target.value)}
                    placeholder="Tell Echo your preference…"
                    className="flex-1 rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white"
                  />
                  <button
                    disabled={busyLearning === q.question_id || !answerText.trim()}
                    onClick={async () => {
                      const answer = answerText.trim();
                      setBusyLearning(q.question_id);
                      setError("");
                      try {
                        await api.autopilotAnswerQuestion(q.question_id, answer);
                        setAnswerFor("");
                        setAnswerText("");
                        setQuestions((prev) =>
                          prev.filter((x) => x.question_id !== q.question_id)
                        );
                        const l = await api
                          .autopilotLearnings(brandId)
                          .catch(() => null);
                        if (l) setLearnings(l.learnings || []);
                        setNotice("Got it — Echo will draft with that in mind from now on.");
                      } catch (err) {
                        setError(err.message || "Failed to save your answer.");
                      } finally {
                        setBusyLearning("");
                      }
                    }}
                    className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {learnings.length > 0 && (
        <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4 space-y-3">
          <div>
            <div className="text-sm font-semibold text-white">What Echo has learned</div>
            <div className="text-xs text-gray-500">
              Built from your approvals, declines, and change requests. Every future
              draft follows these. Wrong about one? Tell Echo to forget it.
            </div>
          </div>
          <ul className="space-y-2">
            {learnings.map((l) => (
              <li
                key={l.learning_id}
                className="flex items-start justify-between gap-3 rounded-lg border border-gray-700 bg-gray-900/60 p-3"
              >
                <div>
                  <div className="text-sm text-gray-200">{l.insight}</div>
                  <div className="mt-0.5 text-[11px] text-gray-500">
                    {l.category === "owner_answer"
                      ? "You told Echo this directly"
                      : `Seen ${l.evidence_count} time${l.evidence_count === 1 ? "" : "s"} in your decisions`}
                  </div>
                </div>
                <button
                  disabled={busyLearning === l.learning_id}
                  onClick={async () => {
                    setBusyLearning(l.learning_id);
                    setError("");
                    try {
                      await api.autopilotForgetLearning(l.learning_id);
                      setLearnings((prev) =>
                        prev.filter((x) => x.learning_id !== l.learning_id)
                      );
                    } catch (err) {
                      setError(err.message || "Failed to forget that.");
                    } finally {
                      setBusyLearning("");
                    }
                  }}
                  className="shrink-0 rounded-lg bg-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-600 disabled:opacity-50"
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
