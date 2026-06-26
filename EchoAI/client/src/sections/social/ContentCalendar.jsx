import { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "../../api.js";
import Spinner from "../../components/Spinner.jsx";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import { PlatformBadge, PlatformDot, platformMeta } from "./platformMeta.jsx";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Local YYYY-MM-DD key for a date (so posts land on the right calendar cell).
function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// A post's effective calendar date: when it was published, else when scheduled.
function postDate(post) {
  const raw = post.published_time || post.scheduled_time || post.created_at;
  return raw ? new Date(raw) : null;
}

function statusStyle(status) {
  switch (status) {
    case "published":
      return "bg-green-100 text-green-700";
    case "scheduled":
      return "bg-blue-100 text-blue-700";
    case "publishing":
      return "bg-amber-100 text-amber-800";
    case "failed":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export default function ContentCalendar({ brandId }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedKey, setSelectedKey] = useState(null);
  const [activePost, setActivePost] = useState(null);

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.getSocialCalendar(brandId);
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

  // Group posts by local day key for quick lookup while rendering cells.
  const postsByDay = useMemo(() => {
    const map = {};
    for (const post of posts) {
      const d = postDate(post);
      if (!d || Number.isNaN(d.getTime())) continue;
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
      const year = c.year + Math.floor(m / 12);
      const month = ((m % 12) + 12) % 12;
      return { year, month };
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => changeMonth(-1)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            ‹ Prev
          </button>
          <span className="min-w-[10rem] text-center text-sm font-semibold text-gray-900">
            {monthLabel}
          </span>
          <button
            onClick={() => changeMonth(1)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Next ›
          </button>
        </div>
        <button
          onClick={load}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="Loading calendar…" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-1 py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((date, idx) => {
              if (!date) return <div key={`pad-${idx}`} className="min-h-[88px] border-b border-r border-gray-50 bg-gray-50/40" />;
              const key = dayKey(date);
              const dayPosts = postsByDay[key] || [];
              const platforms = [...new Set(dayPosts.map((p) => p.platform))];
              const isToday = key === todayKey;
              const isSelected = key === selectedKey;
              return (
                <button
                  key={key}
                  onClick={() => setSelectedKey(dayPosts.length ? key : null)}
                  className={`min-h-[88px] cursor-pointer border-b border-r border-gray-50 p-2 text-left align-top transition hover:bg-indigo-50/40 ${
                    isSelected ? "bg-indigo-50" : "bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-semibold ${
                        isToday
                          ? "flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white"
                          : "text-gray-600"
                      }`}
                    >
                      {date.getDate()}
                    </span>
                  </div>
                  {dayPosts.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {platforms.map((p) => (
                        <PlatformDot key={p} platform={p} />
                      ))}
                      <span className="ml-0.5 text-[10px] font-medium text-gray-400">
                        {dayPosts.length}
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selectedKey && (
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">
              Posts on{" "}
              {new Date(`${selectedKey}T00:00:00`).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </h3>
            <button
              onClick={() => setSelectedKey(null)}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              Close
            </button>
          </div>
          {selectedPosts.length === 0 ? (
            <p className="text-sm text-gray-500">No posts this day.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {selectedPosts.map((post) => (
                <li key={post.post_id}>
                  <button
                    onClick={() => setActivePost(post)}
                    className="flex w-full items-center gap-3 py-3 text-left hover:bg-gray-50"
                  >
                    <PlatformBadge platform={post.platform} />
                    <span className="flex-1 truncate text-sm text-gray-700">
                      {post.post_content}
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
              ))}
            </ul>
          )}
        </div>
      )}

      {activePost && (
        <PostDetailModal post={activePost} onClose={() => setActivePost(null)} />
      )}
    </div>
  );
}

function PostDetailModal({ post, onClose }) {
  const meta = platformMeta(post.platform);
  const metrics = post.engagement_metrics || null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PlatformBadge platform={post.platform} />
            <span className="text-sm font-semibold text-gray-900">
              {meta.label}
            </span>
          </div>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyle(
              post.status
            )}`}
          >
            {post.status}
          </span>
        </div>

        <p className="whitespace-pre-wrap text-sm text-gray-800">
          {post.post_content}
        </p>

        <dl className="mt-4 space-y-1 border-t border-gray-100 pt-4 text-xs text-gray-500">
          <div className="flex justify-between">
            <dt>Scheduled</dt>
            <dd className="text-gray-700">{formatDateTime(post.scheduled_time)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Published</dt>
            <dd className="text-gray-700">{formatDateTime(post.published_time)}</dd>
          </div>
          {post.external_post_id && (
            <div className="flex justify-between">
              <dt>Platform post ID</dt>
              <dd className="text-gray-700">{post.external_post_id}</dd>
            </div>
          )}
        </dl>

        {metrics && (
          <div className="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
            {metrics.error ? (
              <span className="text-red-600">{metrics.error}</span>
            ) : (
              <span>
                Likes {metrics.likes ?? "—"} · Shares {metrics.shares ?? "—"} ·
                Reach {metrics.reach ?? "—"}
              </span>
            )}
          </div>
        )}

        <div className="mt-5 text-right">
          <button
            onClick={onClose}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
