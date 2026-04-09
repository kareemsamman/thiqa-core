-- Drop existing function and recreate with proper cast
DROP FUNCTION IF EXISTS public.report_renewals_service_detailed(date, integer, text);

CREATE OR REPLACE FUNCTION public.report_renewals_service_detailed(
  p_end_month date,
  p_days_remaining integer DEFAULT NULL,
  p_policy_type text DEFAULT NULL
)
RETURNS TABLE (
  policy_id uuid,
  client_id uuid,
  client_name text,
  client_file_number text,
  client_phone text,
  car_number text,
  policy_type_parent text,
  company_name_ar text,
  end_date date,
  days_remaining integer,
  insurance_price numeric,
  renewal_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id AS policy_id,
    p.client_id,
    c.full_name AS client_name,
    c.file_number AS client_file_number,
    c.phone_number AS client_phone,
    car.car_number,
    p.policy_type_parent::text,
    ic.name_ar AS company_name_ar,
    p.end_date,
    (p.end_date - CURRENT_DATE)::integer AS days_remaining,
    COALESCE(p.insurance_price, 0) AS insurance_price,
    COALESCE(prt.renewal_status, 'not_contacted') AS renewal_status
  FROM policies p
  JOIN clients c ON c.id = p.client_id
  LEFT JOIN cars car ON car.id = p.car_id
  LEFT JOIN insurance_companies ic ON ic.id = p.company_id
  LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
  WHERE 
    p.cancelled = false
    AND p.transferred = false
    AND p.end_date >= CURRENT_DATE
    AND p.end_date < (p_end_month + interval '1 month')::date
    AND (p_days_remaining IS NULL OR (p.end_date - CURRENT_DATE) <= p_days_remaining)
    AND (p_policy_type IS NULL OR p.policy_type_parent = p_policy_type::policy_type_parent)
  ORDER BY p.end_date ASC, c.full_name ASC;
END;
$$;