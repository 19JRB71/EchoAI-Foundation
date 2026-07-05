-- 050: Employee Accountability CRM — enum additions.
--
-- Postgres allows ALTER TYPE ... ADD VALUE inside the migration runner's
-- per-file transaction, but a newly added value cannot be USED until the
-- transaction that added it has committed. So this migration ONLY adds the new
-- enum values; every table/column that uses them lives in migration 051, which
-- runs in a later (already-committed) transaction. (Same pattern as 005.)

-- Sales Rep is a new workspace role: a lead-queue-only employee.
ALTER TYPE team_role ADD VALUE IF NOT EXISTS 'sales_rep';

-- Deactivated keeps a member's full history while revoking access (auth only
-- remaps status = 'active' members, so deactivating cuts access immediately).
ALTER TYPE team_member_status ADD VALUE IF NOT EXISTS 'deactivated';

-- rep_task logs a sales rep's manual queue outcome (call disposition, note,
-- follow-up) into the per-lead accountability trail.
ALTER TYPE interaction_type ADD VALUE IF NOT EXISTS 'rep_task';
