import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

const THREAT_STYLES = {
  aggressive: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  watch: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  none: "bg-gray-600/20 text-gray-300 border-gray-600/40",
};
const THREAT_LABELS = {
  aggressive: "Aggressive",
  watch: "Watch",
  none: "Routine",
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

export default function CompetitorAds({ brandId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [firstLoaded, setFirstLoaded] = useState(false);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState("");
  const [generating, setGenerating] = useState(false);
  const [counter, setCounter] = useState(null); // { adId, package }
  const [counteringId, setCounteringId] = useState("");

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.getCompetitorAdFeed(brandId);
      setData(res);
    } catch (err) {
      setError(err.message || "Failed to load competitor ads.");
    } finally {
      setLoading(false);
      setFirstLoaded(true);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError("");
    setNotice("");
    try {
      const res = await api.scanCompetitorAds(brandId);
      if (!res.available) {
        setNotice(
          "Facebook Ad Library isn't connected yet, so there are no live ads to pull. Ask your admin to add a Facebook access token to enable this.",
        );
      } else if (res.competitors === 0) {
        setNotice(
          "No confirmed competitors yet. Confirm competitors in Scout's Customer Intelligence first, then Scout can watch their ads.",
        );
      } else {
        setNotice(
          `Scan complete — checked ${res.competitors} competitor(s), found ${res.newAds} new ad(s).`,
        );
      }
      await load();
    } catch (err) {
      setError(err.message || "Failed to scan competitor ads.");
    } finally {
      setScanning(false);
    }
  };

  const genReport = async () => {
    setGenerating(true);
    setError("");
    setNotice("");
    try {
      const res = await api.generateCompetitorAdReport(brandId);
      setData((prev) => ({ ...(prev || {}), report: res.report }));
      setNotice("This week's ad intelligence report is ready.");
    } catch (err) {
      setError(err.message || "Failed to generate the report.");
    } finally {
      setGenerating(false);
    }
  };

  const draftCounter = async (adId) => {
    setCounteringId(adId);
    setError("");
    try {
      const res = await api.draftCompetitorCounter(brandId, adId);
      setCounter({ adId, package: res.counter });
    } catch (err) {
      setError(err.message || "Failed to draft the counter campaign.");
    } finally {
      setCounteringId("");
    }
  };

  if (!brandId) {
    return (
      <p className="text-sm text-gray-400">
        Select or create a brand to see its competitor ads.
      </p>
    );
  }

  const report = data && data.report;
  const groups = (data && data.competitors) || [];
  const connected = data ? data.connected : true;
  const confirmedCount = data ? data.confirmedCompetitors : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-100">Competitor Ads</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-400">
            Scout watches every confirmed competitor's live Facebook ads, flags
            aggressive new ads, and writes a weekly ad intelligence report. Ad
            snapshots link to Facebook's Ad Library — always open the snapshot to
            verify the live ad.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={runScan}
            disabled={scanning}
            className="rounded-lg bg-sky-500 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
          >
            {scanning ? "Scanning…" : "Scan now"}
          </button>
          <button
            type="button"
            onClick={genReport}
            disabled={generating}
            className="rounded-lg border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"
          >
            {generating ? "Analyzing…" : "Generate report"}
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {notice && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
          {notice}
        </div>
      )}

      {!connected && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Facebook Ad Library isn't connected, so no live ads can be pulled yet.
          This feature shows real ads only — nothing is made up.
        </div>
      )}

      {loading && !firstLoaded ? (
        <Spinner />
      ) : (
        <>
          {/* Weekly report */}
          {report ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                  Weekly ad intelligence — week of {fmtDate(report.weekDate)}
                </h3>
              </div>
              <p className="mt-2 text-sm text-gray-200">{report.summary}</p>

              {report.topAds && report.topAds.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Top competitor ads
                  </h4>
                  <ul className="mt-2 space-y-2">
                    {report.topAds.map((a, i) => (
                      <li key={i} className="rounded-lg bg-gray-800/50 p-3 text-sm">
                        <span className="font-semibold text-gray-100">
                          {a.competitor}
                        </span>
                        {a.headline && (
                          <span className="text-gray-300"> — {a.headline}</span>
                        )}
                        {a.whyWorking && (
                          <p className="mt-1 text-xs text-gray-400">{a.whyWorking}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {report.gaps && report.gaps.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Gaps &amp; openings
                  </h4>
                  <ul className="mt-2 space-y-2">
                    {report.gaps.map((g, i) => (
                      <li key={i} className="rounded-lg bg-gray-800/50 p-3 text-sm">
                        <span className="font-semibold text-gray-100">{g.gap}</span>
                        {g.opportunity && (
                          <p className="mt-1 text-xs text-gray-400">{g.opportunity}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {report.recommendations && report.recommendations.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Scout's recommendations
                  </h4>
                  <ul className="mt-2 space-y-2">
                    {report.recommendations.map((r, i) => (
                      <li
                        key={i}
                        className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-sm"
                      >
                        <span className="font-semibold text-sky-200">{r.title}</span>
                        {r.detail && (
                          <p className="mt-1 text-xs text-gray-300">{r.detail}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-800 p-4 text-sm text-gray-400">
              No weekly report yet. Once Scout has pulled some competitor ads,
              click <span className="font-semibold text-gray-200">Generate report</span>{" "}
              for this week's ad intelligence.
            </div>
          )}

          {/* Live feed grouped by competitor */}
          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
              Live competitor ads{" "}
              <span className="text-gray-600">
                ({(data && data.totalAds) || 0} active · {confirmedCount} confirmed
                competitor{confirmedCount === 1 ? "" : "s"})
              </span>
            </h3>

            {groups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-800 p-4 text-sm text-gray-400">
                No competitor ads recorded yet.{" "}
                {confirmedCount === 0
                  ? "Confirm competitors in Scout's Customer Intelligence first, then run a scan."
                  : "Click Scan now to pull each confirmed competitor's live ads."}
              </div>
            ) : (
              <div className="space-y-5">
                {groups.map((group) => (
                  <div
                    key={group.competitor}
                    className="rounded-xl border border-gray-800 bg-gray-900/40 p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-sm font-bold text-gray-100">
                        {group.competitor}
                      </h4>
                      <span className="text-xs text-gray-500">
                        {group.ads.length} ad{group.ads.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {group.ads.map((ad) => (
                        <AdCard
                          key={ad.adId}
                          ad={ad}
                          onCounter={() => draftCounter(ad.adId)}
                          countering={counteringId === ad.adId}
                          counter={
                            counter && counter.adId === ad.adId ? counter.package : null
                          }
                          onCloseCounter={() => setCounter(null)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AdCard({ ad, onCounter, countering, counter, onCloseCounter }) {
  const threat = ad.threatLevel || "none";
  return (
    <div className="flex flex-col rounded-lg border border-gray-800 bg-gray-800/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Badge className={THREAT_STYLES[threat] || THREAT_STYLES.none}>
          {THREAT_LABELS[threat] || "Routine"}
        </Badge>
        {ad.daysRunning != null && (
          <span className="text-[11px] text-gray-500">
            Running {ad.daysRunning} day{ad.daysRunning === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {ad.headline && (
        <p className="text-sm font-semibold text-gray-100">{ad.headline}</p>
      )}
      {ad.body && (
        <p className="mt-1 line-clamp-4 text-xs text-gray-400">{ad.body}</p>
      )}
      {ad.threatReason && threat !== "none" && (
        <p className="mt-2 text-xs italic text-amber-300/80">{ad.threatReason}</p>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        {(ad.platforms || []).map((p) => (
          <span
            key={p}
            className="rounded bg-gray-700/50 px-1.5 py-0.5 text-[10px] uppercase text-gray-300"
          >
            {p}
          </span>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3 text-xs">
        {ad.snapshotUrl && (
          <a
            href={ad.snapshotUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-sky-300 hover:text-sky-200"
          >
            View on Facebook →
          </a>
        )}
        <button
          type="button"
          onClick={onCounter}
          disabled={countering}
          className="ml-auto rounded border border-gray-700 px-2 py-1 font-semibold text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          {countering ? "Drafting…" : "Draft counter ad"}
        </button>
      </div>

      {counter && (
        <div className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wide text-sky-200">
              Your counter ad
            </span>
            <button
              type="button"
              onClick={onCloseCounter}
              className="text-gray-500 hover:text-gray-300"
            >
              ✕
            </button>
          </div>
          {counter.angle && (
            <p className="text-gray-400">
              <span className="font-semibold text-gray-300">Angle:</span>{" "}
              {counter.angle}
            </p>
          )}
          <p className="mt-1 text-sm font-semibold text-gray-100">
            {counter.headline}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-gray-300">
            {counter.primaryText}
          </p>
          {counter.cta && (
            <p className="mt-1 text-gray-400">
              <span className="font-semibold text-gray-300">CTA:</span> {counter.cta}
            </p>
          )}
          {counter.rationale && (
            <p className="mt-2 text-[11px] italic text-gray-500">
              {counter.rationale}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
