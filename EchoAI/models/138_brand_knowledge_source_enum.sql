-- 138: Correct the closed provenance source enum to the authorized vocabulary
-- (Prompt 011 Stage 2, Section A3): website, facebook, public_web, inferred,
-- stated, connected. Migration 137 shipped with a different draft vocabulary
-- ('document', 'social_profile', 'imported'), which rejects real Prompt-022
-- research drafts whose sources are tagged 'public_web'.
--
-- Safe to tighten: at the time this migration ships the only source_kind in
-- live data is 'stated', which remains in the enum. Idempotent.

DO $$
BEGIN
  -- brand_knowledge_versions.source_kind
  ALTER TABLE brand_knowledge_versions
    DROP CONSTRAINT IF EXISTS brand_knowledge_versions_source_kind_check;
  ALTER TABLE brand_knowledge_versions
    ADD CONSTRAINT brand_knowledge_versions_source_kind_check
    CHECK (source_kind IN (
      'website', 'facebook', 'public_web', 'inferred', 'stated', 'connected'
    ));

  -- brand_knowledge_revisions.source_kind
  ALTER TABLE brand_knowledge_revisions
    DROP CONSTRAINT IF EXISTS brand_knowledge_revisions_source_kind_check;
  ALTER TABLE brand_knowledge_revisions
    ADD CONSTRAINT brand_knowledge_revisions_source_kind_check
    CHECK (source_kind IN (
      'website', 'facebook', 'public_web', 'inferred', 'stated', 'connected'
    ));
END $$;
