-- Migration 005: Lead conversion interaction type
-- Adds a 'conversion' value to the interaction_type enum so that converting a
-- lead can be logged in the crm_interactions table.
--
-- Note: ALTER TYPE ... ADD VALUE cannot run inside a transaction block in older
-- PostgreSQL versions. Run this statement on its own.

ALTER TYPE interaction_type ADD VALUE IF NOT EXISTS 'conversion';
