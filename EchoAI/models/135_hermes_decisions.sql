-- Hermes decision telemetry (Prompt 021, Owner Addendum §11 + Stage-2 §2/§4/§5).
--
-- One durable row per COMPLETED Hermes decision classification. Written by
-- utils/hermesMetrics.recordHermesDecision at the moment the calling wrapper
-- finishes classifying the outcome — never before (a crash mid-call leaves NO
-- row; there is no "invocation started" write, so a half-counted invocation is
-- impossible). The unique invocation_id (generated once per invocation in the
-- wrapper) guarantees at most one row per invocation even if a caller ever
-- double-fires the recorder (ON CONFLICT DO NOTHING — no silent regeneration).
--
-- Outcomes (fixed vocabulary — Owner Stage-2 §2):
--   non_null   — Hermes was invoked and returned a usable decision payload.
--   null       — Hermes replied but the wrapper's parse/validation yielded null.
--   error      — the call failed with a non-timeout error (after retry policy).
--   timeout    — the per-attempt timeout elapsed (AbortError).
--   suppressed — Hermes was NOT invoked (unconfigured, or the AI admission
--                gate rejected before any request). Reported alongside but
--                NEVER part of the non-null-rate denominator.
--
-- This table is measurement-only: nothing reads it back as operational state.
CREATE TABLE IF NOT EXISTS hermes_decisions (
  decision_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invocation_id TEXT NOT NULL UNIQUE,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  environment   TEXT NOT NULL,
  feature       TEXT NOT NULL,
  brand_id      UUID,
  outcome       TEXT NOT NULL
                CHECK (outcome IN ('non_null', 'null', 'error', 'timeout', 'suppressed')),
  latency_ms    INTEGER
);

-- Window scans (48-hour measurement, dashboard tile).
CREATE INDEX IF NOT EXISTS idx_hermes_decisions_at ON hermes_decisions (at);
CREATE INDEX IF NOT EXISTS idx_hermes_decisions_outcome_at ON hermes_decisions (outcome, at);
