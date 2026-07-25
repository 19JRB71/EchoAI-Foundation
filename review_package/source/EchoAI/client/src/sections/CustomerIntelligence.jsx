import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

const TABS = [
  { key: "brief", label: "Intelligence Brief" },
  { key: "profile", label: "Profile" },
  { key: "trends", label: "Trends" },
  { key: "applied", label: "Applied" },
];

const IMPACT_STYLES = {
  high: "bg-green-500/15 text-green-300 border-green-500/30",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  low: "bg-gray-600/20 text-gray-300 border-gray-600/40",
};
const EFFORT_STYLES = {
  low: "bg-green-500/15 text-green-300 border-green-500/30",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  high: "bg-rose-500/15 text-rose-300 border-rose-500/30",
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

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return String(d);
  }
}

export default function CustomerIntelligence({ brandId }) {
  const [tab, setTab] = useState("brief");

  if (!brandId) {
    return (
      <p className="text-sm text-gray-400">
        Select or create a brand to see its Customer Intelligence Engine.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-100">
          Customer Intelligence Engine
        </h2>
        <p className="mt-1 text-sm text-gray-400">
          An AI strategist that studies every channel each week and builds a
          growing intelligence profile with ranked, data-grounded moves.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-gray-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "border-indigo-400 text-indigo-300"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "brief" && <BriefTab brandId={brandId} />}
      {tab === "profile" && <ProfileTab brandId={brandId} />}
      {tab === "trends" && <TrendsTab brandId={brandId} />}
      {tab === "applied" && <AppliedTab brandId={brandId} />}
    </div>
  );
}

/* ------------------------------- Brief tab ------------------------------- */

