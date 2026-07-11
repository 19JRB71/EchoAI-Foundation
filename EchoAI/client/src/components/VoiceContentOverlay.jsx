import { useEffect, useState } from "react";

// On-screen companion panel for the hands-free content creation session
// ("Hey Echo, let's create some content"). The voice engine broadcasts the
// live session snapshot via the `echoai:content-session` window event; this
// overlay mirrors what Echo is talking through — the current draft's platform,
// text, visual (once created), and proposed schedule slot — so James can READ
// the post while Echo reads it aloud. Purely presentational: every decision
// (approve / revise / visual / skip) happens by voice.
const PLATFORM_LABELS = {
  facebook: "Facebook",
  twitter: "X (Twitter)",
  linkedin: "LinkedIn",
};

function formatWhen(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function VoiceContentOverlay() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    const onSession = (e) => setSession(e.detail || null);
    window.addEventListener("echoai:content-session", onSession);
    return () =>
      window.removeEventListener("echoai:content-session", onSession);
  }, []);

  if (!session || session.phase !== "review") return null;
  const drafts = Array.isArray(session.drafts) ? session.drafts : [];
  const draft = drafts[session.index];
  if (!draft) return null;

  const when = formatWhen(draft.scheduledTime);
  const platform =
    PLATFORM_LABELS[draft.platform] || draft.platform || "Social";

  return (
    <div
      style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        width: 360,
        maxWidth: "calc(100vw - 48px)",
        maxHeight: "70vh",
        overflowY: "auto",
        background: "#101426",
        border: "1px solid rgba(124, 140, 255, 0.35)",
        borderRadius: 16,
        boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        color: "#e8eaf6",
        zIndex: 1400,
        padding: 18,
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <span style={{ fontWeight: 700, color: "#9fa8ff" }}>
          Draft {session.index + 1} of {drafts.length}
        </span>
        <span
          style={{
            fontSize: 12,
            padding: "2px 10px",
            borderRadius: 999,
            background: "rgba(124,140,255,0.15)",
            color: "#b9c1ff",
          }}
        >
          {platform}
        </span>
      </div>
      {draft.imageUrl ? (
        <img
          src={draft.imageUrl}
          alt="Post visual"
          style={{
            width: "100%",
            borderRadius: 10,
            marginBottom: 10,
            display: "block",
          }}
        />
      ) : null}
      <div style={{ whiteSpace: "pre-wrap", marginBottom: 10 }}>
        {typeof draft.postContent === "string" ? draft.postContent : ""}
      </div>
      {when ? (
        <div style={{ fontSize: 12, color: "#8f96b3", marginBottom: 8 }}>
          Proposed time: {when}
        </div>
      ) : null}
      <div style={{ fontSize: 12, color: "#6f7690" }}>
        Say “approve”, a change you want, “create the visual”, “skip it”, or
        “that&apos;s all”.
      </div>
    </div>
  );
}
