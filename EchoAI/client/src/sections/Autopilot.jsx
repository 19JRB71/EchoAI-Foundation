import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";
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

function Badge({ children, className }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${className}`}
    >
      {children}
    </span>
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
  const [busyItemId, setBusyItemId] = useState("");
  const [reviseFor, setReviseFor] = useState(""); // itemId with the revise box open
  const [reviseText, setReviseText] = useState("");
  const [form, setForm] = useState({
    postsPerWeek: 5,
    adsPerWeek: 1,
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
          postsPerWeek: s.postsPerWeek,
          adsPerWeek: s.adsPerWeek,
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
        postsPerWeek: Number(form.postsPerWeek),
        adsPerWeek: Number(form.adsPerWeek),
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
    } catch (err) {
      setError(err.message || "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    if (!brandId) return;
    setRunning(true);
    setError("");
    setNotice("");
    try {
      const b = await api.autopilotRunNow(brandId, !settings?.enabled);
      setBatch(b);
      setNotice("This week's batch is drafted and ready for your review.");
    } catch (err) {
      setError(err.message || "Failed to draft this week's batch.");
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

  async function act(item, fn, failMsg) {
    setBusyItemId(item.itemId);
    setError("");
    setNotice("");
    try {
      const updated = await fn();
      patchItem(updated);
    } catch (err) {
      setError(err.message || failMsg);
    } finally {
      setBusyItemId("");
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
          Every Monday, Echo drafts your week — social posts with graphics plus small
          test ads — and holds everything for your approval. Nothing is published and
          not a dollar is spent without your OK.
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
              onClick={() => saveSettings({ enabled: !settings.enabled })}
              disabled={saving}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                settings.enabled
                  ? "bg-gray-700 text-gray-200 hover:bg-gray-600"
                  : "bg-teal-600 text-white hover:bg-teal-500"
              }`}
            >
              {saving ? "Saving…" : settings.enabled ? "Turn off" : "Turn on autopilot"}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm text-gray-300">
              Posts per week
              <input
                type="number"
                min="0"
                max="21"
                value={form.postsPerWeek}
                onChange={(e) => setForm((f) => ({ ...f, postsPerWeek: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
              />
            </label>
            <label className="text-sm text-gray-300">
              Test ads per week
              <input
                type="number"
                min="0"
                max="7"
                value={form.adsPerWeek}
                onChange={(e) => setForm((f) => ({ ...f, adsPerWeek: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
              />
            </label>
          </div>

          <div>
            <div className="text-sm font-semibold text-white">Hard spending limits</div>
            <div className="text-xs text-gray-500">
              Ad approvals are blocked the moment a limit would be crossed. Leave blank
              for no limit.
            </div>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                ["daily", "Daily limit ($)"],
                ["weekly", "Weekly limit ($)"],
                ["monthly", "Monthly limit ($)"],
              ].map(([key, label]) => (
                <label key={key} className="text-sm text-gray-300">
                  {label}
                  <input
                    type="number"
                    min="0"
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    placeholder="No limit"
                    className="mt-1 w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                  />
                </label>
              ))}
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
            <button
              onClick={runNow}
              disabled={running || (readiness && !readiness.ready)}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
              title={
                readiness && !readiness.ready
                  ? "Connect the accounts above first"
                  : "Draft this week's batch now"
              }
            >
              {running ? "Drafting your week…" : "Draft this week's batch now"}
            </button>
          </div>
        </div>
      )}

      {/* Current batch */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
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
                className="rounded-xl border border-gray-700 bg-gray-800/60 p-4 border-l-4"
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
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt="Post graphic"
                    className="mt-3 max-h-64 rounded-lg border border-gray-700 object-cover"
                  />
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
                  </div>
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
