-- ============================================================
-- CRITICAL FIX: Drop ALL old RLS policies that don't check agent_id
--
-- The agent_data_* policies (from migration 20260308141947) enforce
-- agent isolation. But the OLD policies from 2025 only check
-- is_active_user() / has_role() without agent_id. Since PostgreSQL
-- ORs PERMISSIVE policies together, the old policies bypass agent
-- isolation entirely.
--
-- This migration drops ALL old policies, keeping only:
-- - agent_data_* policies (agent isolation)
-- - Policies on auth-critical tables (profiles, user_roles, agent_users)
-- - Super admin policies on admin tables
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
  pol RECORD;
  -- Tables that have agent_data_* policies and need old policies dropped
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
    -- Drop every policy that is NOT an agent_data_* or service_* policy
    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = tbl
        AND policyname NOT LIKE 'agent_data_%'
        AND policyname NOT LIKE 'service_%'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- Ensure service role can insert into tables that triggers need
-- (SECURITY DEFINER triggers run as service role)
-- ============================================================
DO $$
DECLARE
  tbl TEXT;
  trigger_tables TEXT[] := ARRAY[
    'notifications', 'policy_reminders', 'sms_logs',
    'automated_sms_log', 'ab_ledger'
  ];
BEGIN
  FOREACH tbl IN ARRAY trigger_tables LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS service_insert_%I ON public.%I', tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY service_insert_%I ON public.%I FOR INSERT TO service_role WITH CHECK (true)', tbl, tbl
    );
  END LOOP;
END $$;

-- ============================================================
-- Keep necessary non-agent policies for auth-critical tables
-- (profiles, user_roles, agent_users are NOT in the list above)
-- ============================================================
-- These tables already have their own special policies from
-- migration 20260308141947 and don't need changes.
