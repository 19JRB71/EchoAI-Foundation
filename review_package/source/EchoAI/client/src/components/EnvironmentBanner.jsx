import React, { useEffect, useState } from "react";

/**
 * Slim fixed banner shown ONLY when the server reports a "staging" environment
 * (from /api/health). Production and development render nothing. This is the
 * visual guard against mistaking the staging site for the live one.
 *
 * Fails silent by design: if the health check errors, no banner is shown —
 * the banner is an aid, never a gate.
 */
export default function EnvironmentBanner() {
  const [environment, setEnvironment] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.environment === "string") {
          setEnvironment(data.environment);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (environment !== "staging") return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        background: "#b45309",
        color: "#fff",
        textAlign: "center",
        fontSize: "12px",
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        padding: "3px 8px",
        pointerEvents: "none",
      }}
    >
      Staging environment — test data only
    </div>
  );
}
