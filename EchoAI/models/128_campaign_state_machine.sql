-- Prompt 005: honest campaign lifecycle — domain states with Facebook read-back
-- verification. Replaces the dishonest legacy 'active' (rows said "active"
-- while every Facebook object was PAUSED) with truthful states:
--   draft, approved, created_paused, live, completed, failed, launch_failed
--
-- Deterministic, no network: every legacy 'active' row maps UNCONDITIONALLY to
-- 'created_paused'. This mapping is exact because no delivery-enable
-- (unpause) mechanism has ever existed in this codebase — nothing launched by
-- this platform has ever been able to deliver, so no legacy row can be live.
-- 'launch_failed' (Prompt 003 partial-chain marker) is preserved first-class.
--
-- Unexpected status values abort the migration loudly (STOP AND REPORT).
--
-- Also adds the verification bookkeeping columns:
--   last_verified_at  — set after every successful Graph read-back
--   last_verify_error — set when a read-back fails (state left unchanged)
--
-- Rollback (reverses this migration exactly):
--   UPDATE campaigns SET status = 'active' WHERE status = 'created_paused';
--   ALTER TABLE campaigns ALTER COLUMN status SET DEFAULT 'active';
--   ALTER TABLE campaigns DROP COLUMN IF EXISTS last_verified_at;
--   ALTER TABLE campaigns DROP COLUMN IF EXISTS last_verify_error;
--   (No 'live'/'draft'/'approved'/'completed'/'failed' rows can exist at
--    rollback time unless later prompts wrote them.)

DO $$
DECLARE
    bad_count INTEGER;
    bad_values TEXT;
BEGIN
    SELECT COUNT(*), string_agg(DISTINCT status, ', ')
      INTO bad_count, bad_values
      FROM campaigns
     WHERE status NOT IN (
        'active', 'launch_failed',
        'draft', 'approved', 'created_paused', 'live', 'completed', 'failed'
     );
    IF bad_count > 0 THEN
        RAISE EXCEPTION
            'Migration 128 aborted: % campaigns row(s) carry unexpected status value(s): %. STOP AND REPORT — do not guess a mapping.',
            bad_count, bad_values;
    END IF;
END $$;

-- Mapping table (deterministic):
--   active        -> created_paused   (all rows, unconditionally)
--   launch_failed -> launch_failed    (preserved)
--   any new-state value already present -> preserved unchanged
UPDATE campaigns SET status = 'created_paused' WHERE status = 'active';

-- New rows without an explicit status (e.g. demo seeds) must never claim
-- delivery: default to created_paused, the post-launch resting state.
ALTER TABLE campaigns ALTER COLUMN status SET DEFAULT 'created_paused';

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS last_verify_error TEXT;
