-- Reset stale visa_payment feature flags + remove visa_payment from
-- the set_features_for_plan RPC so it stays admin-gated.
--
-- Background: an old auto-sync (set_features_for_plan in
-- 20260411150000_auto_features_by_plan.sql) inserted
-- (agent_id, 'visa_payment', enabled=true) for every agent on the pro
-- or trial plan. visa_payment was later promoted to an admin-gated
-- feature (ADMIN_ONLY_FEATURES in useAgentContext) — meaning the only
-- legitimate way to enable it is for a Thiqa super admin to flip it
-- by hand. The plan-change trigger (sync_plan_change_features in
-- 20260422000100) already skips visa_payment. But:
--   1. The stale `true` rows already in agent_feature_flags were
--      never cleaned up — those agents still see "فيزا" in the
--      payment dropdown.
--   2. The set_features_for_plan RPC is still called by the Thiqa
--      admin "إعادة ضبط على الباقة" button, and it would put the
--      flag back to `true` for any pro/trial agent on every click.
--
-- This migration force-clears the stale rows and rewrites the RPC
-- to leave visa_payment alone (admin must toggle it manually). The
-- Features tab UI is gaining a manual visa_payment toggle in the
-- same release.

-- 1. Clear stale data.
UPDATE public.agent_feature_flags
SET enabled = false
WHERE feature_key = 'visa_payment'
  AND enabled = true;

-- 2. Rewrite set_features_for_plan to skip visa_payment.
CREATE OR REPLACE FUNCTION public.set_features_for_plan(p_agent_id uuid, p_plan text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Note: visa_payment intentionally omitted — it's admin-gated and
  -- must be toggled manually in the Features tab.
  all_features text[] := ARRAY[
    'sms', 'financial_reports', 'broker_wallet', 'company_settlement',
    'expenses', 'cheques', 'leads', 'accident_reports', 'repair_claims',
    'marketing_sms', 'road_services', 'accident_fees', 'correspondence',
    'receipts', 'accounting', 'renewal_reports',
    'ai_assistant', 'ippbx'
  ];
  basic_features text[] := ARRAY[
    'sms', 'financial_reports', 'cheques', 'correspondence',
    'receipts', 'accounting', 'renewal_reports', 'expenses'
  ];
  feat text;
  is_enabled boolean;
BEGIN
  FOREACH feat IN ARRAY all_features LOOP
    IF p_plan = 'pro' OR p_plan = 'trial' THEN
      is_enabled := true;
    ELSIF p_plan = 'basic' THEN
      is_enabled := feat = ANY(basic_features);
    ELSE
      -- starter: minimal
      is_enabled := feat IN ('financial_reports', 'receipts');
    END IF;

    INSERT INTO public.agent_feature_flags (agent_id, feature_key, enabled)
    VALUES (p_agent_id, feat, is_enabled)
    ON CONFLICT (agent_id, feature_key)
    DO UPDATE SET enabled = is_enabled;
  END LOOP;
END;
$$;
