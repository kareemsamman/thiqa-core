-- =============================================================================
-- TEST AGENT MIGRATION — move every existing agent onto a 35-day Ultimate
-- trial so pre-launch testing can continue with the new plan model.
-- =============================================================================
-- Pre-launch only: Thiqa has no paying customers yet and every agent
-- row is a test account (confirmed by the user). After this migration
-- runs, the sync_plan_change_features trigger re-seeds
-- agent_feature_flags from subscription_plans.default_features for
-- 'ultimate', which gives test agents access to everything while the
-- pricing UI is being built.
--
-- This migration is not idempotent for production — re-running it
-- will reset every agent to trial. Do not apply to a DB with real
-- subscribers.
-- =============================================================================

-- Expand the agents.plan CHECK constraint to accept the new plan keys
-- ('entry', 'basic', 'professional', 'ultimate') alongside the legacy
-- values ('starter', 'pro', 'custom') so dangling references on old
-- agent rows don't fail before the UPDATE runs.
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_plan_check;
ALTER TABLE public.agents ADD CONSTRAINT agents_plan_check
  CHECK (plan IN ('entry', 'basic', 'professional', 'ultimate', 'custom', 'starter', 'pro'));

UPDATE public.agents
SET
  plan = 'ultimate',
  subscription_status = 'trial',
  trial_ends_at = now() + interval '35 days',
  subscription_started_at = COALESCE(subscription_started_at, now()),
  subscription_expires_at = NULL,
  monthly_price = 0,
  pending_plan = NULL,
  cancelled_at = NULL
WHERE true;

-- Make sure every agent has a usage_limits row aligned with the new
-- Ultimate quotas so the UI has something consistent to show on day
-- one. Thiqa admin can override per-agent afterwards.
INSERT INTO public.agent_usage_limits (
  agent_id,
  sms_limit_type, sms_limit_count,
  ai_limit_type, ai_limit_count,
  marketing_sms_limit_type, marketing_sms_limit_count
)
SELECT
  a.id,
  'monthly', 200,
  'monthly', 250,
  'monthly', 300
FROM public.agents a
ON CONFLICT (agent_id) DO UPDATE SET
  sms_limit_count           = EXCLUDED.sms_limit_count,
  ai_limit_count            = EXCLUDED.ai_limit_count,
  marketing_sms_limit_count = EXCLUDED.marketing_sms_limit_count;

-- Seed the credit wallet too so overage flows have a row to update.
INSERT INTO public.agent_credit_wallet (agent_id)
SELECT id FROM public.agents
ON CONFLICT (agent_id) DO NOTHING;
