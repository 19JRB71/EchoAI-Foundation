-- Prompt 019: task-spine adoption for outbound email sends.
--
-- JUSTIFICATION (D-19): migration 131 enumerated the legal task types in a
-- CHECK constraint so nothing could invent ad-hoc types; 132 widened it for
-- 'ad_launch'. Adopting 'email_send' requires widening it again — there is
-- no way to do this without a migration. Additive only: no table, column,
-- row, or existing value changes.

ALTER TABLE agent_tasks
  DROP CONSTRAINT IF EXISTS agent_tasks_task_type_check;

ALTER TABLE agent_tasks
  ADD CONSTRAINT agent_tasks_task_type_check
  CHECK (task_type IN ('social_publish', 'reconciliation', 'ad_launch', 'email_send'));
