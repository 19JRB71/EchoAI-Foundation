-- Three-Tier Demo Accounts.
--
-- The demo subsystem previously seeded ONE flagged brand. It now seeds three
-- (one per sellable tier) so the platform admin can present Starter,
-- Professional, and Enterprise as separate, isolated demo accounts and switch
-- between them live. Each demo brand is tagged with the tier it represents;
-- demo_config tracks which tier is currently being presented.

-- Which tier a demo brand represents: 'starter' | 'pro' | 'enterprise'.
-- NULL for every real (non-demo) brand.
ALTER TABLE brands ADD COLUMN IF NOT EXISTS demo_tier VARCHAR(20);

-- The tier currently being presented. NULL when Presentation Mode is on but no
-- tier has been chosen yet (the presenter is on the tier-selection screen).
ALTER TABLE demo_config ADD COLUMN IF NOT EXISTS active_tier VARCHAR(20);
