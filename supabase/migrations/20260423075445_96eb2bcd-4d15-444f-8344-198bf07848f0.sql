-- Add HTD SMS provider credentials to sms_settings
ALTER TABLE public.sms_settings
  ADD COLUMN IF NOT EXISTS htd_id text,
  ADD COLUMN IF NOT EXISTS htd_sender text;

-- Add status column to branches (active vs plan_locked for over-limit branches)
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'plan_locked'));

-- Add 'plan_locked' value to user_status enum used by profiles.status
ALTER TYPE public.user_status ADD VALUE IF NOT EXISTS 'plan_locked';