-- ============================================================================
-- 083_feature_suggestions.sql — Feature Suggestions (product intelligence)
--
-- When any user asks Echo to do something it can't do yet, Echo never
-- dead-ends the conversation. Instead the request is logged here as a feature
-- suggestion: similar requests are merged into one suggestion (AI-matched by
-- title) whose request_count grows with every ask. The admin panel lists
-- suggestions most-requested-first with a status the admin can manage.
--
-- Idempotent: safe to re-run.
-- ============================================================================

--   title  : short canonical name for the capability (AI-normalized so
--            "post to TikTok" and "TikTok posting" merge into one row)
--   status : pending | in_development | completed (admin-managed)
CREATE TABLE IF NOT EXISTS feature_suggestions (
    suggestion_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title              VARCHAR(200) NOT NULL,
    description        TEXT NOT NULL,
    request_count      INTEGER NOT NULL DEFAULT 1,
    status             VARCHAR(20) NOT NULL DEFAULT 'pending',
    first_requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backstop for concurrent logging: two simultaneous "new" suggestions with the
-- same canonical title collapse into one row via ON CONFLICT in app code.
CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_suggestions_title
    ON feature_suggestions (LOWER(title));

CREATE INDEX IF NOT EXISTS idx_feature_suggestions_count
    ON feature_suggestions (status, request_count DESC);

-- Every individual ask, verbatim, so the admin can read exactly what users
-- said. user_id is kept (SET NULL on account deletion) for "how many distinct
-- customers want this" style questions later.
CREATE TABLE IF NOT EXISTS feature_suggestion_requests (
    request_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suggestion_id UUID NOT NULL REFERENCES feature_suggestions (suggestion_id) ON DELETE CASCADE,
    user_id       UUID REFERENCES users (user_id) ON DELETE SET NULL,
    request_text  TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_suggestion_requests_suggestion
    ON feature_suggestion_requests (suggestion_id, created_at DESC);
