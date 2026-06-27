import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";
import RoiTrendChart from "../components/RoiTrendChart.jsx";

function money(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function num(n) {
  return (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function BigStat({ label, value, sub, accent }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gradient-to-b from-gray-900 to-gray-900/40 p-6 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <p
        className={`mt-2 text-4xl font-extrabold tracking-tight ${
          accent || "text-amber-400"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-800 py-2.5 last:border-0">
      <span className="text-sm text-gray-300">{label}</span>
      <span className="text-sm font-semibold text-gray-100">{value}</span>
    </div>
  );
}

export default function RoiDashboard({ brandId }) {
  const [roi, setRoi] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [report, setReport] = useState("");
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState("");

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const [roiRes, histRes] = await Promise.all([
        api.getRoi(brandId),
        api.getRoiHistory(brandId),
      ]);
      setRoi(roiRes.roi);
      setHistory(histRes.history || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setRoi(null);
    setHistory([]);
    setReport("");
    setReportError("");
    load();
  }, [load]);

  async function handleGenerateReport() {
    setReporting(true);
    setReportError("");
    try {
      const data = await api.generateRoiReport(brandId);
      setReport(data.report || "");
      if (data.roi) setRoi(data.roi);
    } catch (err) {
      setReportError(err.message);
    } finally {
      setReporting(false);
    }
  }

  function handleDownloadPdf() {
    if (!report) return;
    const esc = (s) =>
      String(s).replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
    const title = `EchoAI ROI Report — ${esc(roi?.brandName || "Your Business")}`;
    const date = new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const paragraphs = report
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/\n/g, "<br/>").replace(/</g, "&lt;")}</p>`)
      .join("");
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"/>
      <title>${title}</title>
      <style>
        body{font-family:Georgia,'Times New Roman',serif;max-width:680px;margin:48px auto;padding:0 24px;color:#1a1a1a;line-height:1.6;}
        h1{font-size:22px;margin-bottom:4px;color:#b45309;}
        .meta{color:#666;font-size:13px;margin-bottom:28px;}
        p{margin:0 0 14px;font-size:15px;}
        .stats{display:flex;gap:16px;flex-wrap:wrap;margin:0 0 28px;}
        .stat{flex:1;min-width:120px;border:1px solid #eee;border-radius:10px;padding:12px;}
        .stat b{display:block;font-size:20px;color:#b45309;}
        .stat span{font-size:11px;color:#777;text-transform:uppercase;letter-spacing:.04em;}
      </style></head><body>
      <h1>${title}</h1>
      <div class="meta">${date}</div>
      <div class="stats">
        <div class="stat"><b>${money(roi?.headline?.totalValueGenerated)}</b><span>Value generated</span></div>
        <div class="stat"><b>${num(roi?.headline?.hoursSaved)}</b><span>Hours saved</span></div>
        <div class="stat"><b>${money(roi?.headline?.moneySaved)}</b><span>Money saved</span></div>
        <div class="stat"><b>${num(roi?.headline?.roiPercent)}%</b><span>ROI</span></div>
      </div>
      ${paragraphs}
      <script>window.onload=function(){window.print();}</script>
      </body></html>`);
    w.document.close();
  }

  if (!brandId)
    return (
      <p className="text-sm text-gray-400">
        Select or create a brand to see your ROI.
      </p>
    );
  if (loading) return <Spinner label="Calculating your ROI…" />;

  const h = roi?.headline || {};
  const leads = roi?.leads || {};
  const campaigns = roi?.campaigns || {};
  const social = roi?.social || {};
  const email = roi?.email || {};
  const automation = roi?.automation || {};

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-100">Your ROI</h2>
        <p className="mt-1 text-sm text-gray-400">
          Exactly how much value EchoAI is delivering for{" "}
          {roi?.brandName || "your business"}.
        </p>
      </div>

      <ErrorBanner message={error} />

      {roi && (
        <>
          {/* Headline ROI summary */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <BigStat
              label="Value generated"
              value={money(h.totalValueGenerated)}
              sub="Lead value + labor saved"
            />
            <BigStat
              label="Hours saved"
              value={num(h.hoursSaved)}
              sub="Across automated tasks"
              accent="text-green-400"
            />
            <BigStat
              label="Money saved"
              value={money(h.moneySaved)}
              sub="vs. hiring an agency / in-house"
              accent="text-green-400"
            />
            <BigStat
              label="Return on investment"
              value={h.roiPercent != null ? `${num(h.roiPercent)}%` : "—"}
              sub={`On ${money(roi.subscription?.monthlyPrice)}/mo plan`}
            />
          </div>

          {/* 12-week trend */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
            <h3 className="mb-1 text-sm font-semibold text-gray-200">
              12-week ROI trend
            </h3>
            <p className="mb-4 text-xs text-gray-500">
              Estimated value generated each week since you joined EchoAI.
            </p>
            <RoiTrendChart data={history} />
          </div>

          {/* Detailed breakdown */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-gray-200">
                Leads generated
              </h3>
              <Row label="Total leads" value={num(leads.total)} />
              <Row label="Hot / sales-ready leads" value={num(leads.hot)} />
              <Row
                label="Estimated lead value"
                value={money(leads.estimatedValue)}
              />
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-gray-200">
                Ad campaigns
              </h3>
              <Row label="Campaigns run" value={num(campaigns.count)} />
              <Row
                label="Ad spend managed"
                value={money(campaigns.adSpendManaged)}
              />
              <Row
                label="Avg. cost per lead"
                value={
                  campaigns.avgCostPerLead != null
                    ? money(campaigns.avgCostPerLead)
                    : "—"
                }
              />
              <Row
                label="Cost-per-lead improvement"
                value={
                  campaigns.costPerLeadImprovementPct != null
                    ? `${num(campaigns.costPerLeadImprovementPct)}%`
                    : "—"
                }
              />
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-gray-200">
                Content published
              </h3>
              <Row
                label="Social posts published"
                value={num(social.postsPublished)}
              />
              <Row
                label="Estimated social reach"
                value={num(social.estimatedReach)}
              />
              <Row label="Emails sent" value={num(email.sent)} />
              <Row
                label="Email open rate"
                value={email.openRate != null ? `${num(email.openRate)}%` : "—"}
              />
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-gray-200">
                Time saved by task
              </h3>
              {(automation.breakdown || []).map((b) => (
                <Row
                  key={b.task}
                  label={b.task}
                  value={`${num(b.hours)} hrs`}
                />
              ))}
            </div>
          </div>

          {/* How we calculate this */}
          <p className="text-xs text-gray-600">
            Value figures use industry-average estimates (lead value{" "}
            {money(roi.assumptions?.leadValue)}/{money(roi.assumptions?.hotLeadValue)}{" "}
            hot, labor at {money(roi.assumptions?.hourlyRate)}/hr) applied to your
            real platform activity.
          </p>

          {/* Monthly AI report */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-200">
                  Monthly ROI report
                </h3>
                <p className="text-xs text-gray-500">
                  A personalized summary of what EchoAI did for you this month.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleGenerateReport}
                  disabled={reporting}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
                >
                  {reporting
                    ? "Writing…"
                    : report
                      ? "Regenerate"
                      : "Generate Monthly Report"}
                </button>
                {report && (
                  <button
                    onClick={handleDownloadPdf}
                    className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800"
                  >
                    Download PDF
                  </button>
                )}
              </div>
            </div>

            <ErrorBanner message={reportError} />

            {report && (
              <div className="mt-4 space-y-3 rounded-lg border border-gray-800 bg-gray-950/40 p-4 text-sm leading-relaxed text-gray-200">
                {report.split(/\n{2,}/).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
