-- =============================================================================
-- Enforce free_trial invariants at the database level
-- =============================================================================
-- The "free_trial" plan only makes sense in one shape:
--   subscription_status = 'trial'
--   monthly_price = 0
--   subscription_expires_at IS NULL  (trials don't have a paid expiry)
--   trial_ends_at IS NOT NULL        (every trial has an end date)
--
-- Without this constraint, a half-applied save (client succeeds at
-- updating `plan` but the trigger that reconciles status/price/dates
-- silently no-ops) leaves agents in zombie states like
--   plan='free_trial', subscription_status='active', monthly_price=300
-- which then breaks the lockout gate, the badge, the upgrade flow,
-- and Thiqa admin's mental model. The "Resync subscription state"
-- button is the remediation; this constraint is the prevention.
--
-- Two-phase: first repair existing violations so the ALTER doesn't
-- fail, then add the CHECK as NOT VALID so we don't lock the table,
-- then VALIDATE (which scans without an exclusive lock).
-- =============================================================================

-- Phase 1: repair. Anyone whose plan is 'free_trial' but state is
-- inconsistent gets snapped to canonical trial shape. We default
-- trial_ends_at to 35 days out (the same default new signups get)
-- when missing — losing 35 days of trial they may have already
-- consumed is preferable to leaving them stuck.
UPDATE public.agents
SET subscription_status = 'trial',
    monthly_price = 0,
    subscription_expires_at = NULL,
    trial_ends_at = COALESCE(trial_ends_at, NOW() + INTERVAL '35 days')
WHERE plan = 'free_trial'
  AND (
    subscription_status IS DISTINCT FROM 'trial'
    OR COALESCE(monthly_price, 0) <> 0
    OR subscription_expires_at IS NOT NULL
    OR trial_ends_at IS NULL
  );

-- Phase 2: add the CHECK constraint as NOT VALID, then validate.
ALTER TABLE public.agents
  DROP CONSTRAINT IF EXISTS chk_agents_free_trial_invariants;

ALTER TABLE public.agents
  ADD CONSTRAINT chk_agents_free_trial_invariants
  CHECK (
    plan <> 'free_trial' OR (
      subscription_status = 'trial'
      AND COALESCE(monthly_price, 0) = 0
      AND subscription_expires_at IS NULL
      AND trial_ends_at IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE public.agents
  VALIDATE CONSTRAINT chk_agents_free_trial_invariants;
