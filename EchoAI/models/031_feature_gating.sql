-- 031_feature_gating.sql
-- Feature gating & tier enforcement (Prompt 39).
--
-- Adds support for scheduled downgrades: when a user downgrades their tier, the
-- higher-tier features stay unlocked until the next billing cycle. We record the
-- target tier and the timestamp it becomes effective; the Stripe
-- `invoice.payment_succeeded` webhook (start of the new cycle) applies it.
--
-- Team-size (seat) tracking already lives on `users.team_size` — no new table is
-- needed. Idempotent.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS pending_tier subscription_tier;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS pending_tier_effective_at TIMESTAMPTZ;
