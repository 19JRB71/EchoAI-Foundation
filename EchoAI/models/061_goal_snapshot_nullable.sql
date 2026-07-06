-- Make goal_snapshots.percent_to_goal nullable so no-data goals (no measurable
-- reading yet) are stored as NULL instead of 0. Storing 0 conflated "no data"
-- with a real 0% miss, which made the morning briefing and alert monitor report
-- unmeasured goals as at-risk and drag down the portfolio score.
--
-- Idempotent: DROP DEFAULT / DROP NOT NULL are safe to re-run.
ALTER TABLE goal_snapshots ALTER COLUMN percent_to_goal DROP DEFAULT;
ALTER TABLE goal_snapshots ALTER COLUMN percent_to_goal DROP NOT NULL;
