
-- ============================================================
-- FIX: Drop all broken RESTRICTIVE agent_guard policies and
-- redundant tenant_isolation policies. Replace with a single
-- clean approach using the existing auto_set_agent_id trigger
-- and simple permissive policies.
-- ============================================================

-- Helper function: get current user's agent_id (cached per statement)
CREATE OR REPLACE FUNCTION public.get_my_agent_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT agent_id FROM public.agent_users WHERE user_id = auth.uid() LIMIT 1
$$;

-- ============================================================
-- 1. Drop ALL agent_guard_* and tenant_isolation_* policies
--    from every table that has agent_id
-- ============================================================
DO $$
DECLARE
  tbl TEXT;
  pol TEXT;
  tables_with_agent TEXT[] := ARRAY[
    'ab_ledger','accident_fee_services','accident_injured_persons',
    'accident_report_files','accident_report_notes','accident_report_reminders',
    'accident_reports','accident_third_parties','agent_feature_flags',
    'agent_subscription_payments','agent_users','announcements','auth_settings',
    'automated_sms_log','branches','broker_settlement_items','broker_settlements',
    'brokers','business_contacts','car_accidents','cars','client_children',
    'client_debits','client_notes','client_payments','clients',
    'company_accident_fee_prices','company_accident_templates',
    'company_road_service_prices','company_settlements','correspondence_letters',
    'customer_signatures','customer_wallet_transactions','expenses',
    'form_template_files','form_template_folders','insurance_categories',
    'insurance_companies','insurance_company_groups','invoice_templates',
    'invoices','lead_messages','leads','marketing_sms_campaigns',
    'marketing_sms_recipients','media_files','notifications','outside_cheques',
    'payment_images','payment_settings','pbx_extensions','policies',
    'policy_children','policy_groups','policy_payments','policy_reminders',
    'policy_renewal_tracking','policy_transfers','pricing_rules','profiles',
    'repair_claim_notes','repair_claim_reminders','repair_claims',
    'road_services','settlement_supplements','site_settings','sms_logs',
    'sms_settings','tasks','user_roles','xservice_settings'
  ];
  policies_to_drop TEXT[] := ARRAY[
    'agent_guard_select','agent_guard_insert','agent_guard_update','agent_guard_delete',
    'tenant_isolation_select','tenant_isolation_insert','tenant_isolation_update','tenant_isolation_delete',
    'tenant_isolation_authenticated'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables_with_agent LOOP
    FOREACH pol IN ARRAY policies_to_drop LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, tbl);
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- 2. Create simple agent isolation policies for DATA tables
--    (not auth-critical tables)
-- ============================================================

-- Tables that should NOT get agent isolation policies:
-- profiles    → users need to read own profile for auth
-- agent_users → needed for agent lookup
-- user_roles  → needed for role checks (already has agent_id unique constraint)
-- agent_feature_flags → managed by super admin
-- agent_subscription_payments → managed by super admin
-- announcements → can be global (agent_id IS NULL)

-- List of data tables that need strict agent isolation
DO $$
DECLARE
  tbl TEXT;
  data_tables TEXT[] := ARRAY[
    'ab_ledger','accident_fee_services','accident_injured_persons',
    'accident_report_files','accident_report_notes','accident_report_reminders',
    'accident_reports','accident_third_parties',
    'auth_settings','automated_sms_log','branches',
    'broker_settlement_items','broker_settlements','brokers',
    'business_contacts','car_accidents','cars','client_children',
    'client_debits','client_notes','client_payments','clients',
    'company_accident_fee_prices','company_accident_templates',
    'company_road_service_prices','company_settlements','correspondence_letters',
    'customer_signatures','customer_wallet_transactions','expenses',
    'form_template_files','form_template_folders','insurance_categories',
    'insurance_companies','insurance_company_groups','invoice_templates',
    'invoices','lead_messages','leads','marketing_sms_campaigns',
    'marketing_sms_recipients','media_files','notifications','outside_cheques',
    'payment_images','payment_settings','pbx_extensions','policies',
    'policy_children','policy_groups','policy_payments','policy_reminders',
    'policy_renewal_tracking','policy_transfers','pricing_rules',
    'repair_claim_notes','repair_claim_reminders','repair_claims',
    'road_services','settlement_supplements','site_settings','sms_logs',
    'sms_settings','tasks','xservice_settings'
  ];
BEGIN
  FOREACH tbl IN ARRAY data_tables LOOP
    -- SELECT: only rows matching user's agent
    EXECUTE format(
      'CREATE POLICY agent_data_select ON public.%I FOR SELECT TO authenticated USING (
        agent_id IS NOT NULL AND agent_id = public.get_my_agent_id()
      )', tbl
    );

    -- INSERT: allow if agent_id is NULL (trigger will set it) or matches user's agent
    EXECUTE format(
      'CREATE POLICY agent_data_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (
        agent_id IS NULL OR agent_id = public.get_my_agent_id()
      )', tbl
    );

    -- UPDATE: only rows matching user's agent
    EXECUTE format(
      'CREATE POLICY agent_data_update ON public.%I FOR UPDATE TO authenticated 
        USING (agent_id IS NOT NULL AND agent_id = public.get_my_agent_id())
        WITH CHECK (agent_id IS NULL OR agent_id = public.get_my_agent_id())
      ', tbl
    );

    -- DELETE: only rows matching user's agent
    EXECUTE format(
      'CREATE POLICY agent_data_delete ON public.%I FOR DELETE TO authenticated USING (
        agent_id IS NOT NULL AND agent_id = public.get_my_agent_id()
      )', tbl
    );
  END LOOP;
