-- Migration 006: Weekly report CRM logging
-- A weekly report is sent to the business owner, not to a lead, so the
-- crm_interactions table needs to support brand-scoped (lead-less) entries.
--
-- Note: ALTER TYPE ... ADD VALUE cannot run inside a transaction block in older
-- PostgreSQL versions. Run these statements on their own (no surrounding BEGIN).

-- New interaction type for "weekly report sent" events.
ALTER TYPE interaction_type ADD VALUE IF NOT EXISTS 'weekly_report';

-- Allow interactions that aren't tied to a specific lead (e.g. owner reports).
ALTER TABLE crm_interactions ALTER COLUMN lead_id DROP NOT NULL;

-- Associate an interaction with a brand (used by weekly report logs).
ALTER TABLE crm_interactions
    ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands (brand_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_crm_interactions_brand_id ON crm_interactions (brand_id);
