import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

const TABS = [
  { key: "knowledge", label: "Visual Knowledge Base" },
  { key: "activity", label: "Study Activity" },
];

const SECTION_LABELS = {
  structural_standards: "Structural accuracy — what it must actually look like",
  composition: "Composition that converts",
  lighting: "Lighting",
  color_palettes: "Color palettes",
  seasonal_trends: "Seasonal trends",
  customer_emotions: "Emotions winning imagery evokes",
  market_observations: "Observed in the market (from real data)",
  avoid: "Avoid — dated or low-converting styles",
};

function fmtDateTime(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return String(d);
  }
}

function sourceCountLine(sources) {
  if (!sources || typeof sources !== "object") return null;
  const parts = Object.entries(sources).map(([key, count]) => {
    const label =
      key === "competitor_facebook_ads"
        ? "competitor ads"
        : key === "brand_image_library"
          ? "your images"
          : key === "brand_reference_photos"
            ? "your reference photos"
            : key.replace(/_/g, " ");
    return count === null ? `${label}: unavailable` : `${label}: ${count}`;
  });
  return parts.length ? parts.join(" · ") : null;
}

function ConfidenceBar({ value }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-800">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${v}%`, backgroundColor: "#0EA5E9" }}
        />
      </div>
      <span className="text-sm font-semibold text-sky-300">{v}%</span>
    </div>
  );
}

