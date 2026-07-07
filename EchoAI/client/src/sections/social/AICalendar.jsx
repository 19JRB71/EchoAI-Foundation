import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api.js";
import Spinner from "../../components/Spinner.jsx";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import { PLATFORMS, PlatformBadge, PlatformDot, platformMeta } from "./platformMeta.jsx";
import {
  postFailureReason,
  isCredentialFailure,
  isRetryingPost,
  retryAttemptInfo,
} from "./postFailure.js";
import RetryBadge from "./RetryBadge.jsx";
import ReschedulePost from "./ReschedulePost.jsx";
import AccountHealthBanner from "./AccountHealthBanner.jsx";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const FREQUENCIES = [
  { value: "optimal", label: "Optimal — per-platform, up to 3×/day (recommended)" },
  { value: "daily", label: "Daily" },
  { value: "five_per_week", label: "5 times per week" },
  { value: "three_per_week", label: "3 times per week" },
];

function freqLabel(value) {
  return FREQUENCIES.find((f) => f.value === value)?.label || value || "—";
}

function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function statusStyle(status) {
  switch (status) {
    case "published":
      return "bg-green-100 text-green-700";
    case "scheduled":
      return "bg-blue-100 text-blue-700";
    case "publishing":
      return "bg-amber-500/15 text-amber-300";
    case "failed":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-800 text-gray-400";
  }
}