function BriefTab({ brandId }) {
  const [brief, setBrief] = useState(null);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [appliedKeys, setAppliedKeys] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getIntelligenceBrief(brandId);
      setReady(Boolean(data.ready));
      setBrief(data.brief || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setBrief(null);
    setAppliedKeys({});
    load();
  }, [load]);

  async function handleGenerate() {
    setGenerating(true);
    setError("");
    try {
      const data = await api.generateIntelligence(brandId);
      setReady(Boolean(data.ready));
      setBrief(data.brief || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return <Spinner label="Loading this week's brief…" />;

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          {brief
            ? `Week of ${fmtDate(brief.weekDate)} · generated ${fmtDate(
                brief.createdAt,
              )}`
            : "No brief generated yet."}
        </p>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-600 disabled:opacity-60"
        >
          {generating
            ? "Analyzing every channel…"
            : brief
              ? "Regenerate now"
              : "Generate now"}
        </button>
      </div>

      {!ready || !brief ? (
        <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-8 text-center">
          <div className="text-3xl">🧠</div>
          <h3 className="mt-3 text-base font-bold text-gray-100">
            Your intelligence engine is warming up
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-300">
            Each Monday the AI synthesizes all of your channel data into a
            strategic brief — a trajectory score, the most important trends, and
            five ranked moves grounded in your real numbers. Your first brief
            builds automatically after a week of data, or generate one now.
          </p>
        </div>
      ) : (
        <>
          <TrajectoryCard brief={brief} />

          {brief.trends.length > 0 && (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
              <h3 className="mb-3 text-sm font-semibold text-gray-200">
                Key trends detected
              </h3>
              <ul className="space-y-2">
                {brief.trends.map((t, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <DirectionArrow direction={t.direction} />
                    <span className="text-gray-200">
                      <span className="font-semibold">{t.label}</span>
                      {t.detail ? (
                        <span className="text-gray-400"> — {t.detail}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-200">
              Recommended moves (ranked)
            </h3>
            {brief.recommendations.map((r, i) => (
              <RecommendationCard
                key={i}
                rank={i + 1}
                rec={r}
                applied={Boolean(appliedKeys[r.title])}
                onApplied={() =>
                  setAppliedKeys((prev) => ({ ...prev, [r.title]: true }))
                }
                brandId={brandId}
                intelligenceId={brief.intelligenceId}
              />
            ))}
          </div>

          {brief.analysis && (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
              <h3 className="mb-3 text-sm font-semibold text-gray-200">
                Executive analysis
              </h3>
              <div className="space-y-3 text-sm leading-relaxed text-gray-300">
                {brief.analysis.split(/\n{2,}/).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TrajectoryCard({ brief }) {
  const score = brief.trajectoryScore;
  const delta = brief.trajectoryDelta;
  const scoreColor =
    score >= 8
      ? "text-green-400"
      : score >= 5
        ? "text-amber-400"
        : "text-rose-400";
  return (
    <div className="rounded-2xl border border-gray-800 bg-gradient-to-b from-gray-900 to-gray-900/40 p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
        Business trajectory
      </p>
      <div className="mt-2 flex items-end gap-3">
        <span className={`text-5xl font-extrabold tracking-tight ${scoreColor}`}>
          {score}
        </span>
        <span className="pb-1 text-lg text-gray-500">/ 10</span>
        {delta != null && delta !== 0 && (
          <span
            className={`pb-1.5 text-sm font-semibold ${
              delta > 0 ? "text-green-400" : "text-rose-400"
            }`}
          >
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)} vs last week
          </span>
        )}
        {delta === 0 && (
          <span className="pb-1.5 text-sm font-semibold text-gray-500">
            no change vs last week
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Weighs lead volume &amp; quality, conversion rate, ROI, channel momentum,
        and feedback sentiment. 10 = thriving and accelerating.
      </p>
    </div>
  );
}

function DirectionArrow({ direction }) {
  if (direction === "up")
    return <span className="text-green-400">▲</span>;
  if (direction === "down")
    return <span className="text-rose-400">▼</span>;
  return <span className="text-gray-500">▬</span>;
}

function RecommendationCard({
  rank,
  rec,
  applied,
  onApplied,
  brandId,
  intelligenceId,
}) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      await api.applyRecommendation(brandId, {
        recommendationText: rec.title,
        actionTaken: action || undefined,
        intelligenceId,
      });
      setOpen(false);
      onApplied();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-sm font-bold text-indigo-300">
            {rank}
          </span>
          <div>
            <h4 className="text-sm font-semibold text-gray-100">{rec.title}</h4>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge className={IMPACT_STYLES[rec.impact] || IMPACT_STYLES.medium}>
                {rec.impact} impact
              </Badge>
              <Badge className={EFFORT_STYLES[rec.effort] || EFFORT_STYLES.medium}>
                {rec.effort} effort
              </Badge>
            </div>
          </div>
        </div>
        {applied ? (
          <Badge className="bg-green-500/15 text-green-300 border-green-500/30">
            ✓ Applied
          </Badge>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-gray-800"
          >
            Mark as applied
          </button>
        )}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-gray-300">
        {rec.explanation}
      </p>
      {rec.expectedOutcome && (
        <p className="mt-2 text-xs text-gray-500">
          <span className="font-semibold text-gray-400">Expected outcome:</span>{" "}
          {rec.expectedOutcome}
        </p>
      )}

      {open && !applied && (
        <div className="mt-4 space-y-2 rounded-lg border border-gray-800 bg-gray-950/40 p-3">
          <ErrorBanner message={error} />
          <label className="block text-xs font-medium text-gray-400">
            What did you do? (optional)
          </label>
          <textarea
            value={action}
            onChange={(e) => setAction(e.target.value)}
            rows={2}
            placeholder="e.g. Shifted 30% of budget to the highest-converting audience."
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-indigo-500 focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-600 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Log as applied"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Profile tab ------------------------------ */

const INSIGHT_SECTIONS = [
  { key: "idealCustomerProfile", label: "Ideal customer profile" },
  { key: "bestContentAngles", label: "Best content angles" },
  { key: "optimalChannelMix", label: "Optimal channel mix" },
  { key: "followUpTiming", label: "Follow-up timing" },
  { key: "competitivePositioning", label: "Competitive positioning" },
  { key: "seasonalTrends", label: "Seasonal trends" },
];

function ProfileTab({ brandId }) {
  const [profile, setProfile] = useState(null);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getIntelligenceProfile(brandId);
      setReady(Boolean(data.ready));
      setProfile(data.profile || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setProfile(null);
    load();
  }, [load]);

  if (loading) return <Spinner label="Loading intelligence profile…" />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      {!ready || !profile ? (
        <EmptyState>
          The intelligence profile builds with your first weekly brief. Generate
          one from the Intelligence Brief tab to see it here.
        </EmptyState>
      ) : (
        <>
          <p className="text-xs text-gray-500">
            Synthesized from real cross-channel data · week of{" "}
            {fmtDate(profile.weekDate)}
          </p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {INSIGHT_SECTIONS.map((s) => {
              const text = profile.insights?.[s.key];
              if (!text) return null;
              return (
                <div
                  key={s.key}
                  className="rounded-xl border border-gray-800 bg-gray-900 p-5"
                >
                  <h3 className="mb-2 text-sm font-semibold text-indigo-300">
                    {s.label}
                  </h3>
                  <p className="text-sm leading-relaxed text-gray-300">{text}</p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------- Trends tab ------------------------------ */

function TrendsTab({ brandId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.getIntelligenceTrends(brandId);
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  if (loading) return <Spinner label="Loading trends…" />;

  const history = data?.history || [];
  const cmp = data?.recommendationComparison || {};

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} />
      {history.length === 0 ? (
        <EmptyState>
          Trajectory history appears once you have at least one weekly brief. It
          grows each week to show how your business is evolving.
        </EmptyState>
      ) : (
        <>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <h3 className="mb-1 text-sm font-semibold text-gray-200">
              Trajectory score over time
            </h3>
            <p className="mb-4 text-xs text-gray-500">
              Up to 12 weeks of overall business trajectory (1–10).
            </p>
            <TrajectorySparkline history={history} />
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Week</th>
                  <th className="px-4 py-3">Trajectory</th>
                  <th className="px-4 py-3">Leads (90d)</th>
                  <th className="px-4 py-3">Converted</th>
                  <th className="px-4 py-3">Conv. rate</th>
                  <th className="px-4 py-3">Sentiment</th>
                </tr>
              </thead>
              <tbody>
                {history
                  .slice()
                  .reverse()
                  .map((h, i) => (
                    <tr
                      key={i}
                      className="border-b border-gray-800/60 last:border-0 text-gray-300"
                    >
                      <td className="px-4 py-2.5">{fmtDate(h.weekDate)}</td>
                      <td className="px-4 py-2.5 font-semibold text-gray-100">
                        {h.trajectoryScore ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">{h.leads ?? "—"}</td>
                      <td className="px-4 py-2.5">{h.conversions ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        {h.conversionRatePct != null
                          ? `${h.conversionRatePct}%`
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {h.avgSentiment != null ? h.avgSentiment : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {(cmp.current || cmp.previous) && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <RecListCard
                title="This week's focus"
                weekDate={cmp.current?.weekDate}
                recs={cmp.current?.recommendations}
              />
              <RecListCard
                title="Last week's focus"
                weekDate={cmp.previous?.weekDate}
                recs={cmp.previous?.recommendations}
                muted
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RecListCard({ title, weekDate, recs, muted }) {
  return (
    <div
      className={`rounded-xl border border-gray-800 p-5 ${
        muted ? "bg-gray-900/50" : "bg-gray-900"
      }`}
    >
      <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
      <p className="mb-3 text-xs text-gray-500">
        {weekDate ? fmtDate(weekDate) : "No data"}
      </p>
      {recs && recs.length > 0 ? (
        <ol className="space-y-1.5 text-sm text-gray-300">
          {recs.map((r, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-gray-600">{i + 1}.</span>
              <span>{r.title}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-gray-500">—</p>
      )}
    </div>
  );
}

function TrajectorySparkline({ history }) {
  const pts = history
    .map((h, i) => ({ i, v: Number(h.trajectoryScore) }))
    .filter((p) => Number.isFinite(p.v));
  if (pts.length === 0)
    return <p className="text-sm text-gray-500">No score data yet.</p>;

  const w = 600;
  const h = 140;
  const pad = 24;
  const maxX = Math.max(1, history.length - 1);
  const x = (i) => pad + (i / maxX) * (w - pad * 2);
  const y = (v) => h - pad - ((v - 1) / 9) * (h - pad * 2);

  const line = pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-36 w-full"
      preserveAspectRatio="none"
    >
      {[1, 5, 10].map((g) => (
        <g key={g}>
          <line
            x1={pad}
            x2={w - pad}
            y1={y(g)}
            y2={y(g)}
            stroke="#374151"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
          <text x={4} y={y(g) + 3} fontSize="9" fill="#6b7280">
            {g}
          </text>
        </g>
      ))}
      <polyline
        points={line}
        fill="none"
        stroke="#818cf8"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {pts.map((p) => (
        <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r="3.5" fill="#a5b4fc" />
      ))}
    </svg>
  );
}

/* ------------------------------ Applied tab ------------------------------ */

function AppliedTab({ brandId }) {
  const [applied, setApplied] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getAppliedRecommendations(brandId);
      setApplied(data.applied || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setApplied([]);
    load();
  }, [load]);

  if (loading) return <Spinner label="Loading applied recommendations…" />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      {applied.length === 0 ? (
        <EmptyState>
          Nothing logged yet. When you act on a recommendation in the
          Intelligence Brief, mark it as applied and it will appear here so you
          can track what worked.
        </EmptyState>
      ) : (
        applied.map((a) => (
          <AppliedCard
            key={a.application_id}
            item={a}
            brandId={brandId}
            onSaved={load}
          />
        ))
      )}
    </div>
  );
}

function AppliedCard({ item, brandId, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(item.outcome_notes || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      await api.updateAppliedRecommendation(brandId, item.application_id, {
        outcomeNotes: notes,
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-100">
            {item.recommendation_text}
          </h4>
          <p className="mt-0.5 text-xs text-gray-500">
            Applied {fmtDate(item.applied_at)}
          </p>
        </div>
      </div>

      {item.action_taken && (
        <p className="mt-3 text-sm text-gray-300">
          <span className="font-semibold text-gray-400">Action taken:</span>{" "}
          {item.action_taken}
        </p>
      )}

      <div className="mt-3">
        {editing ? (
          <div className="space-y-2">
            <ErrorBanner message={error} />
            <label className="block text-xs font-medium text-gray-400">
              Outcome notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="What happened after you applied this?"
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-indigo-500 focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-600 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setNotes(item.outcome_notes || "");
                  setEditing(false);
                }}
                className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-800"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-gray-400">
              {item.outcome_notes ? (
                <>
                  <span className="font-semibold text-gray-400">Outcome:</span>{" "}
                  {item.outcome_notes}
                </>
              ) : (
                <span className="text-gray-600">No outcome notes yet.</span>
              )}
            </p>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="shrink-0 rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-gray-800"
            >
              {item.outcome_notes ? "Edit" : "Add outcome"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ children }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-8 text-center">
      <p className="mx-auto max-w-md text-sm leading-relaxed text-gray-400">
        {children}
      </p>
    </div>
  );
}
