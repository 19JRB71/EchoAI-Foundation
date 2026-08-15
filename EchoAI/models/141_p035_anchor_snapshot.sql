-- Prompt 035 Stage 2 (Section G / O item 1): structured anchor history per
-- research step. Every material research run preserves the exact set of
-- identity anchors Sage knew when the investigation ran — immutable
-- "what Sage knew when" evidence. Terminal rows remain immutable/superseded;
-- this column is written once at claim time and never rewritten.
--
-- ADDITIVE ONLY. No provenance taxonomy change.

ALTER TABLE sage_research_drafts
  ADD COLUMN IF NOT EXISTS anchor_snapshot JSONB;