END $$;

-- ============================================================
-- 3. Special policies for announcements (can be global)
-- ============================================================
CREATE POLICY agent_data_select ON public.announcements 
  FOR SELECT TO authenticated 
  USING (agent_id IS NULL OR agent_id = public.get_my_agent_id());

CREATE POLICY agent_data_insert ON public.announcements 
  FOR INSERT TO authenticated 
  WITH CHECK (agent_id IS NULL OR agent_id = public.get_my_agent_id());

CREATE POLICY agent_data_update ON public.announcements 
  FOR UPDATE TO authenticated 
  USING (agent_id IS NULL OR agent_id = public.get_my_agent_id())
  WITH CHECK (agent_id IS NULL OR agent_id = public.get_my_agent_id());

CREATE POLICY agent_data_delete ON public.announcements 
  FOR DELETE TO authenticated 
  USING (agent_id IS NULL OR agent_id = public.get_my_agent_id());

-- ============================================================
-- 4. Special policies for agent_feature_flags & agent_subscription_payments
--    (super admin manages these, agents can read their own)
-- ============================================================
CREATE POLICY agent_data_select ON public.agent_feature_flags 
  FOR SELECT TO authenticated 
  USING (agent_id = public.get_my_agent_id() OR public.is_super_admin(auth.uid()));

CREATE POLICY agent_data_insert ON public.agent_feature_flags 
  FOR INSERT TO authenticated 
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY agent_data_update ON public.agent_feature_flags 
  FOR UPDATE TO authenticated 
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY agent_data_delete ON public.agent_feature_flags 
  FOR DELETE TO authenticated 
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY agent_data_select ON public.agent_subscription_payments 
  FOR SELECT TO authenticated 
  USING (agent_id = public.get_my_agent_id() OR public.is_super_admin(auth.uid()));

CREATE POLICY agent_data_insert ON public.agent_subscription_payments 
  FOR INSERT TO authenticated 
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY agent_data_update ON public.agent_subscription_payments 
  FOR UPDATE TO authenticated 
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY agent_data_delete ON public.agent_subscription_payments 
  FOR DELETE TO authenticated 
  USING (public.is_super_admin(auth.uid()));

-- ============================================================
-- 5. Agent_users: users can see their own agent link, super admin sees all
-- ============================================================
CREATE POLICY agent_data_select ON public.agent_users 
  FOR SELECT TO authenticated 
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));

CREATE POLICY agent_data_insert ON public.agent_users 
  FOR INSERT TO authenticated 
  WITH CHECK (public.is_super_admin(auth.uid()) OR user_id = auth.uid());

CREATE POLICY agent_data_update ON public.agent_users 
  FOR UPDATE TO authenticated 
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY agent_data_delete ON public.agent_users 
  FOR DELETE TO authenticated 
  USING (public.is_super_admin(auth.uid()));

-- ============================================================
-- 6. User_roles: scoped by agent_id
-- ============================================================
CREATE POLICY agent_data_select ON public.user_roles 
  FOR SELECT TO authenticated 
  USING (
    agent_id = public.get_my_agent_id() 
    OR user_id = auth.uid() 
    OR public.is_super_admin(auth.uid())
  );

CREATE POLICY agent_data_insert ON public.user_roles 
  FOR INSERT TO authenticated 
  WITH CHECK (
    agent_id IS NULL OR agent_id = public.get_my_agent_id() OR public.is_super_admin(auth.uid())
  );

CREATE POLICY agent_data_update ON public.user_roles 
  FOR UPDATE TO authenticated 
  USING (agent_id = public.get_my_agent_id() OR public.is_super_admin(auth.uid()));

CREATE POLICY agent_data_delete ON public.user_roles 
  FOR DELETE TO authenticated 
  USING (agent_id = public.get_my_agent_id() OR public.is_super_admin(auth.uid()));

-- ============================================================
-- 7. Profiles: users read own profile, admins read profiles of same agent
-- ============================================================
-- Drop old tenant policies that were on profiles
-- (already dropped above, but profiles needs special handling)
-- Keep existing policies: "Users can view their own profile", etc.
-- Add agent-scoped policy for admins to see team members
CREATE POLICY agent_data_select ON public.profiles 
  FOR SELECT TO authenticated 
  USING (
    id = auth.uid()
    OR agent_id = public.get_my_agent_id()
    OR public.is_super_admin(auth.uid())
  );
