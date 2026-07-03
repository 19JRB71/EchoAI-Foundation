-- 044_setup_agent_lease_token.sql
-- Fencing token for the AI Setup Agent's renewable execution lease.
--
-- The /execute lease (042) guards against overlapping runs of the same step, and
-- a lease older than the window (no heartbeat) is reclaimable so a crashed process
-- can never deadlock a session. To make reclaim fully race-safe, tag each held
-- lease with a per-claim token: heartbeat and release only affect the lease they
-- still own, so a revived crashed executor can never clear a lease that another
-- request already reclaimed. Idempotent: safe to re-run.

ALTER TABLE setup_sessions
  ADD COLUMN IF NOT EXISTS executing_token UUID;
