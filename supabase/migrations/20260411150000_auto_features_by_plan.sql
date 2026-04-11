-- Function to set feature flags based on plan
-- Trial: all features enabled
-- Basic: core features (SMS, financial reports, cheques, correspondence, receipts, accounting, renewal_reports)
-- Pro: all features enabled
CREATE OR REPLACE FUNCTION public.set_features_for_plan(p_agent_id uuid, p_plan text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  all_features text[] := ARRAY[
    'sms', 'financial_reports', 'broker_wallet', 'company_settlement',
    'expenses', 'cheques', 'leads', 'accident_reports', 'repair_claims',
    'marketing_sms', 'road_services', 'accident_fees', 'correspondence',
    'visa_payment', 'receipts', 'accounting', 'renewal_reports',
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