function calendarStatusStyle(status) {
  switch (status) {
    case "active":
      return "bg-green-500/15 text-green-400";
    case "paused":
      return "bg-amber-500/15 text-amber-300";
    default:
      return "bg-gray-800 text-gray-400";
  }
}

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export default function AICalendar({ brandId, onReconnect }) {
  const [calendar, setCalendar] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [preview, setPreview] = useState(null); // { posts, postingFrequency, contentTheme }
  const [activePost, setActivePost] = useState(null);

  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedKey, setSelectedKey] = useState(null);

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.getContentCalendar(brandId);
      setCalendar(data.calendar || null);
      setPosts(data.posts || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  const postsByDay = useMemo(() => {
    const map = {};
    for (const post of posts) {
      const raw = post.scheduled_time || post.published_time || post.created_at;
      if (!raw) continue;
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) continue;
      const key = dayKey(d);
      (map[key] = map[key] || []).push(post);
    }
    return map;
  }, [posts]);

  const cells = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const result = [];
    for (let i = 0; i < startOffset; i += 1) result.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      result.push(new Date(cursor.year, cursor.month, day));
    }
    return result;
  }, [cursor]);

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(
    undefined,
    { month: "long", year: "numeric" }
  );
  const selectedPosts = selectedKey ? postsByDay[selectedKey] || [] : [];
  const todayKey = dayKey(new Date());

  function changeMonth(delta) {
    setSelectedKey(null);
    setCursor((c) => {
      const m = c.month + delta;
      return {
        year: c.year + Math.floor(m / 12),
        month: ((m % 12) + 12) % 12,
      };
    });
  }

  async function handleActivate() {
    if (!calendar) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.activateContentCalendar(calendar.calendar_id);
      setNotice("Calendar activated — posts will publish automatically at their scheduled times.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePause() {
    if (!calendar) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.pauseContentCalendar(calendar.calendar_id);
      setNotice("Calendar paused — auto-posting is stopped (your calendar is kept).");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <AccountHealthBanner brandId={brandId} onReconnect={onReconnect} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {calendar && (
            <>
              <span className="text-sm font-semibold text-gray-100">
                {freqLabel(calendar.posting_frequency)}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${calendarStatusStyle(
                  calendar.status
                )}`}
              >
                {calendar.status}
              </span>
              {calendar.content_theme && (
                <span className="text-xs text-gray-400">
                  Theme: {calendar.content_theme}
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {calendar && calendar.status !== "active" && (
            <button
              onClick={handleActivate}
              disabled={busy}
              className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              Activate
            </button>
          )}
          {calendar && calendar.status === "active" && (
            <button
              onClick={handlePause}
              disabled={busy}
              className="rounded-lg border border-amber-500 px-3 py-1.5 text-sm font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
            >
              Pause
            </button>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm font-semibold text-gray-300 hover:bg-gray-800"
          >
            Posting Times
          </button>
          <button
            onClick={() => {
              setPreview(null);
              setShowForm(true);
            }}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-amber-600"
          >
            Generate Calendar
          </button>
        </div>
      </div>

      {showSettings && (
        <PostingSettingsPanel
          brandId={brandId}
          onClose={() => setShowSettings(false)}
          onSaved={() => {
            setShowSettings(false);
            setNotice(
              "Posting times saved — your next generated calendar will use them."
            );
          }}
        />
      )}

      <ErrorBanner message={error} />
      {notice && (
        <div className="rounded-lg border border-green-700 bg-green-900/30 px-4 py-2 text-sm text-green-300">
          {notice}
        </div>
      )}

      {showForm && (
        <GenerateForm
          brandId={brandId}
          onClose={() => setShowForm(false)}
          onGenerated={(data) => {
            setPreview(data);
            setShowForm(false);
          }}
        />
      )}

      {preview && (
        <PreviewPanel
          brandId={brandId}
          preview={preview}
          onCancel={() => setPreview(null)}
          onSaved={async () => {
            setPreview(null);
            setNotice("Calendar saved as a draft. Activate it to start auto-posting.");
            await load();
          }}
        />
      )}

      {loading ? (
        <Spinner label="Loading calendar…" />
      ) : !calendar && !preview ? (
        <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900 p-8 text-center">
          <p className="text-sm text-gray-400">
            No content calendar yet. Generate a 30-day plan and EchoAI will draft a
            unique, on-brand post for every scheduled day.
          </p>
        </div>
      ) : (
        calendar && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => changeMonth(-1)}
                  className="rounded-lg border border-gray-800 px-3 py-1.5 text-sm font-medium text-gray-400 hover:bg-gray-800"
                >
                  ‹ Prev
                </button>
                <span className="min-w-[10rem] text-center text-sm font-semibold text-gray-100">
                  {monthLabel}
                </span>
                <button
                  onClick={() => changeMonth(1)}
                  className="rounded-lg border border-gray-800 px-3 py-1.5 text-sm font-medium text-gray-400 hover:bg-gray-800"
                >
                  Next ›
                </button>
              </div>
              <button
                onClick={load}
                className="rounded-lg border border-gray-800 px-3 py-1.5 text-sm font-medium text-gray-400 hover:bg-gray-800"
              >
                Refresh
              </button>
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900 shadow-sm">
              <div className="grid grid-cols-7 border-b border-gray-800 bg-gray-800 text-center text-xs font-semibold uppercase tracking-wide text-gray-400">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="px-1 py-2">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {cells.map((date, idx) => {
                  if (!date) {
                    return (
                      <div
                        key={`pad-${idx}`}
                        className="min-h-[88px] border-b border-r border-gray-800 bg-gray-800/40"
                      />
                    );
                  }
                  const key = dayKey(date);
                  const dayPosts = postsByDay[key] || [];
                  const platforms = [...new Set(dayPosts.map((p) => p.platform))];
                  const isToday = key === todayKey;
                  const isSelected = key === selectedKey;
                  const hasPosts = dayPosts.length > 0;
                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedKey(hasPosts ? key : null)}
                      className={`min-h-[88px] border-b border-r border-gray-800 p-2 text-left align-top transition ${
                        hasPosts ? "cursor-pointer hover:bg-amber-500/10" : "cursor-default"
                      } ${isSelected ? "bg-amber-500/10" : "bg-gray-900"}`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-xs font-semibold ${
                            isToday
                              ? "flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-gray-900"
                              : "text-gray-400"
                          }`}
                        >
                          {date.getDate()}
                        </span>
                      </div>
                      {hasPosts ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {platforms.map((p) => (
                            <PlatformDot key={p} platform={p} />
                          ))}
                          <span className="ml-0.5 text-[10px] font-medium text-gray-400">
                            {dayPosts.length}
                          </span>
                        </div>
                      ) : (
                        <div className="mt-2 text-[10px] text-gray-600">No posts</div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedKey && (
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-100">
                    Posts on{" "}
                    {new Date(`${selectedKey}T00:00:00`).toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                  </h3>
                  <button
                    onClick={() => setSelectedKey(null)}
                    className="text-sm text-gray-400 hover:text-gray-200"
                  >
                    Close
                  </button>
                </div>
                <ul className="divide-y divide-gray-800">
                  {selectedPosts.map((post) => {
                    const failReason = postFailureReason(post);
                    return (
                      <li key={post.post_id}>
                        <button
                          onClick={() => setActivePost(post)}
                          title={failReason || undefined}
                          className="flex w-full items-center gap-3 py-3 text-left hover:bg-gray-800"
                        >
                          <PlatformBadge platform={post.platform} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-gray-300">
                              {post.post_content}
                            </span>
                            {failReason && (
                              <span className="mt-0.5 block truncate text-xs text-red-400">
                                {failReason}
                              </span>
                            )}
                            {isRetryingPost(post) && (
                              <span className="mt-0.5 block">
                                <RetryBadge />
                              </span>
                            )}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyle(
                              post.status
                            )}`}
                          >
                            {post.status}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )
      )}

      {activePost && (
        <PostPanel
          post={activePost}
          onClose={() => setActivePost(null)}
          onReconnect={onReconnect}
          onChanged={async () => {
            await load();
          }}
          setActivePost={setActivePost}
        />
      )}
    </div>
  );
}

function GenerateForm({ brandId, onClose, onGenerated }) {
  const [frequency, setFrequency] = useState("optimal");
  const [platforms, setPlatforms] = useState(["instagram"]);
  const [theme, setTheme] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function togglePlatform(p) {
    setPlatforms((cur) =>
      cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]
    );
  }

  async function submit(e) {
    e.preventDefault();
    if (platforms.length === 0) {
      setError("Select at least one platform.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await api.generateContentCalendar({
        brandId,
        postingFrequency: frequency,
        platforms,
        contentTheme: theme.trim() || undefined,
      });
      onGenerated({
        posts: data.posts || [],
        postingFrequency: frequency,
        contentTheme: theme.trim() || null,
        connectionWarning: data.connectionWarning || null,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-100">Generate a 30-day calendar</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-gray-400 hover:text-gray-200"
        >
          Cancel
        </button>
      </div>

      <ErrorBanner message={error} />

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-400">
            Posting frequency
          </label>
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
          >
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-400">Platforms</label>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => {
              const meta = platformMeta(p);
              const active = platforms.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? "border-amber-500 bg-amber-500/10 text-amber-300"
                      : "border-gray-700 text-gray-400 hover:text-gray-200"
                  }`}
                >
                  <PlatformDot platform={p} />
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-400">
            Content theme / focus (optional)
          </label>
          <input
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="e.g. Summer launch, customer wins, product education"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
          />
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-50"
        >
          {loading ? "Generating…" : "Generate"}
        </button>
      </div>

      {loading && (
        <p className="mt-3 text-xs text-gray-400">
          Planning a unique, on-brand post for each scheduled day. This can take a
          moment…
        </p>
      )}
    </form>
  );
}

function PreviewPanel({ brandId, preview, onCancel, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      await api.saveContentCalendar({
        brandId,
        postingFrequency: preview.postingFrequency,
        contentTheme: preview.contentTheme || undefined,
        posts: preview.posts.map((p) => ({
          platform: p.platform,
          postContent: p.postContent,
          scheduledTime: p.scheduledTime,
        })),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-amber-700/50 bg-gray-900 p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-100">
          Preview — {preview.posts.length} planned posts
        </h3>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-gray-800 px-3 py-1.5 text-sm font-medium text-gray-400 hover:bg-gray-800 disabled:opacity-50"
          >
            Discard
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Calendar"}
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />

      {preview.connectionWarning && (
        <div
          data-testid="calendar-connection-warning"
          className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
        >
          ⚠️ {preview.connectionWarning}
        </div>
      )}

      <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
        {preview.posts.map((post, i) => (
          <li
            key={i}
            className="flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-900 p-3"
          >
            <PlatformBadge platform={post.platform} />
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2 text-[11px] text-gray-400">
                <span>Day {post.day}</span>
                <span>·</span>
                <span>{formatDateTime(post.scheduledTime)}</span>
                {post.contentType && (
                  <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300">
                    {String(post.contentType).replace(/_/g, " ")}
                  </span>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm text-gray-200">
                {post.postContent}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PostPanel({ post, onClose, onChanged, setActivePost, onReconnect }) {
  const meta = platformMeta(post.platform);
  const editable = post.status !== "published" && post.status !== "publishing";
  const failReason = postFailureReason(post);
  const credentialFailure = isCredentialFailure(post);
  const retryInfo = retryAttemptInfo(post);
  const [content, setContent] = useState(post.post_content || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setContent(post.post_content || "");
  }, [post]);

  async function saveEdit() {
    setBusy(true);
    setError("");
    try {
      const data = await api.updateCalendarPost(post.post_id, content);
      setActivePost(data.post);
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    setBusy(true);
    setError("");
    try {
      const data = await api.regenerateCalendarPost(post.post_id);
      setContent(data.post.post_content || "");
      setActivePost(data.post);
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-gray-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PlatformBadge platform={post.platform} />
            <span className="text-sm font-semibold text-gray-100">{meta.label}</span>
          </div>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyle(
              post.status
            )}`}
          >
            {post.status}
          </span>
        </div>

        {retryInfo && (
          <div className="mb-4">
            <RetryBadge
              attempt={retryInfo.nextAttempt}
              maxAttempts={retryInfo.maxAttempts}
            />
          </div>
        )}

        <dl className="mb-4 space-y-1 border-b border-gray-800 pb-4 text-xs text-gray-400">
          <div className="flex justify-between">
            <dt>Scheduled</dt>
            <dd className="text-gray-300">{formatDateTime(post.scheduled_time)}</dd>
          </div>
          {post.published_time && (
            <div className="flex justify-between">
              <dt>Published</dt>
              <dd className="text-gray-300">{formatDateTime(post.published_time)}</dd>
            </div>
          )}
        </dl>

        {failReason && (
          <div className="mb-4 rounded-lg border border-red-800/60 bg-red-900/20 p-3 text-xs">
            <p className="mb-1 font-semibold text-red-300">Why this post failed</p>
            <p className="text-red-200">{failReason}</p>
            {credentialFailure && (
              <p className="mt-2 text-red-200/80">
                This looks like an expired or revoked account login — reconnect
                your {meta.label} account first, or rescheduling will fail
                again.
              </p>
            )}
          </div>
        )}

        {post.status === "failed" && (
          <div className="mb-4">
            {credentialFailure && onReconnect && (
              <div className="mb-3">
                <button
                  onClick={() => {
                    onClose();
                    onReconnect(post.platform);
                  }}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600"
                >
                  Reconnect account
                </button>
              </div>
            )}
            <ReschedulePost
              post={post}
              onRescheduled={async (updated) => {
                setActivePost(updated);
                await onChanged();
              }}
            />
          </div>
        )}

        <ErrorBanner message={error} />

        {editable ? (
          <>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              Edit before it goes live
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
            />
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                onClick={regenerate}
                disabled={busy}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
              >
                {busy ? "Working…" : "Regenerate"}
              </button>
              <button
                onClick={saveEdit}
                disabled={busy || !content.trim()}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </>
        ) : (
          <p className="whitespace-pre-wrap text-sm text-gray-200">{post.post_content}</p>
        )}

        <div className="mt-5 text-right">
          <button
            onClick={onClose}
            className="text-sm text-gray-400 hover:text-gray-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const CADENCE_HINT = {
  daily: "every day",
  weekly: "on its weekly days",
};

function sameTimes(a, b) {
  if (a.length !== b.length) return false;
  return a.every((t, i) => t === b[i]);
}

function PostingSettingsPanel({ brandId, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [defaults, setDefaults] = useState({});
  const [maxPerPlatform, setMaxPerPlatform] = useState(6);
  const [windows, setWindows] = useState({}); // { platform: ["HH:MM", ...] }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await api.getCalendarPostingSettings(brandId);
        if (cancelled) return;
        const defs = data.defaults || {};
        setDefaults(defs);
        setMaxPerPlatform(data.maxPerPlatform || 6);
        const saved = data.windows || {};
        const init = {};
        for (const [platform, def] of Object.entries(defs)) {
          init[platform] =
            saved[platform] && saved[platform].length
              ? [...saved[platform]]
              : [...(def.times || [])];
        }
        setWindows(init);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  function setTime(platform, index, value) {
    setWindows((cur) => {
      const next = { ...cur };
      const times = [...(next[platform] || [])];
      times[index] = value;
      next[platform] = times;
      return next;
    });
  }

  function addTime(platform) {
    setWindows((cur) => {
      const times = [...(cur[platform] || [])];
      if (times.length >= maxPerPlatform) return cur;
      return { ...cur, [platform]: [...times, "12:00"] };
    });
  }

  function removeTime(platform, index) {
    setWindows((cur) => {
      const times = [...(cur[platform] || [])];
      times.splice(index, 1);
      return { ...cur, [platform]: times };
    });
  }

  function resetPlatform(platform) {
    setWindows((cur) => ({
      ...cur,
      [platform]: [...(defaults[platform]?.times || [])],
    }));
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      // Only send platforms whose times differ from the coded default, and only
      // valid, non-empty times. Untouched platforms are omitted so they keep
      // following the default schedule.
      const payload = {};
      for (const [platform, def] of Object.entries(defaults)) {
        const times = (windows[platform] || []).filter((t) =>
          /^\d{1,2}:\d{2}$/.test(t)
        );
        if (times.length && !sameTimes(times, def.times || [])) {
          payload[platform] = times;
        }
      }
      await api.saveCalendarPostingSettings(brandId, payload);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">
            Posting times (Optimal schedule)
          </h3>
          <p className="mt-0.5 text-xs text-gray-400">
            Set your preferred posting windows per platform, in your brand's
            timezone. These apply when you generate an "Optimal" calendar.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-gray-400 hover:text-gray-200"
        >
          Cancel
        </button>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="Loading posting times…" />
      ) : (
        <>
          <div className="space-y-3">
            {Object.entries(defaults).map(([platform, def]) => {
              const times = windows[platform] || [];
              const isDefault = sameTimes(times, def.times || []);
              return (
                <div
                  key={platform}
                  className="rounded-lg border border-gray-800 bg-gray-900 p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <PlatformBadge platform={platform} />
                      <span className="text-[11px] text-gray-500">
                        {platformMeta(platform).label} ·{" "}
                        {CADENCE_HINT[def.cadence] || def.cadence}
                        {def.perWeek ? ` (${def.perWeek}×/week)` : ""}
                      </span>
                    </div>
                    {!isDefault && (
                      <button
                        type="button"
                        onClick={() => resetPlatform(platform)}
                        className="text-[11px] text-gray-400 hover:text-gray-200"
                      >
                        Reset to default
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {times.map((t, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <input
                          type="time"
                          value={t}
                          onChange={(e) => setTime(platform, i, e.target.value)}
                          className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100"
                        />
                        <button
                          type="button"
                          onClick={() => removeTime(platform, i)}
                          aria-label="Remove time"
                          className="rounded px-1.5 py-0.5 text-sm text-gray-500 hover:bg-gray-800 hover:text-red-400"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {times.length < maxPerPlatform && (
                      <button
                        type="button"
                        onClick={() => addTime(platform)}
                        className="rounded-lg border border-dashed border-gray-700 px-2 py-1 text-xs font-medium text-gray-400 hover:text-gray-200"
                      >
                        + Add time
                      </button>
                    )}
                    {times.length === 0 && (
                      <span className="text-[11px] text-gray-500">
                        No times — this platform will use the default schedule.
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-gray-800 px-3 py-1.5 text-sm font-medium text-gray-400 hover:bg-gray-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save posting times"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
