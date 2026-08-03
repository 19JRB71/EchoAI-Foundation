-- Prompt 018: task-spine adoption for ad launches.
--
-- JUSTIFICATION (D-19 — "no migration expected"): migration 131 deliberately
-- enumerated the legal task types in a CHECK constraint so nothing could
-- invent ad-hoc types. Adopting a NEW type ('ad_launch') therefore requires
-- widening that CHECK — there is no way to do this without a migration.
-- Additive only: no table, column, row, or existing value changes.

ALTER TABLE agent_tasks
  DROP CONSTRAINT IF EXISTS agent_tasks_task_type_check;

ALTER TABLE agent_tasks
  ADD CONSTRAINT agent_tasks_task_type_check
  CHECK (task_type IN ('social_publish', 'reconciliation', 'ad_launch'));
