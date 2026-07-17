-- Company Truth: background generation support.
--
-- Report generation now runs in the background on the server (the old
-- in-request run was killed by proxy timeouts in production and its progress
-- vanished when the owner left the page). A run that fails is recorded
-- honestly as status='failed' with an owner-readable error_message so the UI
-- can surface it instead of spinning forever. Failed rows are swept away at
-- the start of the next generation attempt.

ALTER TABLE company_truth_reports ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE company_truth_reports DROP CONSTRAINT IF EXISTS company_truth_status_chk;
ALTER TABLE company_truth_reports ADD CONSTRAINT company_truth_status_chk CHECK (
  status IN ('generating', 'pending_approval', 'approved', 'superseded', 'failed')
);
