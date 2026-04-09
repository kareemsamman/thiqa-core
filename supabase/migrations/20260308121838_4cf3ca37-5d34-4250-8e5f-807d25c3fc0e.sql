-- Enforce RLS for frontend reporting/directory RPCs by switching them to SECURITY INVOKER
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS function_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.proname IN (
        'user_directory_list_active',
        'get_active_users_for_tasks',
        'get_tasks_with_users_and_pending',
        'report_created_policies',
        'report_renewals',
        'report_renewed_clients',
        'get_client_renewal_policies',
        'report_company_settlement',
        'report_company_settlement_company_options',
        'get_company_balance',
        'report_debt_policies_for_clients',
        'report_client_debts'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SECURITY INVOKER',
      r.schema_name,
      r.function_name,
      r.function_args
    );
  END LOOP;
END $$;