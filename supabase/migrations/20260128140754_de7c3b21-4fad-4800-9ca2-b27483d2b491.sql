-- Fix: get_client_renewal_policies was returning enum columns while declared as text, causing RPC calls to fail

CREATE OR REPLACE FUNCTION public.get_client_renewal_policies(
  p_client_id uuid,
  p_start_date date DEFAULT NULL::date,
  p_end_date date DEFAULT NULL::date
)
RETURNS TABLE(
  id uuid,
  car_id uuid,
  car_number text,
  policy_type_parent text,
  policy_type_child text,
  company_id uuid,
  company_name text,
  company_name_ar text,
  start_date date,
  end_date date,
  days_remaining integer,
  insurance_price numeric,
  renewal_status text,
  renewal_notes text,
  reminder_sent_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.car_id,
    car.car_number,
    p.policy_type_parent::text,
    p.policy_type_child::text,
    p.company_id,
    ic.name as company_name,
    ic.name_ar as company_name_ar,
    p.start_date,
    p.end_date,
    (p.end_date - CURRENT_DATE)::integer as days_remaining,
    p.insurance_price,
    COALESCE(prt.renewal_status, 'not_contacted') as renewal_status,
    prt.notes as renewal_notes,
    prt.reminder_sent_at
  FROM public.policies p
  LEFT JOIN public.cars car ON car.id = p.car_id
  LEFT JOIN public.insurance_companies ic ON ic.id = p.company_id
  LEFT JOIN public.policy_renewal_tracking prt ON prt.policy_id = p.id
  WHERE p.client_id = p_client_id
    AND p.deleted_at IS NULL
    AND p.cancelled IS NOT TRUE
    AND p.transferred IS NOT TRUE
    AND (p_start_date IS NULL OR p.end_date >= p_start_date)
    AND (p_end_date IS NULL OR p.end_date <= p_end_date)
  ORDER BY p.end_date ASC;
END;
$function$;

-- Tighten access: reports are not public
REVOKE ALL ON FUNCTION public.get_client_renewal_policies(uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_client_renewal_policies(uuid,date,date) TO authenticated;
