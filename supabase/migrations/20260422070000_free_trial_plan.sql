-- =============================================================================
-- Free Trial as its own plan (editable from /thiqa/settings)
-- =============================================================================
-- Previously the registration flow put new agents on 'basic' and the
-- phase-1 migration parked every test agent on 'ultimate'/trial —
-- neither accurately described what a trial should look like. Now
-- free trial is a real subscription_plans row with its own quotas
-- (1 user, 1 branch, unlimited policies, 100 SMS / 100 marketing_SMS
-- / 100 AI per month, all features unlocked). Thiqa admin can tune
-- the numbers from the Plans editor.
--
-- The plan stays is_active = true so useAgentContext.planInfo
-- resolves correctly for agents on it, but sort_order = -1 and a
-- client-side filter (plan_key <> 'free_trial') will keep it off
-- the public /pricing page and out of upgrade dialogs.
-- =============================================================================

-- 1. Allow 'free_trial' in the agents.plan CHECK constraint
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_plan_check;
ALTER TABLE public.agents ADD CONSTRAINT agents_plan_check
  CHECK (plan IN ('free_trial', 'entry', 'basic', 'professional', 'ultimate', 'custom', 'starter', 'pro'));

-- 2. Seed the plan row. Features mirror Ultimate (everything on)
--    so trial users can evaluate the full product.
INSERT INTO public.subscription_plans (
  plan_key, name, name_ar, description,
  monthly_price, yearly_price, badge,
  users_limit, branches_limit, policies_limit,
  sms_limit, marketing_sms_limit, ai_limit,
  support_sla_hours, sort_order, is_active,
  features, default_features
) VALUES (
  'free_trial', 'Free Trial', 'فترة تجريبية',
  'تجربة مجانية — كل الميزات مفتوحة مع حدود محدودة',
  0, NULL, NULL,
  1, 1, NULL,
  100, 100, 100,
  96, -1, true,
  '[]'::jsonb,
  '{"files_upload":true,"files_explorer":true,"sms":true,"marketing_sms":true,"accident_reports":true,"correspondence":true,"contacts":true,"digital_signatures":true,"tasks":true,"renewals":true,"dashboard":true,"cheques":true,"debt_tracking":true,"repair_claims":true,"broker_wallet":true,"company_settlement":true,"accounting":true,"financial_reports":true,"receipts":true,"ai_assistant":true}'::jsonb
)
ON CONFLICT (plan_key) DO UPDATE SET
  users_limit = EXCLUDED.users_limit,
  branches_limit = EXCLUDED.branches_limit,
  policies_limit = EXCLUDED.policies_limit,
  sms_limit = EXCLUDED.sms_limit,
  marketing_sms_limit = EXCLUDED.marketing_sms_limit,
  ai_limit = EXCLUDED.ai_limit,
  default_features = EXCLUDED.default_features,
  is_active = true;

-- 3. Every test agent currently on the post-phase-1 "ultimate / trial"
--    stub should actually be on free_trial instead, since that's what
--    the product calls the pre-purchase experience. Agents whose
--    subscription_status is anything other than 'trial' keep their
--    plan untouched.
UPDATE public.agents
SET plan = 'free_trial'
WHERE subscription_status = 'trial'
  AND plan = 'ultimate';
