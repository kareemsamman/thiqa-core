-- Remove legacy overloaded report_renewals that conflicts with the new client-grouped version
-- Keeping: report_renewals(date, date, text, uuid, text, integer, integer)
DROP FUNCTION IF EXISTS public.report_renewals(
  p_start_date date,
  p_end_date date,
  p_search text,
  p_company_id uuid,
  p_policy_type text,
  p_created_by uuid,
  p_page_size integer,
  p_page integer
);

-- Safety: ensure the remaining function exists (no-op if already present)
-- (Definition is maintained by previous migrations)
