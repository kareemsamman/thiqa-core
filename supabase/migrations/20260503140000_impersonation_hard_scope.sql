-- =============================================================================
-- Hard-clamp tenant scope during impersonation via a RESTRICTIVE policy.
-- =============================================================================
-- The previous migration (20260503130000) rewrote agent_data_* to enforce
-- the impersonation scope, but several tenant tables also have additional
-- PERMISSIVE policies that grant super-admin or branch-admin access
-- (e.g. clients.branch_isolation, notifications."Users see own…",
-- pbx_extensions.pbx_extensions_admin_select). Postgres OR's multiple
-- PERMISSIVE policies for the same command, so any one of them granting
-- access bypasses the impersonation scope — the leak persists.
--
-- A RESTRICTIVE policy is AND'd with every other policy, so adding one
-- that says "during impersonation, the row's agent_id must match the
-- impersonation target" hard-clamps access regardless of how many other
-- permissive policies exist. Outside impersonation the predicate is
-- vacuously true and the existing policies decide access.
-- =============================================================================

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
    EXECUTE format('DROP POLICY IF EXISTS impersonation_scope ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY impersonation_scope ON public.%I AS RESTRICTIVE
        FOR ALL TO authenticated
        USING (
          public.get_impersonated_agent_id() IS NULL
          OR (agent_id IS NOT NULL AND agent_id = public.get_impersonated_agent_id())
        )
        WITH CHECK (
          public.get_impersonated_agent_id() IS NULL
          OR agent_id IS NULL
          OR agent_id = public.get_impersonated_agent_id()
        )',
      tbl
    );
  END LOOP;
END $$;
