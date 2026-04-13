-- Extend report_debt_policies_for_clients with office_commission so the
-- Debt Tracking page can surface ELZAMI markups alongside insurance_price.
-- Also roll commission into the remaining/paid calculation so customers
-- who owe only the commission are still visible as debts.
DROP FUNCTION IF EXISTS public.report_debt_policies_for_clients(uuid[]);

CREATE FUNCTION public.report_debt_policies_for_clients(p_client_ids uuid[])
 RETURNS TABLE(
   client_id uuid,
   policy_id uuid,
   policy_number text,
   insurance_price numeric,
   office_commission numeric,
   paid numeric,
   remaining numeric,
   end_date date,
   days_until_expiry integer,
   status text,
   policy_type_parent text,
   policy_type_child text,
   car_number text,
   group_id uuid
 )
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
SELECT
  p.client_id,
  p.id AS policy_id,
  p.policy_number,
  p.insurance_price::numeric AS insurance_price,
  COALESCE(p.office_commission, 0)::numeric AS office_commission,
  COALESCE(SUM(CASE WHEN pp.refused IS NOT TRUE THEN pp.amount ELSE 0 END), 0)::numeric AS paid,
  ((p.insurance_price + COALESCE(p.office_commission, 0))
    - COALESCE(SUM(CASE WHEN pp.refused IS NOT TRUE THEN pp.amount ELSE 0 END), 0))::numeric AS remaining,
  p.end_date::date AS end_date,
  (p.end_date::date - CURRENT_DATE)::int AS days_until_expiry,
  CASE
    WHEN p.end_date::date < CURRENT_DATE THEN 'expired'
    WHEN (p.end_date::date - CURRENT_DATE) <= 30 THEN 'expiring_soon'
    ELSE 'active'
  END AS status,
  p.policy_type_parent::text AS policy_type_parent,
  p.policy_type_child::text AS policy_type_child,
  car.car_number,
  p.group_id
FROM public.policies p
JOIN public.clients c ON c.id = p.client_id
LEFT JOIN public.cars car ON car.id = p.car_id
LEFT JOIN public.policy_payments pp ON pp.policy_id = p.id
WHERE p.cancelled = false
  AND p.deleted_at IS NULL
  AND p.policy_type_parent <> 'ELZAMI'
  AND p.client_id = ANY (p_client_ids)
  AND public.is_active_user(auth.uid())
  AND public.can_access_branch(auth.uid(), c.branch_id)
GROUP BY p.client_id, p.id, p.policy_number, p.insurance_price, p.office_commission, p.end_date,
         p.policy_type_parent, p.policy_type_child, car.car_number, p.group_id
HAVING ((p.insurance_price + COALESCE(p.office_commission, 0))
        - COALESCE(SUM(CASE WHEN pp.refused IS NOT TRUE THEN pp.amount ELSE 0 END), 0)) > 0
ORDER BY p.client_id, p.end_date DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.report_debt_policies_for_clients(uuid[]) TO authenticated;
