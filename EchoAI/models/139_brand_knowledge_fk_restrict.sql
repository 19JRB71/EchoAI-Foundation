-- Prompt 011 corrective FIX 1: immutable version history must survive user
-- deletion attempts.
--
-- brand_knowledge_versions.approved_by was NOT NULL + ON DELETE CASCADE, so
-- deleting an approving user would cascade-delete immutable approved
-- knowledge history. That violates the immutable-history contract (I-27 now
-- covers brand_knowledge_versions and brand_knowledge_revisions alongside
-- external_proofs).
--
-- Correction: ON DELETE RESTRICT — user deletion that would destroy approved
-- knowledge history FAILS LOUDLY and the version rows remain intact. This is
-- intentional until Prompt 029 designs the owner-authorized audited deletion
-- path. approved_by stays NOT NULL (attribution is part of the immutable
-- record).
--
-- Deliberately unchanged:
--   * brand_id ON DELETE CASCADE on both knowledge tables — brand deletion
--     removes brand-scoped knowledge history (Prompt 029 will review full
--     account/brand deletion semantics).
--   * brand_knowledge_revisions.reviewed_by ON DELETE SET NULL — as designed.

ALTER TABLE brand_knowledge_versions
  DROP CONSTRAINT brand_knowledge_versions_approved_by_fkey;

ALTER TABLE brand_knowledge_versions
  ADD CONSTRAINT brand_knowledge_versions_approved_by_fkey
  FOREIGN KEY (approved_by) REFERENCES users (user_id) ON DELETE RESTRICT;
