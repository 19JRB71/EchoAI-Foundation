import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

const TABS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "responses", label: "Responses" },
  { key: "surveys", label: "Surveys" },
];

const SURVEY_TYPES = [
  { value: "post_purchase", label: "Post-purchase" },
  { value: "post_call", label: "Post-call" },
  { value: "post_chatbot", label: "Post-chat" },
  { value: "general", label: "General check-in" },
];

function typeLabel(value) {
  return SURVEY_TYPES.find((t) => t.value === value)?.label || value || "—";
}

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function scoreColor(score) {
  if (score == null) return "text-gray-400";
  if (score >= 8) return "text-emerald-400";
  if (score >= 6) return "text-amber-400";
  return "text-red-400";
}

export default function Feedback({ brandId }) {
  const [tab, setTab] = useState("dashboard");

  if (!brandId) {
    return (
      <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900 p-8 text-center">
        <p className="text-sm text-gray-400">
          Select a brand to collect and analyze customer feedback.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-100">Customer Feedback</h1>
        <p className="mt-1 text-sm text-gray-400">
          Send quick satisfaction surveys, read every response, and get a plain-language
          AI analysis of how your customers really feel.
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition ${
              tab === t.key
                ? "border-amber-500 text-amber-400"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <DashboardTab brandId={brandId} />}
      {tab === "responses" && <ResponsesTab brandId={brandId} />}
      {tab === "surveys" && <SurveysTab brandId={brandId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard tab
// ---------------------------------------------------------------------------

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-gray-100">{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function SentimentBar({ breakdown }) {
  const segments = [
    { key: "positive", color: "bg-emerald-500", label: "Positive" },
    { key: "neutral", color: "bg-amber-500", label: "Neutral" },
    { key: "negative", color: "bg-red-500", label: "Negative" },
  ];
  const total = segments.reduce((sum, s) => sum + (breakdown[s.key] || 0), 0);
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Sentiment breakdown
      </p>
      {total === 0 ? (
        <p className="mt-3 text-sm text-gray-500">No scored responses yet.</p>
      ) : (
        <>
          <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-gray-800">
            {segments.map((s) =>
              breakdown[s.key] > 0 ? (
                <div
                  key={s.key}
                  className={s.color}
                  style={{ width: `${breakdown[s.key]}%` }}
                  title={`${s.label}: ${breakdown[s.key]}%`}
                />
              ) : null
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-400">
            {segments.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-full ${s.color}`} />
                {s.label} {breakdown[s.key] || 0}%
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DashboardTab({ brandId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api.getFeedbackDashboard(brandId));
    } catch (err) {
      setError(err.message || "Failed to load feedback dashboard");
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAnalysis() {
    setAnalyzing(true);
    setError("");
    setNotice("");
    try {
      const res = await api.analyzeFeedback(brandId);
      if (res.report) {
        setNotice("Fresh analysis generated.");
        await load();
      } else {
        setNotice(res.message || "No responses to analyze yet.");
      }
    } catch (err) {
      setError(err.message || "Failed to analyze feedback");
    } finally {
      setAnalyzing(false);
    }
  }

  if (loading) return <Spinner label="Loading dashboard…" />;
  if (error && !data) return <ErrorBanner message={error} />;
  if (!data) return null;

  const report = data.latestReport;

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} />
      {notice && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
          {notice}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Avg. satisfaction"
          value={data.averageSatisfaction != null ? `${data.averageSatisfaction}/10` : "—"}
          hint="Across all scored responses"
        />
        <StatCard
          label="Responses this month"
          value={data.totalResponsesThisMonth}
          hint={`${data.totalResponses} all-time`}
        />
        <StatCard
          label="Response rate"
          value={data.responseRate != null ? `${data.responseRate}%` : "—"}
          hint="Responded ÷ sent this month"
        />
      </div>

      <SentimentBar breakdown={data.sentimentBreakdown} />

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-100">AI Feedback Analysis</h2>
            <p className="text-xs text-gray-500">
              {report
                ? `Last run ${formatDateTime(report.created_at)} · ${report.total_responses} responses`
                : "No analysis yet."}
            </p>
          </div>
          <button
            onClick={runAnalysis}
            disabled={analyzing}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-400 disabled:opacity-60"
          >
            {analyzing ? "Analyzing…" : "Run analysis"}
          </button>
        </div>

        {report ? (
          <div className="mt-4 space-y-5">
            <p className="whitespace-pre-line text-sm text-gray-300">{report.full_report}</p>

            {Array.isArray(report.themes) && report.themes.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Top themes
                </h3>
                <ul className="mt-2 space-y-2">
                  {report.themes.map((t, i) => (
                    <li key={i} className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                      <p className="text-sm font-semibold text-gray-200">{t.title}</p>
                      {t.description && (
                        <p className="mt-0.5 text-sm text-gray-400">{t.description}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {Array.isArray(report.recommendations) && report.recommendations.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Recommended actions
                </h3>
                <ol className="mt-2 space-y-2">
                  {report.recommendations.map((r, i) => (
                    <li key={i} className="flex gap-3 rounded-lg border border-gray-800 bg-gray-950 p-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-gray-900">
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-gray-200">{r.action}</p>
                        {r.why && <p className="mt-0.5 text-sm text-gray-400">{r.why}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-500">
            Run an analysis to see sentiment, themes, and recommended actions in plain language.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Responses tab
// ---------------------------------------------------------------------------

function ResponsesTab({ brandId }) {
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.getFeedbackResponses(brandId);
        if (active) setResponses(res.responses || []);
      } catch (err) {
        if (active) setError(err.message || "Failed to load responses");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [brandId]);

  if (loading) return <Spinner label="Loading responses…" />;
  if (error) return <ErrorBanner message={error} />;
  if (responses.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900 p-8 text-center">
        <p className="text-sm text-gray-400">
          No responses yet. Send a survey from the Surveys tab to start collecting feedback.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {responses.map((r) => (
        <div key={r.responseId} className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className={`text-lg font-bold ${scoreColor(r.sentimentScore)}`}>
                {r.sentimentScore != null ? `${r.sentimentScore}/10` : "—"}
              </span>
              <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-xs text-gray-300">
                {typeLabel(r.interactionType)}
              </span>
            </div>
            <span className="text-xs text-gray-500">{formatDateTime(r.respondedAt)}</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {r.respondentEmail || r.respondentPhone || "Anonymous"}
          </p>
          <div className="mt-3 space-y-2">
            {r.answers.map((a, i) => (
              <div key={i}>
                <p className="text-xs font-medium text-gray-500">{a.question}</p>
                <p className="text-sm text-gray-200">{String(a.answer)}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Surveys tab
// ---------------------------------------------------------------------------

function SurveysTab({ brandId }) {
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [surveyType, setSurveyType] = useState("general");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.getSurveys(brandId);
      setSurveys(res.surveys || []);
    } catch (err) {
      setError(err.message || "Failed to load surveys");
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  async function createSurvey() {
    setCreating(true);
    setError("");
    setNotice("");
    try {
      await api.createSurvey({ brandId, surveyType });
      setNotice("Survey created with AI-written questions.");
      await load();
    } catch (err) {
      setError(err.message || "Failed to create survey");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h2 className="text-sm font-semibold text-gray-100">Create a survey</h2>
        <p className="mt-1 text-xs text-gray-500">
          The AI writes 5 on-brand questions for the moment you choose.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs font-medium text-gray-400">
            Survey type
            <select
              value={surveyType}
              onChange={(e) => setSurveyType(e.target.value)}
              className="mt-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
            >
              {SURVEY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={createSurvey}
            disabled={creating}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-400 disabled:opacity-60"
          >
            {creating ? "Generating…" : "Generate survey"}
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />
      {notice && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
          {notice}
        </div>
      )}

      {loading ? (
        <Spinner label="Loading surveys…" />
      ) : surveys.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900 p-8 text-center">
          <p className="text-sm text-gray-400">No surveys yet. Create one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {surveys.map((s) => (
            <SurveyCard key={s.surveyId} survey={s} onSent={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function SurveyCard({ survey, onSent }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function send(channel) {
    setSending(true);
    setError("");
    setNotice("");
    try {
      await api.sendSurvey({
        surveyId: survey.surveyId,
        email: channel === "email" ? email : undefined,
        phone: channel === "sms" ? phone : undefined,
        channel,
      });
      setNotice(`Survey sent by ${channel === "email" ? "email" : "SMS"}.`);
      setEmail("");
      setPhone("");
      if (onSent) onSent();
    } catch (err) {
      setError(err.message || "Failed to send survey");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-xs text-gray-300">
            {typeLabel(survey.surveyType)}
          </span>
          <span className="text-xs text-gray-500">{survey.questionCount} questions</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>{survey.sent} sent</span>
          <span>{survey.responses} responses</span>
          {survey.responseRate != null && <span>{survey.responseRate}% rate</span>}
        </div>
      </div>

      {Array.isArray(survey.questions) && (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-gray-300">
          {survey.questions.map((q, i) => (
            <li key={i}>
              {q.question}
              {q.type === "rating" && (
                <span className="ml-2 text-xs text-amber-400">(1–10 rating)</span>
              )}
            </li>
          ))}
        </ol>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-4 text-sm font-semibold text-amber-400 hover:text-amber-300"
      >
        {open ? "Cancel" : "Send to a customer"}
      </button>

      {open && (
        <div className="mt-3 space-y-3 rounded-lg border border-gray-800 bg-gray-950 p-4">
          <ErrorBanner message={error} />
          {notice && <p className="text-sm text-emerald-400">{notice}</p>}
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-1 flex-col text-xs font-medium text-gray-400">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer@example.com"
                className="mt-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
              />
            </label>
            <button
              onClick={() => send("email")}
              disabled={sending || !email}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-400 disabled:opacity-60"
            >
              Email it
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-1 flex-col text-xs font-medium text-gray-400">
              Phone (SMS — needs a connected Twilio number)
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+15551234567"
                className="mt-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
              />
            </label>
            <button
              onClick={() => send("sms")}
              disabled={sending || !phone}
              className="rounded-lg border border-amber-500 px-4 py-2 text-sm font-semibold text-amber-400 hover:bg-amber-500/10 disabled:opacity-60"
            >
              Text it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
