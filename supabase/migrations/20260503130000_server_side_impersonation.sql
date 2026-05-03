-- =============================================================================
-- Server-side impersonation: stop relying on the frontend to remember to
-- filter tenant queries by agent_id during a Thiqa-admin "ادخل النظام"
-- session.
-- =============================================================================
-- Background: 20260408160000_allow_super_admin_data_access.sql gave super
-- admins a blanket bypass on every agent_data_* policy:
--
--   USING (is_super_admin(auth.uid()) OR agent_id = get_my_agent_id())
--
-- That was needed so /thiqa/* admin views could read across tenants. But
-- the "ادخل النظام" impersonation flow is a *frontend-only* sessionStorage
-- flag — auth.uid() is still the super admin, so RLS keeps returning rows
-- from every agent. Almost every list page in the app forgot to add
-- `.eq('agent_id', impersonatedAgentId)` and was leaking cross-tenant
-- data while impersonating.
--
-- Fix: make impersonation real database state. While a super admin has an
-- impersonation_sessions row, the agent_data_* policies scope them to the
-- target agent only. Outside impersonation the bypass still applies so
-- the admin panels keep working.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. impersonation_sessions — one row per actively-impersonating super admin
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.impersonation_sessions (
  super_admin_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  target_agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.impersonation_sessions ENABLE ROW LEVEL SECURITY;

-- Only the super admin themselves can read/manage their own row. The
-- write check additionally requires that they actually are a super
-- admin so a regular user can never insert here.
CREATE POLICY impersonation_sessions_self ON public.impersonation_sessions
  FOR ALL TO authenticated
  USING (super_admin_user_id = auth.uid())
  WITH CHECK (super_admin_user_id = auth.uid() AND public.is_super_admin(auth.uid()));

CREATE POLICY impersonation_sessions_service_role ON public.impersonation_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 2. Helpers + RPCs
-- -----------------------------------------------------------------------------
-- Read-only helper used by the agent_data_* policies. STABLE so the
-- planner can cache it within a query.
CREATE OR REPLACE FUNCTION public.get_impersonated_agent_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT target_agent_id FROM public.impersonation_sessions
  WHERE super_admin_user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_impersonated_agent_id() TO authenticated;

-- Begin impersonation. Idempotent — re-calling with a different agent
-- swaps the target. Only callable by super admins.
CREATE OR REPLACE FUNCTION public.start_impersonation(p_agent_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only Thiqa super admins can impersonate'
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.agents WHERE id = p_agent_id) THEN
    RAISE EXCEPTION 'Agent % does not exist', p_agent_id
      USING ERRCODE = '23503'; -- foreign_key_violation
  END IF;

  INSERT INTO public.impersonation_sessions (super_admin_user_id, target_agent_id)
  VALUES (auth.uid(), p_agent_id)
  ON CONFLICT (super_admin_user_id) DO UPDATE
    SET target_agent_id = EXCLUDED.target_agent_id,
        started_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_impersonation(uuid) TO authenticated;

-- End impersonation. Idempotent.
CREATE OR REPLACE FUNCTION public.stop_impersonation()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.impersonation_sessions WHERE super_admin_user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.stop_impersonation() TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Rewrite every agent_data_* policy to enforce impersonation scope
-- -----------------------------------------------------------------------------
-- New rule for SELECT/UPDATE/DELETE:
--   IF impersonating  → only the target agent's rows
--   ELSE              → super admin bypass OR own agent's rows
--
-- New rule for INSERT WITH CHECK:
--   IF impersonating  → row must belong to target agent (or be NULL pre-trigger)
--   ELSE              → super admin bypass OR own agent's rows
--
-- The table list mirrors 20260408160000_allow_super_admin_data_access.sql.
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
  using_clause TEXT;
  with_check_insert TEXT;
  with_check_update TEXT;
BEGIN
  using_clause := $u$(
    public.get_impersonated_agent_id() IS NOT NULL
    AND agent_id IS NOT NULL
    AND agent_id = public.get_impersonated_agent_id()
  )
  OR (
    public.get_impersonated_agent_id() IS NULL
    AND (
      public.is_super_admin(auth.uid())
      OR (agent_id IS NOT NULL AND agent_id = public.get_my_agent_id())
    )
  )$u$;

  with_check_insert := $w$(
    public.get_impersonated_agent_id() IS NOT NULL
    AND (agent_id IS NULL OR agent_id = public.get_impersonated_agent_id())
  )
  OR (
    public.get_impersonated_agent_id() IS NULL
    AND (
      public.is_super_admin(auth.uid())
      OR agent_id IS NULL
      OR agent_id = public.get_my_agent_id()
    )
  )$w$;

  with_check_update := with_check_insert;

  FOREACH tbl IN ARRAY data_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS agent_data_select ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY agent_data_select ON public.%I FOR SELECT TO authenticated USING (%s)',
      tbl, using_clause
    );

    EXECUTE format('DROP POLICY IF EXISTS agent_data_insert ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY agent_data_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)',
      tbl, with_check_insert
    );

    EXECUTE format('DROP POLICY IF EXISTS agent_data_update ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY agent_data_update ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
      tbl, using_clause, with_check_update
    );

    EXECUTE format('DROP POLICY IF EXISTS agent_data_delete ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY agent_data_delete ON public.%I FOR DELETE TO authenticated USING (%s)',
      tbl, using_clause
    );
  END LOOP;
END $$;
