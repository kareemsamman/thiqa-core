-- ============================================================
-- Fix: Super admin (Thiqa) cannot save SMS/Tranzila/Auth settings
-- because agent_data_* policies only check get_my_agent_id()
-- which returns NULL for super admins.
--
-- Solution: Add super admin bypass to all agent_data_* policies
-- ============================================================

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
    -- Drop and recreate SELECT with super admin bypass
    EXECUTE format('DROP POLICY IF EXISTS agent_data_select ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY agent_data_select ON public.%I FOR SELECT TO authenticated USING (
        public.is_super_admin(auth.uid())
        OR (agent_id IS NOT NULL AND agent_id = public.get_my_agent_id())
      )', tbl
    );

    -- Drop and recreate INSERT with super admin bypass
    EXECUTE format('DROP POLICY IF EXISTS agent_data_insert ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY agent_data_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (
        public.is_super_admin(auth.uid())
        OR agent_id IS NULL
        OR agent_id = public.get_my_agent_id()
      )', tbl
    );

    -- Drop and recreate UPDATE with super admin bypass
    EXECUTE format('DROP POLICY IF EXISTS agent_data_update ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY agent_data_update ON public.%I FOR UPDATE TO authenticated
        USING (
          public.is_super_admin(auth.uid())
          OR (agent_id IS NOT NULL AND agent_id = public.get_my_agent_id())
        )
        WITH CHECK (
          public.is_super_admin(auth.uid())
          OR agent_id IS NULL
          OR agent_id = public.get_my_agent_id()
        )
      ', tbl
    );

    -- Drop and recreate DELETE with super admin bypass
    EXECUTE format('DROP POLICY IF EXISTS agent_data_delete ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY agent_data_delete ON public.%I FOR DELETE TO authenticated USING (
        public.is_super_admin(auth.uid())
        OR (agent_id IS NOT NULL AND agent_id = public.get_my_agent_id())
      )', tbl
    );
  END LOOP;
END $$;
