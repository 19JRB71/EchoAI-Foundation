-- ============================================================================
-- Migration 023: AI Sales Script Generator
--
-- Adds:
--   - sales_scripts: brand-scoped saved sales scripts. The full generated script
--     (opening, discovery questions, pitch, objection handling, closing
--     techniques, follow-up sequence) is stored as JSONB in script_content.
--
-- Idempotent: safe to re-run (IF NOT EXISTS / guarded). set_updated_at() is
-- defined in schema.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sales_scripts (
    script_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id       UUID NOT NULL REFERENCES brands (brand_id) ON DELETE CASCADE,
    sale_type      VARCHAR(40) NOT NULL,
    target_persona TEXT NOT NULL,
    script_content JSONB NOT NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'active')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_scripts_brand_id
    ON sales_scripts (brand_id, created_at DESC);

-- updated_at trigger (set_updated_at() defined in schema.sql)
DROP TRIGGER IF EXISTS trg_sales_scripts_updated_at ON sales_scripts;
CREATE TRIGGER trg_sales_scripts_updated_at BEFORE UPDATE ON sales_scripts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
