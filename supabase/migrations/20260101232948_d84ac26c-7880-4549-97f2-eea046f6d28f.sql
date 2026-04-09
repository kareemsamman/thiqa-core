-- Drop and recreate report_renewals function to include group_id
DROP FUNCTION IF EXISTS public.report_renewals(date, integer, text, uuid, text, integer, integer);

CREATE FUNCTION public.report_renewals(
  p_end_month date DEFAULT NULL::date, 
  p_days_remaining integer DEFAULT NULL::integer, 
  p_policy_type text DEFAULT NULL::text, 
  p_created_by uuid DEFAULT NULL::uuid, 
  p_search text DEFAULT NULL::text, 
  p_limit integer DEFAULT 50, 
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, 
  end_date date, 
  days_remaining integer, 
  client_id uuid, 
  client_name text, 
  client_file_number text, 
  client_phone text, 
  car_number text, 
  policy_type_parent text, 
  policy_type_child text, 
  company_name text, 
  company_name_ar text, 
  insurance_price numeric, 
  renewal_status text, 
  renewal_notes text, 
  last_contacted_at timestamp with time zone, 
  reminder_sent_at timestamp with time zone, 
  created_by_id uuid, 
  created_by_name text,
  group_id uuid,
  total_rows bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_month_start DATE;
  v_month_end DATE;
BEGIN
  IF NOT is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_end_month IS NOT NULL THEN
    v_month_start := DATE_TRUNC('month', p_end_month)::DATE;
    v_month_end := (DATE_TRUNC('month', p_end_month) + INTERVAL '1 month - 1 day')::DATE;
  ELSE
    v_month_start := DATE_TRUNC('month', CURRENT_DATE)::DATE;
    v_month_end := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE;
  END IF;

  RETURN QUERY
  WITH filtered_policies AS (
    SELECT
      p.id,
      p.end_date,
      (p.end_date - CURRENT_DATE)::INTEGER AS days_remaining,
      p.client_id,
      c.full_name AS client_name,
      c.file_number AS client_file_number,
      c.phone_number AS client_phone,
      car.car_number,
      p.policy_type_parent::TEXT,
      p.policy_type_child::TEXT,
      ic.name AS company_name,
      ic.name_ar AS company_name_ar,
      p.insurance_price,
      COALESCE(prt.renewal_status, 'not_contacted') AS renewal_status,
      prt.notes AS renewal_notes,
      prt.last_contacted_at,
      prt.reminder_sent_at,
      p.created_by_admin_id AS created_by_id,
      prof.full_name AS created_by_name,
      p.group_id
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN cars car ON car.id = p.car_id
    LEFT JOIN insurance_companies ic ON ic.id = p.company_id
    LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
    LEFT JOIN profiles prof ON prof.id = p.created_by_admin_id
    WHERE p.deleted_at IS NULL
      AND p.cancelled IS NOT TRUE
      AND p.transferred IS NOT TRUE
      AND can_access_branch(auth.uid(), p.branch_id)
      AND (
        (p_days_remaining IS NOT NULL AND (p.end_date - CURRENT_DATE) <= p_days_remaining AND (p.end_date - CURRENT_DATE) >= 0)
        OR (p_days_remaining IS NULL AND p.end_date >= v_month_start AND p.end_date <= v_month_end)
      )
      AND (p_policy_type IS NULL OR p.policy_type_parent::TEXT = p_policy_type)
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      AND (
        p_search IS NULL OR
        c.full_name ILIKE '%' || p_search || '%' OR
        c.phone_number ILIKE '%' || p_search || '%' OR
        c.file_number ILIKE '%' || p_search || '%' OR
        car.car_number ILIKE '%' || p_search || '%'
      )
  )
  SELECT
    fp.*,
    COUNT(*) OVER() AS total_rows
  FROM filtered_policies fp
  ORDER BY fp.end_date ASC
  LIMIT GREATEST(p_limit, 1)
  OFFSET GREATEST(p_offset, 0);
END;
$function$;