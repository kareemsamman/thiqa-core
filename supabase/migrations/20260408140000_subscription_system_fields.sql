-- ============================================================
-- Subscription System Enhancement
-- Adds fields for trial tracking, billing cycle, plan changes
-- ============================================================

-- Allow 'custom' and 'starter' plan types + 'paused' status
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_plan_check;
ALTER TABLE public.agents ADD CONSTRAINT agents_plan_check
  CHECK (plan IN ('starter', 'basic', 'pro', 'custom'));

ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_subscription_status_check;
ALTER TABLE public.agents ADD CONSTRAINT agents_subscription_status_check
  CHECK (subscription_status IN ('trial', 'active', 'paused', 'suspended', 'expired', 'cancelled'));

-- New subscription tracking columns
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS subscription_started_at timestamptz;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS billing_cycle_day int;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS pending_plan text;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- Backfill: set trial_ends_at = subscription_expires_at for trial agents (monthly_price = 0)
UPDATE public.agents
SET trial_ends_at = subscription_expires_at,
    subscription_status = 'trial'
WHERE monthly_price = 0
  AND subscription_status = 'active'
  AND trial_ends_at IS NULL;

-- Backfill: set subscription_started_at for paid agents
UPDATE public.agents
SET subscription_started_at = created_at,
    billing_cycle_day = EXTRACT(DAY FROM created_at)
WHERE monthly_price > 0
  AND subscription_started_at IS NULL;

-- Add 'is_hidden' to subscription_plans for soft-deleted plans
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;