function ReferenceLibrary({ brandId }) {
  const [photos, setPhotos] = useState([]);
  const [limit, setLimit] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState("");
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const d = await api.getVisionReferencePhotos(brandId);
      setPhotos(d.photos || []);
      if (d.limit) setLimit(d.limit);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

  const uploadFiles = useCallback(
    async (files) => {
      const images = Array.from(files || []).filter((f) =>
        ACCEPTED.includes(f.type)
      );
      if (!images.length) return;
      setUploading(true);
      setError("");
      try {
        for (const file of images) {
          await api.uploadVisionReferencePhoto(
            brandId,
            file,
            captionRef.current.trim()
          );
        }
        setCaption("");
        await load();
      } catch (err) {
        setError(err.message);
        await load();
      } finally {
        setUploading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [brandId, load]
  );

  // Keep the latest caption available to the paste listener without
  // re-registering it on every keystroke.
  const captionRef = useRef("");
  captionRef.current = caption;

  const onUpload = (e) => {
    const files = e.target.files;
    uploadFiles(files);
    e.target.value = "";
  };

  // Paste support: copy an image anywhere (web page, screenshot, Photos) and
  // Ctrl/Cmd+V while on this page — it uploads straight into the library.
  useEffect(() => {
    const onPaste = (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const files = [];
      for (const item of items) {
        if (item.kind === "file" && ACCEPTED.includes(item.type)) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      // Only hijack the paste when it actually contains an image. Plain text
      // pastes (e.g. into the caption field) are left alone — so pasting a
      // picture works no matter where the cursor is on this page.
      if (files.length) {
        e.preventDefault();
        uploadFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadFiles]);

  // Drag-and-drop support: drop photos anywhere on the card.
  const [dragOver, setDragOver] = useState(false);
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    uploadFiles(e.dataTransfer && e.dataTransfer.files);
  };

  const onDelete = async (imageId) => {
    setError("");
    try {
      await api.deleteVisionReferencePhoto(brandId, imageId);
      setPhotos((p) => p.filter((x) => x.image_id !== imageId));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`rounded-xl border bg-gray-900/60 p-5 transition ${
        dragOver ? "border-sky-500 bg-sky-500/10" : "border-gray-800"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">Reference Library</h3>
          <p className="mt-1 text-sm text-gray-400">
            Add real photos of your products or completed work. Vision
            actually looks at them during every study, so Forge&apos;s images
            match your real business — materials, proportions, colors, quality.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={onUpload}
          />
          <button
            onClick={() => fileRef.current && fileRef.current.click()}
            disabled={uploading || photos.length >= limit}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload photos"}
          </button>
        </div>
      </div>
      <input
        type="text"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        maxLength={300}
        placeholder="Optional note for the next photo (e.g. “finished 40×60 barn, spring 2026”)"
        className="mt-3 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-sky-500 focus:outline-none"
      />
      <p className="mt-1 text-xs text-gray-500">
        Quickest way: copy any image, then press{" "}
        <span className="font-semibold text-gray-400">Ctrl+V</span> (or Cmd+V)
        right here — or drag photos onto this card. JPG, PNG, or WEBP · up to 5
        MB each · {photos.length}/{limit} photos. Vision studies your 10 newest
        photos each run.
      </p>

      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}

      {loading ? (
        <div className="mt-4">
          <Spinner />
        </div>
      ) : photos.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          No reference photos yet. Real photos of your own work are the most
          powerful thing you can give Vision.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {photos.map((p) => (
            <div
              key={p.image_id}
              className="group relative overflow-hidden rounded-lg border border-gray-800 bg-gray-950"
            >
              <img
                src={p.file_path}
                alt={p.caption || p.original_name}
                className="h-32 w-full object-cover"
                loading="lazy"
              />
              <button
                onClick={() => onDelete(p.image_id)}
                title="Delete photo"
                className="absolute right-1.5 top-1.5 rounded-md bg-black/70 px-2 py-0.5 text-xs font-semibold text-red-300 opacity-0 transition group-hover:opacity-100"
              >
                Delete
              </button>
              {(p.caption || p.original_name) && (
                <p className="truncate px-2 py-1.5 text-xs text-gray-400">
                  {p.caption || p.original_name}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KnowledgeTab({ brandId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [studying, setStudying] = useState(false);
  const [studyNote, setStudyNote] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const d = await api.getVisionOverview(brandId);
      setData(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    setLoading(true);
    setStudyNote("");
    load();
  }, [load]);

  const studyNow = async () => {
    setStudying(true);
    setStudyNote("");
    setError("");
    try {
      const out = await api.runVisionStudy(brandId);
      setStudyNote(out.summary || "Study completed.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setStudying(false);
    }
  };

  if (loading) return <Spinner />;

  const k = data?.knowledge || null;
  const sections = k?.sections || {};

  return (
    <div className="space-y-6">
      {error && <ErrorBanner message={error} />}

      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-white">
              {data?.industry
                ? `Visual intelligence for ${data.industry}`
                : "Visual intelligence"}
            </h3>
            <p className="mt-1 text-sm text-gray-400">
              {k
                ? `Knowledge version ${k.version} · last studied ${fmtDateTime(k.lastStudiedAt)}`
                : "Vision hasn't studied this business yet. Run the first study, or wait for tonight's automatic one."}
            </p>
          </div>
          <button
            onClick={studyNow}
            disabled={studying}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {studying ? "Studying…" : "Study now"}
          </button>
        </div>
        {k && (
          <div className="mt-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Confidence
            </p>
            <ConfidenceBar value={k.confidence} />
          </div>
        )}
        {studyNote && (
          <p className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-200">
            {studyNote}
          </p>
        )}
        {k && sourceCountLine(k.sourcesStudied) && (
          <p className="mt-3 text-xs text-gray-500">
            Last study drew on — {sourceCountLine(k.sourcesStudied)}
          </p>
        )}
      </div>

      <ReferenceLibrary brandId={brandId} />

      {/* Honest source disclosure */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          What Vision studies
        </p>
        <ul className="mt-2 space-y-1 text-sm text-gray-400">
          {(data?.sources || []).map((s) => (
            <li key={s.key}>• {s.label}</li>
          ))}
          <li>
            • Claude&apos;s built-in expertise about your industry&apos;s visual
            standards (labeled as expert knowledge, not observed data)
          </li>
        </ul>
        <p className="mt-2 text-xs text-gray-500">
          Vision only learns principles — proportions, composition, lighting,
          trends. It never copies another company&apos;s artwork, logos, or
          watermarks.
        </p>
      </div>

      {k ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(SECTION_LABELS).map(([key, label]) => {
            const items = Array.isArray(sections[key]) ? sections[key] : [];
            if (!items.length) return null;
            return (
              <div
                key={key}
                className="rounded-xl border border-gray-800 bg-gray-900/60 p-4"
              >
                <h4 className="text-sm font-semibold text-sky-300">{label}</h4>
                <ul className="mt-2 space-y-1.5">
                  {items.map((item, i) => (
                    <li key={i} className="text-sm leading-snug text-gray-300">
                      • {item}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          How Vision helps Forge
        </p>
        <p className="mt-2 text-sm text-gray-400">
          Forge consults Vision before every image and ad creative it makes.
          {data?.forgeImpact
            ? ` So far: ${data.forgeImpact.totalConsultations} consultation${data.forgeImpact.totalConsultations === 1 ? "" : "s"} (${data.forgeImpact.consultationsThisWeek} this week).`
            : ""}
        </p>
      </div>
    </div>
  );
}

function ActivityTab({ brandId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    api
      .getVisionActivity(brandId)
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [brandId]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} />;

  const runs = data?.runs || [];
  const consults = data?.consultations || [];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Study runs
        </h3>
        {runs.length === 0 ? (
          <p className="text-sm text-gray-500">
            No study runs yet. Vision studies every business automatically each
            night.
          </p>
        ) : (
          <div className="space-y-3">
            {runs.map((r, i) => (
              <div
                key={i}
                className="rounded-xl border border-gray-800 bg-gray-900/60 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-sm font-semibold ${
                      r.status === "completed"
                        ? "text-emerald-300"
                        : r.status === "failed"
                          ? "text-red-300"
                          : "text-amber-300"
                    }`}
                  >
                    {r.status === "completed"
                      ? "Completed"
                      : r.status === "failed"
                        ? "Failed"
                        : "Running"}
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      {r.trigger === "manual" ? "manual" : "scheduled"}
                    </span>
                  </span>
                  <span className="text-xs text-gray-500">
                    {fmtDateTime(r.started_at)}
                  </span>
                </div>
                {r.summary && (
                  <p className="mt-2 text-sm text-gray-300">{r.summary}</p>
                )}
                {r.error && (
                  <p className="mt-2 text-sm text-red-300">{r.error}</p>
                )}
                {sourceCountLine(r.sources) && (
                  <p className="mt-2 text-xs text-gray-500">
                    Sources — {sourceCountLine(r.sources)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Forge consultations
        </h3>
        {consults.length === 0 ? (
          <p className="text-sm text-gray-500">
            No consultations yet. Every time Forge creates an image or ad
            creative, it checks with Vision first — those checks appear here.
          </p>
        ) : (
          <div className="space-y-3">
            {consults.map((c, i) => (
              <div
                key={i}
                className="rounded-xl border border-gray-800 bg-gray-900/60 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-sky-300">
                    {c.requester === "forge_ad_studio"
                      ? "Ad Creative Studio"
                      : "Image Studio"}
                  </span>
                  <span className="text-xs text-gray-500">
                    {fmtDateTime(c.created_at)}
                  </span>
                </div>
                {c.request_summary && (
                  <p className="mt-2 text-sm text-gray-300">
                    {c.request_summary}
                  </p>
                )}
                {c.knowledge_version != null && (
                  <p className="mt-1 text-xs text-gray-500">
                    Used knowledge v{c.knowledge_version}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Vision({ brandId, initialTab }) {
  const [tab, setTab] = useState(initialTab || "knowledge");

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  if (!brandId) {
    return (
      <p className="text-sm text-gray-400">
        Select or create a business to see Vision&apos;s visual intelligence.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ backgroundColor: "#0EA5E9" }}
          >
            V
          </span>
          <h2 className="text-xl font-bold text-white">
            Vision · Visual Intelligence
          </h2>
        </div>
        <p className="mt-1 text-sm text-gray-400">
          Vision studies your industry&apos;s visual landscape so every image
          Forge creates looks real, professional, and on-trend — always
          completely original.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === t.key
                ? "bg-sky-600 text-white"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "knowledge" && <KnowledgeTab brandId={brandId} />}
      {tab === "activity" && <ActivityTab brandId={brandId} />}
    </div>
  );
}
