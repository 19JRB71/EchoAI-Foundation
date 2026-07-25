-- Migration 046: AI Health Monitor + Screenshot Support System
--
-- health_checks: one row per health check run for a brand (hourly scheduler or
-- on-demand). Stores the raw issues found, what was auto-fixed silently, what
-- still needs the owner's attention, and the AI Health Analyst's plain-English
-- write-up. overall_status drives the colored dot in the top nav.
--
-- support_tickets: one row per screenshot-support submission. Stores the (disk-
-- persisted) screenshot URL, the user's description, and the AI Screenshot
-- Support agent's analysis. user_id/brand_id are nullable so the public help
-- widget (login screen) can file a ticket before the user is authenticated.

CREATE TABLE IF NOT EXISTS health_checks (
  check_id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id                    UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
  check_time                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  overall_status              VARCHAR(20) NOT NULL DEFAULT 'healthy',
  issues_found                JSONB NOT NULL DEFAULT '[]'::jsonb,
  issues_auto_fixed           JSONB NOT NULL DEFAULT '[]'::jsonb,
  issues_requiring_attention  JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_analysis                 TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_checks_brand_id ON health_checks (brand_id);
CREATE INDEX IF NOT EXISTS idx_health_checks_brand_time
  ON health_checks (brand_id, check_time DESC);

DROP TRIGGER IF EXISTS trg_health_checks_updated_at ON health_checks;
CREATE TRIGGER trg_health_checks_updated_at BEFORE UPDATE ON health_checks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS support_tickets (
  ticket_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID REFERENCES users (user_id) ON DELETE SET NULL,
  brand_id           UUID REFERENCES brands (brand_id) ON DELETE SET NULL,
  screenshot_url     TEXT,
  user_description   TEXT,
  ai_analysis        JSONB,
  resolution_status  VARCHAR(20) NOT NULL DEFAULT 'open',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON support_tickets (user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_brand_id ON support_tickets (brand_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets (resolution_status);

DROP TRIGGER IF EXISTS trg_support_tickets_updated_at ON support_tickets;
CREATE TRIGGER trg_support_tickets_updated_at BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
